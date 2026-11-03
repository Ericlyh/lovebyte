import { describe, it, expect } from 'vitest';
import { median, scoreLighthouse } from './lighthouse-score.mjs';

const PERF_MIN = 95;
const A11Y_MIN = 98;

// A runner that returns a fixed sequence of scores, one per call. The
// accessibility sequence defaults to a clean 100 — in the real gate a11y is
// independent of perf and does not fall when perf does.
function runner(perfSeq, a11ySeq = perfSeq.map(() => 100)) {
  const calls = [];
  return {
    calls,
    run: async () => {
      const i = calls.length;
      calls.push(i);
      return { perf: perfSeq[i], a11y: a11ySeq[i] };
    },
  };
}

describe('median', () => {
  it('returns the middle value of an odd-length sample', () => {
    expect(median([83, 80, 94])).toBe(83);
  });

  it('averages the two middles of an even-length sample', () => {
    expect(median([80, 83, 94, 98])).toBe(89);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('scoreLighthouse', () => {
  it('does not retry when the first median passes', async () => {
    const r = runner([99, 99, 99]);
    const result = await scoreLighthouse({
      samples: 3,
      retrySamples: 3,
      perfMin: PERF_MIN,
      a11yMin: A11Y_MIN,
      run: r.run,
    });

    expect(result.perf).toBe(99);
    expect(result.a11y).toBe(100);
    expect(result.retried).toBe(false);
    expect(result.rescued).toBe(false);
    expect(r.calls.length).toBe(3);
  });

  it('retries and recovers when the first median was host contention', async () => {
    // The exact shape measured on 2026-11-04: a busy host, then a free one.
    const r = runner([83, 80, 94, 99, 98, 98]);
    const result = await scoreLighthouse({
      samples: 3,
      retrySamples: 3,
      perfMin: PERF_MIN,
      a11yMin: A11Y_MIN,
      run: r.run,
    });

    expect(result.retried).toBe(true);
    expect(result.rescued).toBe(true);
    expect(result.perf).toBeGreaterThanOrEqual(PERF_MIN);
    expect(result.samples).toBe(6);
    expect(result.perfSamples).toEqual([83, 80, 94, 99, 98, 98]);
  });

  it('still fails when a genuine regression persists across the retry', async () => {
    const r = runner([89, 88, 90, 89, 91, 90]);
    const result = await scoreLighthouse({
      samples: 3,
      retrySamples: 3,
      perfMin: PERF_MIN,
      a11yMin: A11Y_MIN,
      run: r.run,
    });

    expect(result.retried).toBe(true);
    expect(result.rescued).toBe(false);
    expect(result.perf).toBeLessThan(PERF_MIN);
  });

  it('does not let a real regression hide behind a lucky retry sample', async () => {
    // The lower half is a genuine regression; the upper half is noise. The
    // pooled median must stay below the threshold.
    const r = runner([80, 81, 82, 99, 99, 99]);
    const result = await scoreLighthouse({
      samples: 3,
      retrySamples: 3,
      perfMin: PERF_MIN,
      a11yMin: A11Y_MIN,
      run: r.run,
    });

    expect(result.perf).toBeLessThan(PERF_MIN);
  });

  it('retries when accessibility misses even though performance passes', async () => {
    const r = runner([99, 99, 99, 99, 99, 99], [90, 91, 92, 91, 92, 93]);
    const result = await scoreLighthouse({
      samples: 3,
      retrySamples: 3,
      perfMin: PERF_MIN,
      a11yMin: A11Y_MIN,
      run: r.run,
    });

    expect(result.retried).toBe(true);
    expect(result.a11y).toBeLessThan(A11Y_MIN);
  });

  it('treats a non-finite score as an audit failure, not a silent pass', async () => {
    // `NaN < PERF_MIN` is false, so a NaN median would otherwise sail past
    // the threshold and report the site as healthy.
    const result = await scoreLighthouse({
      samples: 3,
      retrySamples: 3,
      perfMin: PERF_MIN,
      a11yMin: A11Y_MIN,
      run: async () => ({ perf: Number.NaN, a11y: 100 }),
    });

    expect(result.perf).toBeNull();
    expect(result.samples).toBe(0);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('reports an audit failure as no score rather than a bad score', async () => {
    const result = await scoreLighthouse({
      samples: 3,
      retrySamples: 3,
      perfMin: PERF_MIN,
      a11yMin: A11Y_MIN,
      run: async () => {
        throw new Error('chrome died');
      },
    });

    expect(result.perf).toBeNull();
    expect(result.a11y).toBeNull();
    expect(result.samples).toBe(0);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('never retries when the retry budget is zero', async () => {
    const r = runner([83, 80, 94]);
    const result = await scoreLighthouse({
      samples: 3,
      retrySamples: 0,
      perfMin: PERF_MIN,
      a11yMin: A11Y_MIN,
      run: r.run,
    });

    expect(result.retried).toBe(false);
    expect(result.perf).toBe(83);
    expect(r.calls.length).toBe(3);
  });
});
