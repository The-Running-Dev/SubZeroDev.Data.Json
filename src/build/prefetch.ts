import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalize, createJsonLoader, JsonError } from '../core/index.js';
import { normalizeSourceMap } from '../core/config.js';
import type { Digest, JsonFailure, JsonLock, JsonPorts, SourceEntry, SourceId, SourceMap } from '../core/index.js';

export interface PrefetchOutput {
  readonly lock: JsonLock;
  readonly runtimeMap: SourceMap;
}

interface Resolved {
  readonly data: unknown;
  readonly digest: Digest;
  readonly bytes: number;
  readonly location: string;
}

/**
 * `10-design.md` §3.2: resolves every `at: build` entry with a digest, writes nothing until
 * every one of them has resolved (I20, D17), then writes one artifact per source and the
 * lockfile — both through the canonical serializer, in sorted-id order (I21). `at: runtime`
 * entries are read but never resolved (I8) and pass into `runtimeMap` unchanged; every
 * resolved `at: build` entry becomes `{ inline: <resolved data> }` there (I33, D24).
 */
export async function prefetch(map: SourceMap, outDir: string, ports: JsonPorts): Promise<PrefetchOutput> {
  // The loader below is constructed over a filtered map (at:runtime entries excluded, so I6's
  // port checks never fire for ports prefetch never uses), which means normalizeSourceMap never
  // sees those entries through createJsonLoader. Validate the full map's structure here first,
  // so a malformed at:runtime entry still fails fast instead of reaching runtimeMap unchecked.
  normalizeSourceMap(map);

  const buildIds = Object.entries(map.sources)
    .filter(([, entry]) => entry.at === 'build')
    .map(([id]) => id);

  const loaderMap: SourceMap = {
    version: map.version,
    sources: Object.fromEntries(
      Object.entries(map.sources).filter(([, entry]) => entry.at !== 'runtime'),
    ),
  };
  const loader = createJsonLoader(loaderMap, ports);

  const results = await Promise.all(buildIds.map((id) => loader.load({ id, digest: true })));

  const failures: JsonFailure[] = [];
  const resolved = new Map<SourceId, Resolved>();

  buildIds.forEach((id, i) => {
    const result = results[i]!;
    if (!result.ok) {
      failures.push({ id, reason: result.reason, message: result.message });
    } else {
      resolved.set(id, {
        data: result.data,
        digest: result.meta.digest!,
        bytes: result.meta.bytes,
        location: result.meta.location,
      });
    }
  });

  if (failures.length > 0) {
    throw new JsonError(
      'build.failed',
      `build failed for ${failures.length} source(s): ${failures.map((f) => f.id).join(', ')}`,
      failures,
    );
  }

  await mkdir(outDir, { recursive: true });

  const sortedIds = [...resolved.keys()].sort();
  const resolvedAt = new Date().toISOString();
  const lockSources: Record<SourceId, JsonLock['sources'][string]> = {};

  for (const id of sortedIds) {
    const entry = resolved.get(id)!;
    await writeFile(join(outDir, `${id}.json`), canonicalize(entry.data), 'utf8');
    lockSources[id] = {
      location: entry.location,
      digest: entry.digest,
      bytes: entry.bytes,
      resolvedAt,
    };
  }

  const lock: JsonLock = { version: 1, sources: lockSources };
  await writeFile(join(outDir, 'json.lock'), canonicalize(lock), 'utf8');

  const runtimeSources: Record<SourceId, SourceEntry> = {};
  for (const [id, entry] of Object.entries(map.sources)) {
    if (entry.at === 'build') {
      const data = resolved.get(id)!.data;
      runtimeSources[id] = {
        at: 'build',
        inline: data,
        ...(entry.schema !== undefined ? { schema: entry.schema } : {}),
      };
    } else {
      runtimeSources[id] = entry;
    }
  }

  return { lock, runtimeMap: { version: 1, sources: runtimeSources } };
}
