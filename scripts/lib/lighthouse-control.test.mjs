import { describe, it, expect } from 'vitest';
import { assessControl } from './lighthouse-control.mjs';

const CONTROL_MIN = 95;

function control(overrides = {}) {
  return {
    path: '/lh-control.html',
    available: true,
    perf: 99,
    perfSamples: [99, 98, 99],
    samples: 3,
    status: 200,
    error: null,
    ...overrides,
  };
}

describe('assessControl', () => {
  it('calls a healthy control a measurement of the site', () => {
    const result = assessControl(control({ perf: 99 }), CONTROL_MIN);
    expect(result.measurable).toBe(true);
    expect(result.reason).toContain('perf=99');
  });

  it('treats a control at exactly the threshold as healthy', () => {
    const result = assessControl(control({ perf: CONTROL_MIN }), CONTROL_MIN);
    expect(result.measurable).toBe(true);
  });

  it('rejects the run when the control scores below the threshold', () => {
    // The 2026-11-11 case: the unchanged homepage scored 32, so a
    // trivial control page scored in the same band and the run's route
    // scores were measuring the host.
    const result = assessControl(control({ perf: 32 }), CONTROL_MIN);
    expect(result.measurable).toBe(false);
    expect(result.reason).toContain('perf=32');
    expect(result.reason).toContain('instrument');
  });

  it('rejects the run when the control document is missing', () => {
    const result = assessControl(
      control({ available: false, perf: null, status: 404, error: 'the control document returned HTTP 404' }),
      CONTROL_MIN,
    );
    expect(result.measurable).toBe(false);
    expect(result.reason).toContain('404');
  });

  it('rejects the run when the control audit produced no score', () => {
    const result = assessControl(
      control({ perf: null, samples: 0, error: 'audit produced a non-finite score' }),
      CONTROL_MIN,
    );
    expect(result.measurable).toBe(false);
    expect(result.reason).toContain('no performance score');
  });

  it('never treats a missing control as a healthy one', () => {
    // The dangerous direction: a control that did not run must not be
    // read as an all-clear.
    const result = assessControl({ path: '/lh-control.html' }, CONTROL_MIN);
    expect(result.measurable).toBe(false);
  });
});
