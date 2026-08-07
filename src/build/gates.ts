import { readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { JsonError } from '../core/index.js';
import type { SourceMap } from '../core/index.js';

const PUBLIC_SOURCES_FILE = 'sources.public.yml';
const SERVER_SOURCES_FILE = 'sources.server.yml';

function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * I7, I22: scans `publicDir` as it stands at the moment of the call, so it proves nothing
 * unless it runs after the last write into that directory (`10-design.md` §3.2 step 5).
 */
export function assertNoServerSourcesInBundle(publicDir: string, serverMap: SourceMap): void {
  const files = listFilesRecursive(publicDir);
  for (const id of Object.keys(serverMap.sources)) {
    const leaked = files.find((f) => basename(f, extname(f)) === id);
    if (leaked) {
      throw new JsonError(
        'build.serverSourceLeaked',
        `server source '${id}' (from ${SERVER_SOURCES_FILE}) reached the public output at '${leaked}'`,
      );
    }
  }
}

/** I23: an id declared in both maps fails the build before anything is written. */
export function assertNoDuplicateIds(publicMap: SourceMap, serverMap: SourceMap): void {
  const publicIds = new Set(Object.keys(publicMap.sources));
  for (const id of Object.keys(serverMap.sources)) {
    if (publicIds.has(id)) {
      throw new JsonError(
        'config.duplicateId',
        `source '${id}' is declared in both ${PUBLIC_SOURCES_FILE} and ${SERVER_SOURCES_FILE}`,
      );
    }
  }
}
