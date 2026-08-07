import type { JsonPorts, ScheduledWait } from '../core/index.js';
import { nodeFileSystem } from './fs.js';

function schedule(ms: number): ScheduledWait {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    promise,
    cancel(): void {
      clearTimeout(timer);
    },
  };
}

/** `20-contract.md` §9. Composes all five ports from the Node runtime; any override wins. */
export function nodePorts(overrides: Partial<JsonPorts> = {}): JsonPorts {
  return {
    fetch: (url, init) => fetch(url, init),
    fs: nodeFileSystem(),
    clock: () => Date.now(),
    rng: () => Math.random(),
    schedule,
    ...overrides,
  };
}
