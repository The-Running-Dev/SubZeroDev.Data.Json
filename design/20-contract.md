# Contract — SubZeroDev.Data.Json

Exact types and invariants. Rationale lives in `10-design.md`; this file is the reference
an implementation is checked against.

All types are exported from the core (`@subzerodev/data-json`) unless a subpath is named.

## 1. Result

```ts
export type ReasonCode =
  | 'json.ok'
  | 'json.transport'    // connection failed, DNS, refused, aborted by network
  | 'json.status'       // response received, status not 2xx
  | 'json.timeout'      // exceeded timeoutMs
  | 'json.parse'        // body was not valid JSON
  | 'json.schema'       // parsed, failed the declared validator
  | 'json.notFound'     // file source: path does not exist
  | 'json.unresolved';  // no source declared for this id

export interface JsonMeta {
  id: string;
  provider: 'http' | 'file' | 'inline';
  location: string;          // url, path, or '<inline>'
  bytes: number;             // 0 when nothing was read
  digest: string | null;     // 'sha256-<hex>' over canonical bytes; null unless requested
  cached: boolean;
  attempts: number;          // 1 for a first-try success
  validated: boolean;        // true only when a validator ran and passed
}

export type JsonResult<T> =
  | { ok: true;  reason: 'json.ok'; data: T; meta: JsonMeta }
  | {
      ok: false;
      reason: Exclude<ReasonCode, 'json.ok'>;
      message: string;       // human-facing detail; never load-bearing for control flow
      data: T | null;        // the fallback when one was declared, else null
      meta: JsonMeta;
    };
```

`message` is for humans and logs. Control flow branches on `reason`.

## 2. Sources

```ts
export type JsonSource =
  | { kind: 'http'; url: string; headers?: Readonly<Record<string, string>> }
  | { kind: 'file'; path: string }
  | { kind: 'inline'; data: unknown };

/** Sugar accepted in configuration and normalized once, at construction. */
export type SourceSpec = JsonSource | string;

export function normalizeSource(spec: SourceSpec): JsonSource;
```

`normalizeSource` maps a string beginning `http://` or `https://` to `{ kind: 'http' }`
and every other string to `{ kind: 'file' }`. It never produces `inline`; an inline source
must be declared in its object form.

## 3. Request

```ts
export type Unwrap = 'none' | 'subzerodev' | ((raw: unknown) => unknown);

export type Validator<T> =
  (raw: unknown) => { ok: true; value: T } | { ok: false; message: string };

export type CachePolicy =
  | { kind: 'manual' }
  | { kind: 'ttl'; ttlMs: number }      // requires a clock port
  | { kind: 'mtime' };                  // file sources only

export interface RetryPolicy {
  attempts: number;                     // total attempts, not retries; >= 1
  delayMs: number;
  backoff?: 'fixed' | 'exponential';    // default 'fixed'
  jitter?: boolean;                     // requires an rng port; default false
}

export interface JsonRequest<T> {
  id: string;
  source: SourceSpec;
  at: 'build' | 'runtime';
  fallback?: T;
  unwrap?: Unwrap;                      // default 'none'
  validate?: Validator<T>;
  cache?: CachePolicy | false;          // default { kind: 'manual' }
  timeoutMs?: number;                   // http only; default 10_000
  retry?: RetryPolicy;                  // default { attempts: 1, delayMs: 0 }
  digest?: boolean;                     // default false; true at build
}
```

## 4. Ports

```ts
export interface FileSystemPort {
  read(path: string): Promise<string>;
  stat(path: string): Promise<{ mtimeMs: number; size: number }>;
  watch?(path: string, onChange: () => void): () => void;   // returns an unsubscribe
}

export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export interface CacheEntry {
  data: unknown;
  meta: JsonMeta;
  storedAt: number | null;              // null when no clock port was supplied
  stamp: { mtimeMs: number; size: number } | null;   // mtime policy only
}

export interface JsonEvent {
  id: string;
  phase: 'resolve' | 'fetch' | 'parse' | 'unwrap' | 'validate' | 'cache';
  reason: ReasonCode;
  meta: JsonMeta;
}

export interface JsonPorts {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  fs?: FileSystemPort;
  clock?: () => number;                 // required iff any source uses a ttl policy
  rng?: () => number;                   // required iff any retry uses jitter
  cache?: CacheStore;
  log?: (event: JsonEvent) => void;
}
```

No port is required. An absent port disables exactly the features that need it, and the
two cases where that would be silent — `ttl` without `clock`, `jitter` without `rng` — are
construction-time errors instead (§7 I6).

## 5. Loader

```ts
export interface JsonLoader {
  load<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
  loadById<T>(id: string): Promise<JsonResult<T>>;          // from the source map
  loadMany(ids: readonly string[]): Promise<Record<string, JsonResult<unknown>>>;

  /** Resolve eagerly. Rejects if any id fails — the composition root's fail-fast. */
  preload(ids: readonly string[]): Promise<void>;

  invalidate(id?: string): void;                            // all when omitted
  stats(): { entries: number; hits: number; misses: number };
}

export function createJsonLoader(
  sources: SourceMap,
  ports?: JsonPorts
): JsonLoader;
```

