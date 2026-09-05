import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { JsonError } from '../core/index.js';
import type { SourceMap } from '../core/index.js';

const PUBLIC_SOURCES_FILE = 'sources.public.yml';
const SERVER_SOURCES_FILE = 'sources.server.yml';

/**
 * I44: a header value below this length is not scanned. `Bearer` and `true` are not credentials,
 * and they are the only header values short enough to collide with ordinary bundle text.
 */
const MIN_SCANNED_HEADER_VALUE = 8;

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

/** What matched, for the failure message. Never the matched text itself (I44). */
type LeakClass = 'url' | 'header value';

interface Needle {
  readonly id: string;
  readonly kind: LeakClass;
  readonly text: string;
}

const ESCAPE_SEQUENCE = /\\(u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g;

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

/**
 * I44: undo the common JSON and JS string escapes a bundler emits, so that a URL written
 * `https:\/\/internal.example.com\/config` or `/`-encoded is not a miss. Single-pass by
 * construction: `\\/` decodes to a literal backslash followed by a solidus, not to `/`.
 */
function decodeStringEscapes(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, (_match, sequence: string) => {
    if (sequence.startsWith('u{')) {
      const code = Number.parseInt(sequence.slice(2, -1), 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : sequence;
    }
    if (sequence.startsWith('u') || sequence.startsWith('x')) {
      return String.fromCharCode(Number.parseInt(sequence.slice(1), 16));
    }
    return SHORT_ESCAPES[sequence] ?? sequence;
  });
}

/**
 * I44: the origin-and-path prefix of a URL, so that output which kept the endpoint but rewrote
 * the query string still trips. Undefined where the URL does not parse — the whole string is
 * scanned regardless, so an unparseable URL loses only the prefix half.
 */
function originAndPath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

/**
 * I44: header *names* are deliberately absent. A name is not a secret, and `Authorization`
 * ships inside any HTTP client in the bundle — scanning names would find the one candidate
 * whose presence is not a leak while being the only one that collides.
 */
function contentNeedles(serverMap: SourceMap): Needle[] {
  const needles: Needle[] = [];
  for (const [id, entry] of Object.entries(serverMap.sources)) {
    if (typeof entry.url !== 'string' || entry.url.length === 0) continue;

    const urls = new Set<string>([entry.url]);
    const prefix = originAndPath(entry.url);
    if (prefix !== undefined) urls.add(prefix);
    for (const text of urls) needles.push({ id, kind: 'url', text });

    for (const value of Object.values(entry.headers ?? {})) {
      if (value.length >= MIN_SCANNED_HEADER_VALUE) needles.push({ id, kind: 'header value', text: value });
    }
  }
  return needles;
}

/**
 * I7, I22, I44: scans `publicDir` as it stands at the moment of the call, so it proves nothing
 * unless it runs after the last write into that directory (`10-design.md` §3.2 step 5).
 *
 * Two checks under one name: the filename scope (I7) and the content scan (I44). Neither
 * subsumes the other. The content scan catches *accidental* inlining and not an adversary — an
 * occurrence split across concatenation or base64-encoded passes clean, and no scan over output
 * bytes can change that (D72).
 */
export function assertNoServerSourcesInBundle(publicDir: string, serverMap: SourceMap): void {
  const files = listFilesRecursive(publicDir).sort();

  for (const id of Object.keys(serverMap.sources)) {
    const leaked = files.find((f) => basename(f, extname(f)) === id);
    if (leaked) {
      throw new JsonError(
        'build.serverSourceLeaked',
        `server source '${id}' (from ${SERVER_SOURCES_FILE}) reached the public output at '${leaked}'`,
      );
    }
  }

  const needles = contentNeedles(serverMap);
  if (needles.length === 0) return;

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const decoded = raw.includes('\\') ? decodeStringEscapes(raw) : raw;
    for (const needle of needles) {
      if (raw.includes(needle.text) || (decoded !== raw && decoded.includes(needle.text))) {
        // The matched text is never in the message: a gate that prints a header value writes
        // the credential into the CI log it was raised to protect (I44).
        throw new JsonError(
          'build.serverSourceLeaked',
          `server source '${needle.id}' (from ${SERVER_SOURCES_FILE}) reached the public output: ` +
            `its ${needle.kind} appears in the contents of '${file}'`,
        );
      }
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
