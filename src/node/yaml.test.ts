import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { convertYamlToJson } from './yaml.js';

/**
 * J2.3. The criterion is fidelity to the two converters this CLI retires —
 * `Docs-Template/scripts/pre-build.ts` (flat) and `Data/build.ts` (recursive). Both run
 * `js-yaml` 4.x `load()` on its DEFAULT_SCHEMA and write `JSON.stringify(data, null, 2)`
 * as UTF-8. D41 records why that parser and that schema, and J8.2 turns byte-identity into
 * an assertion rather than a hope — so these tests compare bytes, not parsed values.
 */

let root: string;
let from: string;
let to: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'data-json-yaml-'));
  from = join(root, 'config');
  to = join(root, 'out');
  await mkdir(from, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const write = async (relative: string, body: string): Promise<void> => {
  const target = join(from, relative);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, body, 'utf-8');
};

const read = (relative: string): Promise<string> => readFile(join(to, relative), 'utf-8');

describe('convertYamlToJson', () => {
  it('writes JSON.stringify(data, null, 2) — the exact shape both converters emit', async () => {
    await write('site.yml', 'title: Docs\nnested:\n  count: 3\n  flags:\n  - a\n  - b\n');

    const converted = await convertYamlToJson(from, to);

    expect(converted).toBe(1);
    expect(await read('site.json')).toBe(
      JSON.stringify({ title: 'Docs', nested: { count: 3, flags: ['a', 'b'] } }, null, 2)
    );
  });

  it('preserves the DEFAULT_SCHEMA timestamp coercion (D41) — this is the byte J8.2 pins', async () => {
    await write('projects.yml', 'lastModified: 2025-08-24 00:00:00+00:00\n');

    await convertYamlToJson(from, to);

    // js-yaml's DEFAULT_SCHEMA resolves a bare timestamp to a Date, which JSON.stringify
    // renders ISO-with-milliseconds. Docs-Template/config/projects.yml carries 27+ of these
    // and data/projects.json shows this exact form. A YAML 1.2 core-schema parser would
    // leave the string as written and break every one of them — that is D41's whole case,
    // and O26 is where the question of whether it *should* is parked.
    expect(await read('projects.json')).toBe(
      JSON.stringify({ lastModified: '2025-08-24T00:00:00.000Z' }, null, 2)
    );
  });

  it('leaves yes/no/on/off as strings — js-yaml 4 already uses the 1.2 core boolean set', async () => {
    await write('flags.yml', 'a: yes\nb: no\nc: on\nd: off\ne: true\n');

    await convertYamlToJson(from, to);

    expect(JSON.parse(await read('flags.json'))).toEqual({
      a: 'yes',
      b: 'no',
      c: 'on',
      d: 'off',
      e: true,
    });
  });

  it('mirrors nested directories, which is Data/build.ts and not Docs-Template', async () => {
    await write('top.yml', 'a: 1\n');
    await write('projects/Automation/tool.yml', 'b: 2\n');
    await write('projects/deep/deeper/leaf.yaml', 'c: 3\n');

    const converted = await convertYamlToJson(from, to);

    expect(converted).toBe(3);
    expect(JSON.parse(await read('top.json'))).toEqual({ a: 1 });
    expect(JSON.parse(await read(join('projects', 'Automation', 'tool.json')))).toEqual({ b: 2 });
    expect(JSON.parse(await read(join('projects', 'deep', 'deeper', 'leaf.json')))).toEqual({
      c: 3,
    });
  });

  it('converts .yml and .yaml and ignores every other extension', async () => {
    await write('a.yml', 'x: 1\n');
    await write('b.yaml', 'x: 2\n');
    await write('c.json', '{"x":3}');
    await write('d.md', '# not config');
    await write('cvData.sample', 'x: 4\n');

    const converted = await convertYamlToJson(from, to);

    expect(converted).toBe(2);
    await expect(read('c.json')).rejects.toThrow();
    await expect(read('d.json')).rejects.toThrow();
  });

  it('reports a missing source directory and converts nothing, rather than throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const converted = await convertYamlToJson(join(root, 'absent'), to);

    expect(converted).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips a malformed file, keeps going, and excludes it from the count (O27)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await write('good.yml', 'a: 1\n');
    await write('broken.yml', 'a: [1, 2\nb: {{{\n');
    await write('alsogood.yml', 'c: 3\n');

    const converted = await convertYamlToJson(from, to);

    // Known and retained, reproduced deliberately: both converters log and continue, so a
    // malformed file silently drops out of the published set. O27 owns whether it should.
    expect(converted).toBe(2);
    expect(error).toHaveBeenCalled();
    expect(JSON.parse(await read('good.json'))).toEqual({ a: 1 });
    expect(JSON.parse(await read('alsogood.json'))).toEqual({ c: 3 });
    await expect(read('broken.json')).rejects.toThrow();
    error.mockRestore();
  });

  it('creates the destination tree when it does not exist', async () => {
    await write('nested/one.yml', 'a: 1\n');

    const converted = await convertYamlToJson(from, join(to, 'deep', 'target'));

    expect(converted).toBe(1);
    expect(
      JSON.parse(await readFile(join(to, 'deep', 'target', 'nested', 'one.json'), 'utf-8'))
    ).toEqual({ a: 1 });
  });

  it('overwrites an existing output file, as both converters do', async () => {
    await write('a.yml', 'v: 2\n');
    await mkdir(to, { recursive: true });
    await writeFile(join(to, 'a.json'), '{"v":1}', 'utf-8');

    await convertYamlToJson(from, to);

    expect(JSON.parse(await read('a.json'))).toEqual({ v: 2 });
  });

  it('is deterministic — converting twice produces identical bytes (J8.2)', async () => {
    await write('projects/a.yml', 'lastModified: 2019-04-16 23:57:00+00:00\nname: One\n');
    await write('b.yml', 'list:\n- 1\n- 2\n');

    await convertYamlToJson(from, to);
    const first = [await read(join('projects', 'a.json')), await read('b.json')];

    await convertYamlToJson(from, to);
    const second = [await read(join('projects', 'a.json')), await read('b.json')];

    expect(second).toEqual(first);
  });
});
