import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFileSystem } from './fs.js';

describe('nodeFileSystem (J2.1)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'data-json-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a file as UTF-8 text', async () => {
    const path = join(dir, 'a.json');
    await writeFile(path, '{"x":1}', 'utf8');

    const port = nodeFileSystem();
    await expect(port.read(path)).resolves.toBe('{"x":1}');
  });

  it('rejects reading a path that does not exist', async () => {
    const port = nodeFileSystem();
    await expect(port.read(join(dir, 'missing.json'))).rejects.toBeTruthy();
  });

  it('stats a file for mtimeMs and size', async () => {
    const path = join(dir, 'a.json');
    await writeFile(path, '{"x":1}', 'utf8');

    const port = nodeFileSystem();
    const stat = await port.stat(path);
    expect(stat.size).toBe(7);
    expect(typeof stat.mtimeMs).toBe('number');
  });

  it('watch fires onChange when the file changes, and the unsubscribe stops further callbacks', async () => {
    const path = join(dir, 'a.json');
    await writeFile(path, '{"x":1}', 'utf8');

    const port = nodeFileSystem();
    expect(port.watch).toBeTypeOf('function');

    let fired = 0;
    const unsubscribe = port.watch!(path, () => {
      fired += 1;
    });

    await writeFile(path, '{"x":2}', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fired).toBeGreaterThan(0);

    unsubscribe();
    const firedAtUnsubscribe = fired;
    await writeFile(path, '{"x":3}', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fired).toBe(firedAtUnsubscribe);
  });
});
