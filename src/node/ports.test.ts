import { describe, expect, it } from 'vitest';
import { nodePorts } from './ports.js';

describe('nodePorts (J2.8)', () => {
  it('composes fetch, fs, clock, rng, and schedule from the Node runtime', () => {
    const ports = nodePorts();
    expect(ports.fetch).toBeTypeOf('function');
    expect(ports.fs).toBeTruthy();
    expect(ports.fs!.read).toBeTypeOf('function');
    expect(ports.fs!.stat).toBeTypeOf('function');
    expect(ports.clock!()).toBeTypeOf('number');
    expect(ports.rng!()).toBeTypeOf('number');

    const wait = ports.schedule!(10);
    expect(wait.promise).toBeInstanceOf(Promise);
    expect(wait.cancel).toBeTypeOf('function');
    wait.cancel();
  });

  it('lets a supplied override win over the Node default', () => {
    const customFs = { read: async () => 'x', stat: async () => ({ mtimeMs: 0, size: 0 }) };
    const customClock = () => 42;

    const ports = nodePorts({ fs: customFs, clock: customClock });
    expect(ports.fs).toBe(customFs);
    expect(ports.clock).toBe(customClock);
    expect(ports.fetch).toBeTypeOf('function');
  });

  it('resolves a schedule() wait after the given delay', async () => {
    const ports = nodePorts();
    const start = performance.now();
    await ports.schedule!(20).promise;
    expect(performance.now() - start).toBeGreaterThanOrEqual(15);
  });
});