`preload` is the only member that rejects. It exists so a server can refuse to boot rather
than serve 500s on first request.

## 6. Configuration

```ts
export interface SourceMap {
  version: 1;
  sources: Record<string, SourceEntry>;
}

export interface SourceEntry {
  at: 'build' | 'runtime';
  url?: string;                         // exactly one of url | path | inline
  path?: string;
  inline?: unknown;
  headers?: Record<string, string>;     // server file only
  unwrap?: 'none' | 'subzerodev';
  schema?: string;                      // resolved by the consumer's schema registry
  cache?: { ttlMs: number } | { mtime: true } | 'manual';
  timeoutMs?: number;
  retry?: { attempts: number; delayMs: number; backoff?: 'fixed' | 'exponential' };
}
```

On disk:

```yaml
# config/sources.public.yml
version: 1
sources:
  projects:
    at: build
    url: https://the-running-dev.github.io/Data/portfolio/projects.json
    schema: project
  liveStatus:
    at: runtime
    url: https://api.example.com/v1/status
    unwrap: subzerodev
    cache: { ttlMs: 300000 }
```

`config/sources.server.yml` has the identical shape and is the only file permitted to carry
`headers`.

## 7. Lockfile

Written by `/build` for every `at: build` source.

```ts
export interface JsonLock {
  version: 1;
  sources: Record<string, {
    location: string;
    digest: string;        // 'sha256-<hex>' over canonical bytes
    bytes: number;
    resolvedAt: string;    // ISO 8601, informational only — never an input
  }>;
}
```

`resolvedAt` is metadata for humans. Nothing reads it, and no behaviour may depend on it —
that is what keeps the lockfile comparable across builds.

## 8. Invariants

Each invariant is testable, and the test must fail when the invariant is removed
(`00-brief.md` §7.1).

| | Invariant |
|---|---|
| **I1** | The core imports no module. It references no `fs`, `fetch`, `window`, `process`, `Date.now`, `Math.random`, or non-bit-stable `Math.*`. Enforced by the determinism guard in CI, not by review. |
| **I2** | `load()` never throws and never rejects. Every outcome — including a malformed request — is a `JsonResult`. |
| **I3** | When `fallback` is supplied, `data` is non-null on every result, `ok` either way. When it is not, `data` is `null` on every failure. |
| **I4** | `unwrap` is never inferred from payload shape. Absent means `'none'`, and `'none'` means the parsed body is returned exactly as parsed. |
| **I5** | Two payloads that are equal as JSON values produce the same `digest`, regardless of key order or whitespace. Two that differ produce different digests. |
| **I6** | A `ttl` cache policy without a `clock` port, or `jitter` without an `rng` port, throws at `createJsonLoader`. Never a silent downgrade. |
| **I7** | No entry originating in `sources.server.yml` appears in any artifact reachable by a browser bundle. Asserted in CI. |
| **I8** | An `at: build` source is never fetched at runtime; an `at: runtime` source is never resolved at build. |
| **I9** | A source's `at` value may change without any call site changing. |
| **I10** | `meta.validated` is `true` only when a validator ran and returned `ok`. Absent validator means `false`, never `true`. |
| **I11** | `meta.attempts` equals the number of transport attempts made, and is `1` on a first-try success and `0` for `inline`. |
| **I12** | A cache hit returns data equal to the first success, and `meta.cached` is `true`. Cached values are frozen; a consumer mutating a returned object cannot affect a later read. |
| **I13** | The core's canonical serializer is byte-identical to `src/engine/src/core/persistence/canonical.ts` on that module's test vectors. Cross-checked until J9, when the engine's copy is deleted. |

## 9. Subpath Exports

```ts
// @subzerodev/data-json/node
export function nodeFileSystem(): FileSystemPort;
export function nodePorts(overrides?: Partial<JsonPorts>): JsonPorts;
export function jsonRouter(loader: JsonLoader, ids: readonly string[]): Handler; // GET only
export function envelope<T>(data: T): { success: true; data: T };
export function convertYamlToJson(from: string, to: string): Promise<number>;    // CLI core

// @subzerodev/data-json/react
export function useJson<T>(id: string): JsonResult<T> & { loading: boolean; refetch(): Promise<void> };
export function JsonBoundary(props: { id: string; fallback?: ReactNode; children: ReactNode }): ReactElement;

// @subzerodev/data-json/zod
export function zodValidator<T>(schema: ZodType<T>): Validator<T>;

// @subzerodev/data-json/build
export function prefetch(map: SourceMap, outDir: string, ports: JsonPorts): Promise<JsonLock>;
export function assertNoServerSourcesInBundle(publicDir: string, serverMap: SourceMap): void;
```

`jsonRouter` mounts GET routes only. The package writes nothing (`00-brief.md` §5.1).
