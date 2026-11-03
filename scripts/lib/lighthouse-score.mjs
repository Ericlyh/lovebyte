/**
 * Score one Lighthouse route, with a retry when the first median misses.
 *
 * Why the retry exists (OOP-7167):
 *
 * Lighthouse is a noisy instrument. OOP-6548 measured the UNCHANGED homepage
 * ten times and got perf = 81..99 — an 18-point spread around a 95 threshold
 * — and the spread tracks host CPU contention, not the site.
 *
 * The median-of-N estimator fixed the worst of that, but N=3 is still not
 * enough: on 2026-11-04 the same byte-identical build measured /browse at
 * perf 98 (samples 99,98,98) in one run and perf 83 (samples 83,80,94) in
 * the next, twelve minutes apart, with no deploy in between. The gate filed
 * `lighthouse-browse-perf` against an unchanged page.
 *
 * That flapping is not merely noise in the board: a median of three samples
 * drawn from an 80-99 distribution cannot distinguish "the site regressed to
 * 89" from "the host was busy for two of three samples". A real regression
 * can hide inside the noise band, and a noisy gate that fires on both is a
 * gate nobody trusts.
 *
 * So the Lighthouse probe now does what the HTTP probe already does
 * (OOP-6701): the two failure modes are told apart by a RETRY, not by a
 * bigger sample count. When the first median misses the threshold, take
 * more samples and re-score; only a still-missing median is a gap.
 *
 * The extra samples are pooled with the first ones rather than replacing
 * them, so the final verdict is a median over every sample actually taken.
 * Pooling keeps the false-negative direction closed: a genuine regression
 * stays below the threshold however many samples are added, because the
 * median of a set whose lower half is all failing samples cannot climb
 * above the threshold.
 */

/** Median of a numeric sample. Even-length medians average the two middles. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Collect samples for one route and score it against the thresholds.
 *
 * @param {object} opts
 * @param {number} opts.samples      base sample count
 * @param {number} opts.retrySamples extra samples taken only on a miss
 * @param {number} opts.perfMin       minimum acceptable performance score
 * @param {number} opts.a11yMin       minimum acceptable accessibility score
 * @param {() => Promise<{perf: number, a11y: number}>} opts.run one audit
 * @returns {Promise<{
 *   perf: number|null, a11y: number|null, samples: number,
 *   perfSamples: number[], a11ySamples: number[],
 *   retried: boolean, rescued: boolean, error: Error|null
 * }>}
 */
export async function scoreLighthouse({ samples, retrySamples, perfMin, a11yMin, run }) {
  const perfSamples = [];
  const a11ySamples = [];
  let error = null;

  const collect = async (count) => {
    for (let i = 0; i < count; i++) {
      try {
        const { perf, a11y } = await run();
        // A non-finite score must NOT be averaged in: `NaN < PERF_MIN` is
        // false, so a NaN median would sail past the threshold and turn a
        // broken audit into a silent PASS. Treat it as an audit failure.
        if (!Number.isFinite(perf) || !Number.isFinite(a11y)) {
          error = new Error(
            `audit produced a non-finite score (perf=${perf}, a11y=${a11y})`,
          );
          return false;
        }
        perfSamples.push(perf);
        a11ySamples.push(a11y);
      } catch (err) {
        error = err;
        return false;
      }
    }
    return true;
  };

  await collect(samples);

  // No samples at all is an audit failure, not a bad score — the gate must
  // report "the probe did not run" rather than "the site is slow".
  if (perfSamples.length === 0) {
    return {
      perf: null,
      a11y: null,
      samples: 0,
      perfSamples,
      a11ySamples,
      retried: false,
      rescued: false,
      error,
    };
  }

  let perf = median(perfSamples);
  let a11y = median(a11ySamples);
  let retried = false;

  // The first median missed. Before calling it a regression, take more
  // samples: the host may simply have been busy.
  if (retrySamples > 0 && (perf < perfMin || a11y < a11yMin)) {
    retried = true;
    await collect(retrySamples);
    perf = median(perfSamples);
    a11y = median(a11ySamples);
  }

  return {
    perf,
    a11y,
    samples: perfSamples.length,
    perfSamples,
    a11ySamples,
    retried,
    rescued: retried && perf >= perfMin && a11y >= a11yMin,
    error,
  };
}
