import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SourceMap } from '../core/index.js';
import { assertNoDuplicateIds, assertNoServerSourcesInBundle } from './gates.js';

describe('assertNoServerSourcesInBundle (J3.4, J3.8, I7, I22)', () => {
  let publicDir: string;

  beforeEach(async () => {
    publicDir = await mkdtemp(join(tmpdir(), 'data-json-public-'));
  });

  afterEach(async () => {
    await rm(publicDir, { recursive: true, force: true });
  });

  const serverMap: SourceMap = {
    version: 1,
    sources: { secretConfig: { at: 'build', url: 'https://internal.example.com/config', cache: 'manual' } },
  };

  it('passes when no server-map id reached the public output', async () => {
    await writeFile(join(publicDir, 'projects.json'), '{}', 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).not.toThrow();
  });

  it('J3.4 throws build.serverSourceLeaked naming the id and the file when a server source leaked', async () => {
    await writeFile(join(publicDir, 'secretConfig.json'), '{}', 'utf8');

    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(
      expect.objectContaining({
        code: 'build.serverSourceLeaked',
        message: expect.stringContaining('secretConfig'),
      }),
    );
  });

  it('finds a leak nested in a subdirectory of the public output', async () => {
    await mkdir(join(publicDir, 'nested'));
    await writeFile(join(publicDir, 'nested', 'secretConfig.json'), '{}', 'utf8');

    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(
      expect.objectContaining({ code: 'build.serverSourceLeaked' }),
    );
  });

  it('J3.8 only catches a leak written before the gate runs — it proves nothing about a later writer', async () => {
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).not.toThrow();

    // A writer running after the gate is exactly the case §3.2 step 5 requires the gate to be
    // the last step to guard against — the gate itself cannot detect a write it never saw.
    await writeFile(join(publicDir, 'secretConfig.json'), '{}', 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(
      expect.objectContaining({ code: 'build.serverSourceLeaked' }),
    );
  });
});

describe('assertNoDuplicateIds (J3.9, I23)', () => {
  const publicMap: SourceMap = {
    version: 1,
    sources: { projects: { at: 'build', url: 'https://example.com/projects.json', cache: 'manual' } },
  };

  it('passes when no id is shared between the two maps', () => {
    const serverMap: SourceMap = {
      version: 1,
      sources: { adminStats: { at: 'build', url: 'https://internal.example.com/stats', cache: 'manual' } },
    };
    expect(() => assertNoDuplicateIds(publicMap, serverMap)).not.toThrow();
  });

  it('throws config.duplicateId naming the id and both files when an id appears in both maps', () => {
    const serverMap: SourceMap = {
      version: 1,
      sources: { projects: { at: 'build', url: 'https://internal.example.com/projects', cache: 'manual' } },
    };

    expect(() => assertNoDuplicateIds(publicMap, serverMap)).toThrow(
      expect.objectContaining({
        code: 'config.duplicateId',
        message: expect.stringMatching(/projects.*sources\.public\.yml.*sources\.server\.yml/),
      }),
    );
  });
});
