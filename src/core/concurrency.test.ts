import { describe, expect, it } from 'vitest';
import { fanOut } from './concurrency.js';

/** Tracks how many `fn` calls are simultaneously in flight, and the peak reached. */
function tracker() {
  let active = 0;
  let peak = 0;
  const seen: number[] = [];
  return {
    async run<T>(value: T, delayMs = 1): Promise<T> {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      active--;
      seen.push(active);
      return value;
    },
    peak: () => peak,
  };
}

describe('fanOut — I43: the fan-out ceiling', () => {
  it('never runs more than `ceiling` calls at once when items exceed it', async () => {
    const t = tracker();
    const items = Array.from({ length: 200 }, (_, i) => i);

    await fanOut(items, 64, (i) => t.run(i));

    expect(t.peak()).toBeLessThanOrEqual(64);
  });

  it('saturates the ceiling rather than under-using it', async () => {
    const t = tracker();
    const items = Array.from({ length: 200 }, (_, i) => i);

    await fanOut(items, 64, (i) => t.run(i));

    expect(t.peak()).toBe(64);
  });

  it('below the ceiling, every item runs concurrently — behaviour identical to Promise.all', async () => {
    const t = tracker();
    const items = Array.from({ length: 10 }, (_, i) => i);

    await fanOut(items, 64, (i) => t.run(i));

    expect(t.peak()).toBe(10);
  });

  it('returns results in item order regardless of completion order', async () => {
    const items = [30, 10, 20, 5];
    const results = await fanOut(items, 2, (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms)));
    expect(results).toEqual(items);
  });

  it('propagates a failure from any item', async () => {
    const items = [1, 2, 3];
    await expect(
      fanOut(items, 2, async (i) => {
        if (i === 2) throw new Error('boom');
        return i;
      }),
    ).rejects.toThrow('boom');
  });

  it('an empty array yields an empty result without invoking fn', async () => {
    let calls = 0;
    const results = await fanOut([], 64, async () => {
      calls++;
      return 0;
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });
});
