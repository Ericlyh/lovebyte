/**
 * The Lighthouse control probe (OOP-7572).
 *
 * A Lighthouse performance score is a measurement of the INSTRUMENT as much
 * as of the page: the score is computed from timings the browser actually
 * observed, so a busy host inflates them and the score falls even when the
 * site is byte-identical. On this host the UNCHANGED homepage scored 32 on
 * 2026-11-11 and 98 on 2026-11-16, with no deploy in between, and every
 * route failed together on the loaded days. A perf gap therefore could not
 * be told apart from a loaded host, and the gate filed false regressions
 * for four days (OOP-7572).
 *
 * The fix is a CONTROL: a trivial static page (no JS, no images, no fonts)
 * served by the same CDN and measured in the SAME run as the site's routes.
 * A trivial page has nothing to be slow about, so whatever it scores is the
 * instrument's score under the current conditions. When the control is
 * healthy, the run's route scores mean something; when the control is
 * degraded, they do not, and the gate reports the perf dimension as NOT
 * MEASURED instead of filing a gap it cannot support.
 *
 * The decision lives here, pure and without a browser, so it is unit
 * tested (scripts/lib/lighthouse-control.test.mjs). The measurement itself
 * lives in scripts/readiness-gate.mjs, where Chrome is.
 */

/**
 * @typedef {object} ControlProbe
 * @property {string} path        the control document's path, e.g. '/lh-control.html'
 * @property {boolean} available  did the control document fetch cleanly?
 * @property {number|null} perf   the control's median performance score
 * @property {number[]} perfSamples every performance sample taken
 * @property {number} samples     how many samples were taken
 * @property {number|null} status  the HTTP status of the control document
 * @property {string|null} error   why the probe failed, if it did
 */

/**
 * Decide what the control probe means for this run's perf numbers.
 *
 * The rule is deliberately one-directional. A control that scored badly is
 * POSITIVE evidence that the instrument was degraded, so the run's route
 * scores are not measurements of the site and must not be filed as gaps. A
 * control that could not be measured at all is not evidence either way, but
 * the gate has no other way to tell a slow page from a slow host, so the
 * perf dimension is reported as not measured rather than as a gap the
 * board cannot support.
 *
 * @param {ControlProbe} control the control probe's result
 * @param {number} controlMin the control's own performance threshold
 * @returns {{measurable: boolean, reason: string}} whether this run's perf
 *   numbers are measurements of the site, and why
 */
export function assessControl(control, controlMin) {
  const path = control?.path ?? '(unset)';

  if (!control?.available) {
    return {
      measurable: false,
      reason:
        `the control document ${path} is not available ` +
        `(${control?.error ?? 'unknown reason'}) — there is no environment reference for this run, ` +
        `so its perf numbers are not measurements of the site`,
    };
  }

  if (!Number.isFinite(control.perf)) {
    return {
      measurable: false,
      reason:
        `the control document ${path} produced no performance score ` +
        `(${control?.error ?? 'no samples collected'}) — there is no environment reference for this run, ` +
        `so its perf numbers are not measurements of the site`,
    };
  }

  if (control.perf < controlMin) {
    return {
      measurable: false,
      reason:
        `the control document ${path} scored perf=${control.perf} (< ${controlMin}) in this run — ` +
        `the instrument itself is degraded, so this run's perf numbers measure the host, not the site`,
    };
  }

  return {
    measurable: true,
    reason:
      `the control document ${path} scored perf=${control.perf} — the instrument is healthy, ` +
      `so the route scores below are measurements of the site`,
  };
}
