import { readFile } from 'node:fs/promises';

import { load as loadYaml } from 'js-yaml';

import { normalizeSourceMap } from '../core/config.js';
import { JsonError } from '../core/errors.js';
import type { SourceMap } from '../core/types.js';

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `20-contract.md` §9, I42. Validates against the core's own entry check
 * (`normalizeSourceMap`, reached by relative import into `src/core/` rather than a second copy
 * of §6's rules) so a fault found here and one found by `createJsonLoader` are the same
 * `JsonError`, not two independent checks that can drift. Returns the parsed document, not a
 * normalized one — normalization stays the loader's, once, at construction (I41).
 */
export function parseSourceMap(text: string): SourceMap {
  let parsed: unknown;

  try {
    parsed = loadYaml(text);
  } catch (error) {
    throw new JsonError('config.invalidEntry', `source map: could not parse as YAML — ${errorDetail(error)}`);
  }

  // The one check the core cannot make on its own: its input arrives already typed (I42).
  if (!isRecord(parsed) || !isRecord(parsed.sources)) {
    const detail = isRecord(parsed) ? "missing a 'sources' record" : `got ${JSON.stringify(parsed)}`;
    throw new JsonError('config.invalidEntry', `source map: expected an object with a 'sources' record — ${detail}`);
  }

  const map = parsed as unknown as SourceMap;
  normalizeSourceMap(map);

  return map;
}

/**
 * `20-contract.md` §9, I42. The file half, built on `parseSourceMap`. A read failure —
 * an absent path, a directory, a permission or IO failure — is `config.unreadable`: no bytes
 * arrived, so no id can be named. `parseSourceMap` never raises `config.unreadable`; it is
 * handed text and cannot fail that way (D63).
 */
export async function readSourceMap(path: string): Promise<SourceMap> {
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new JsonError('config.unreadable', `source map '${path}': could not be read — ${errorDetail(error)}`);
  }

  return parseSourceMap(text);
}
