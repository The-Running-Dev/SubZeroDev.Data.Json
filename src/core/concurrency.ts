/**
 * I43: the three eager members (`loadMany`, `preload`, `/build`'s `prefetch`) fan out to at
 * most this many loads at a time, per call. Below the ceiling, behaviour is unchanged from an
 * unbounded `Promise.all` — this only engages once a caller-sized array has already violated
 * `10-design.md` §5's smallness assumption.
 */
export const FAN_OUT_CEILING = 64;

/**
 * Runs `fn` over `items` with at most `ceiling` calls in flight at once, returning results in
 * the same order as `items`. A worker pool rather than chunked batches, so a fast id does not
 * wait on a slow one from an earlier batch before the pool takes on the next id.
 */
export async function fanOut<T, R>(
  items: readonly T[],
  ceiling: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workerCount = Math.min(ceiling, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
