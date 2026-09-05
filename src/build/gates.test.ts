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

describe('assertNoServerSourcesInBundle content scan (I44, D72)', () => {
  let publicDir: string;

  beforeEach(async () => {
    publicDir = await mkdtemp(join(tmpdir(), 'data-json-public-'));
  });

  afterEach(async () => {
    await rm(publicDir, { recursive: true, force: true });
  });

  const URL = 'https://internal.example.com/config';
  const TOKEN = 'Bearer sk-live-abcdef123456';

  const serverMap: SourceMap = {
    version: 1,
    sources: {
      secretConfig: {
        at: 'build',
        url: URL,
        headers: { Authorization: TOKEN, 'X-Env': 'prod' },
        cache: 'manual',
      },
    },
  };

  const leaked = expect.objectContaining({ code: 'build.serverSourceLeaked' });

  it('fails when a server entry url is inlined into a JS chunk', async () => {
    await writeFile(join(publicDir, 'chunk-a1b2.js'), `const u="${URL}";fetch(u);`, 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(leaked);
  });

  it('fails when a declared header value is inlined into a JS chunk', async () => {
    await writeFile(join(publicDir, 'chunk-c3d4.js'), `const h={Authorization:"${TOKEN}"};`, 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(leaked);
  });

  it('fails on the origin-and-path prefix when the query string was rewritten', async () => {
    await writeFile(join(publicDir, 'chunk.js'), `fetch("${URL}?v=2&cb=91f3");`, 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(leaked);
  });

  it('fails on a solidus-escaped url, as JSON embedded in a bundle emits it', async () => {
    await writeFile(join(publicDir, 'data.js'), 'JSON.parse(\'{"u":"https:\\/\\/internal.example.com\\/config"}\')', 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(leaked);
  });

  it('fails on a \\u-escaped url', async () => {
    await writeFile(join(publicDir, 'esc.js'), 'const u="https:\\u002f\\u002finternal.example.com\\u002fconfig";', 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(leaked);
  });

  it('finds a content leak nested in a subdirectory of the public output', async () => {
    await mkdir(join(publicDir, 'assets'));
    await writeFile(join(publicDir, 'assets', 'app.js'), `x("${TOKEN}")`, 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).toThrow(leaked);
  });

  it('names the id, the file and the class that matched, and never the matched text', async () => {
    await writeFile(join(publicDir, 'chunk.js'), `const h={Authorization:"${TOKEN}"};`, 'utf8');

    let message = '';
    try {
      assertNoServerSourcesInBundle(publicDir, serverMap);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('secretConfig');
    expect(message).toContain('chunk.js');
    expect(message).toContain('header value');
    // A gate that prints a header value writes the credential into the CI log it guards (I44).
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain('sk-live-abcdef123456');
  });

  it('does not print the url either, though a url is not itself a credential', async () => {
    await writeFile(join(publicDir, 'chunk.js'), `fetch("${URL}");`, 'utf8');

    let message = '';
    try {
      assertNoServerSourcesInBundle(publicDir, serverMap);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('url');
    expect(message).not.toContain(URL);
  });

  it('does not scan a header value shorter than 8 characters', async () => {
    // 'prod' is the X-Env value. It is below the floor, so a bundle mentioning it is clean.
    await writeFile(join(publicDir, 'env.js'), 'export const mode="prod";', 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).not.toThrow();
  });

  it('never scans header names — an HTTP client shipping `Authorization` is not a leak', async () => {
    await writeFile(join(publicDir, 'client.js'), 'h.set("Authorization",t);h.set("X-Env",e);', 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).not.toThrow();
  });

  it('passes on public output that mentions neither a server url nor a scanned header value', async () => {
    await writeFile(join(publicDir, 'projects.json'), '{"url":"https://cdn.example.com/projects.json"}', 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, serverMap)).not.toThrow();
  });

  it('scans nothing for entries that declare no url — a file or inline entry has none to leak', async () => {
    const fileMap: SourceMap = {
      version: 1,
      sources: {
        localOnly: { at: 'build', path: '/srv/secrets/local.json', cache: 'manual' },
        bakedIn: { at: 'build', inline: { token: 'Bearer sk-live-abcdef123456' } },
      },
    };
    await writeFile(join(publicDir, 'chunk.js'), 'const t="Bearer sk-live-abcdef123456";', 'utf8');
    expect(() => assertNoServerSourcesInBundle(publicDir, fileMap)).not.toThrow();
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
