# Contract — SubZeroDev.Data.Json

Exact types and invariants. Rationale lives in `10-design.md`; this file is the reference
an implementation is checked against.

All types are exported from the core (`@subzerodev/data-json`) unless a subpath is named.

Sections §1–§9 keep their numbering and invariant ids from the 2026-08-06 draft.
§10–§12 are appended. Amendments made in the 2026-08-07 pass are logged as
`90-decisions.md` D22–D33; the canonical value domain appended later the same day is D40,
which discharges D39's deferral. The 2026-08-08 pass lands the four amendments D42, D43,
D45, and D46 each named as belonging here, and opens U7 and U8 for the two gaps
`30-slices.md` surfaced that no design document determines. A second 2026-08-08 pass — the
first `/reconcile` run against a tree with all four modules implemented — lands D47 (§7, §11,
I21), D48 (I6), D49 (I35, I13), and D50 (I1). Each corrects an invariant the implementation
had shown to be false as written, not a change of intent.

## 1. Result

```ts
/** Unique within a source map, and across the public and server maps together (I23). */
export type SourceId = string;

/** Lowercase hex, 64 digits. Produced only by the core's canonical digest (I5). */
export type Digest = `sha256-${string}`;

export type ReasonCode =
  | 'json.ok'
  | 'json.transport'    // connection failed, DNS, refused, aborted by network
  | 'json.status'       // response received, status not 2xx
  | 'json.timeout'      // exceeded timeoutMs for one attempt
  | 'json.parse'        // body was not valid JSON
  | 'json.schema'       // parsed, failed the declared unwrap or validator
  | 'json.notFound'     // file source: path does not exist
  | 'json.tooLarge'     // body exceeded the declared maxBytes
  | 'json.unresolved';  // no source declared for this id, or a malformed request

export interface JsonMeta {
  readonly id: SourceId;     // '' when the request carried no usable id
  readonly provider: 'http' | 'file' | 'inline' | 'none';   // 'none' when nothing resolved
  readonly location: string; // the location the bytes came from; '' when nothing resolved
  readonly bytes: number;    // UTF-8 byte length as received; 0 for inline
  readonly digest: Digest | null;   // null unless requested
  readonly cached: boolean;
  readonly attempts: number; // transport attempts; 0 for inline and for a cache hit
  readonly validated: boolean;
}

export type JsonResult<T> =
  | { readonly ok: true; readonly reason: 'json.ok'; readonly data: T; readonly meta: JsonMeta }
  | {
      readonly ok: false;
      readonly reason: Exclude<ReasonCode, 'json.ok'>;
      readonly message: string;  // human-facing detail; never load-bearing for control flow
      readonly data: T | null;   // the fallback when one was declared, else null
      readonly meta: JsonMeta;
    };
```

`message` is for humans and logs. Control flow branches on `reason`.

`location` is `''` in two cases, not one: when nothing resolved, and for an `inline` source,
which has no location to record. `provider` is what tells them apart — `'none'` against
`'inline'` — so an exhaustive switch on `provider` never has to read `location` to know which
it is holding.

## 2. Sources

```ts
export type JsonSource =
  | { readonly kind: 'http'; readonly url: string; readonly headers?: Readonly<Record<string, string>> }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'inline'; readonly data: unknown };

/** Sugar accepted in configuration and normalized once, at construction. */
export type SourceSpec = JsonSource | string;

export function normalizeSource(spec: SourceSpec): JsonSource;
```

`normalizeSource` maps a string beginning `http://` or `https://` to `{ kind: 'http' }`
and every other string to `{ kind: 'file' }`. It never produces `inline`; an inline source
must be declared in its object form.

`inline` is the mechanism by which an `at: build` payload reaches a runtime call site:
`prefetch` rewrites every `at: build` entry into an inline entry carrying the resolved data
(§9 `/build`, I33).

## 3. Request

```ts
export type Unwrap = 'none' | 'subzerodev' | ((raw: unknown) => unknown);

/** The value domain the canonical serializer accepts (I35). */
export type CanonicalValue =
  | null
  | boolean
  | string
  | number                          // finite only; NaN and ±Infinity are rejected
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };  // undefined-valued keys are filtered

export type Validator<T> =
  (raw: unknown) =>
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly message: string };

export type CachePolicy =
  | { readonly kind: 'manual' }
  | { readonly kind: 'ttl'; readonly ttlMs: number }   // requires a clock port
  | { readonly kind: 'mtime' };                        // file sources only

export interface RetryPolicy {
  readonly attempts: number;                    // total attempts, not retries; >= 1
  readonly delayMs: number;                     // > 0 requires a schedule port
  readonly backoff?: 'fixed' | 'exponential';   // default 'fixed'
  readonly jitter?: boolean;                    // requires an rng port; default false
}

export interface JsonRequest<T> {
  readonly id: SourceId;
  readonly source?: SourceSpec;      // ad-hoc; never cached, never joined (I16)
  readonly fallback?: T;
  readonly validate?: Validator<T>;
  readonly cache?: false;            // caller-local opt-out; policy is configuration (I31)
  readonly digest?: boolean;         // default false; always true at build
}
```

`Unwrap`'s function form keeps returning `unknown`; `CanonicalValue` states the domain its
return value must fall in, and the domain is enforced at runtime (I36), not by the type. A
value outside it is `json.schema`, on every load and independently of `digest`. The same
bound applies to an `inline` entry's `data`, which is the other way a value that never passed
through `JSON.parse` reaches the pipeline.

A request carries only what belongs to the caller. Everything that shapes the transport —
`unwrap`, `headers`, `timeoutMs`, `retry`, `maxBytes`, and the cache policy — is declared
on the source entry (§6). Two callers reading one id therefore differ only in `fallback`,
`validate`, `digest`, and the cache opt-out, which is what makes the cache key the id
(I16) and the in-flight join safe (I17).

A request supplying its own `source` resolves that source, is neither read from nor written
to the cache, and is never joined to an in-flight load. It receives `unwrap: 'none'`, the
default timeout, one attempt, and no size bound.

`at` is not a request field. A source's `at` value may change without a call site changing
(I9), which a request-level `at` would contradict.

## 4. Ports

```ts
export interface FileSystemPort {
  read(path: string): Promise<string>;
  stat(path: string): Promise<{ readonly mtimeMs: number; readonly size: number }>;
  watch?(path: string, onChange: () => void): () => void;   // returns an unsubscribe
}

/** A cancellable wait. Cancelling settles nothing; it releases the timer. */
export interface ScheduledWait {
  readonly promise: Promise<void>;
  cancel(): void;
}

export interface CacheEntry {
  readonly data: unknown;      // frozen; post-unwrap, pre-validation (I15)
  readonly source: JsonSource; // the declared source; compared on every lookup (I16)
  readonly location: string;   // the location the bytes came from (I30)
  readonly bytes: number;
  digest: Digest | null;       // memoized on first request against this entry (I32)
  readonly storedAt: number | null;   // null when no clock port was supplied
  readonly stamp: { readonly mtimeMs: number; readonly size: number } | null;   // mtime only
}

export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export interface JsonEvent {
  readonly id: SourceId;
  readonly phase: 'resolve' | 'fetch' | 'parse' | 'unwrap' | 'validate' | 'cache';
  readonly reason: ReasonCode;
  readonly meta: JsonMeta;
}

export interface JsonPorts {
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly fs?: FileSystemPort;
  readonly clock?: () => number;                    // required by any ttl policy
  readonly rng?: () => number;                      // required by any retry jitter
  readonly schedule?: (ms: number) => ScheduledWait; // required by any timeout or delay
  readonly cache?: CacheStore;
  readonly log?: (event: JsonEvent) => void;
}
```

No port is required in general. A port whose absence would silently disable a declared
feature is a construction-time error instead (§10, I6).

Cache keys are opaque to the caller and namespaced per loader instance (I29). A loader
never calls `CacheStore.clear()`; `invalidate()` with no argument bumps that loader's
epoch and deletes only its own keys.

There is no hash port. The digest is computed by the core's own SHA-256 so that one
payload has one digest regardless of who loads it (I5, I13).

## 5. Loader

```ts
export interface JsonLoader {
  load<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
  loadById<T>(id: SourceId): Promise<JsonResult<T>>;        // from the source map
  loadMany(ids: readonly SourceId[]): Promise<Readonly<Record<SourceId, JsonResult<unknown>>>>;

  /** Resolve eagerly. Rejects with JsonError('preload.failed') if any id fails. */
  preload(ids: readonly SourceId[]): Promise<void>;

  invalidate(id?: SourceId): void;                          // all this loader owns when omitted
  stats(): { readonly entries: number; readonly hits: number; readonly misses: number };

  /** Unsubscribe every watcher, drop this loader's cache keys. Idempotent. */
  dispose(): void;
  [Symbol.dispose](): void;
}

export function createJsonLoader(sources: SourceMap, ports?: JsonPorts): JsonLoader;
```

`preload` is the only member that rejects. Its guarantee is that every named id resolved
once, at the moment it was called; it does not extend past the cache policy that warmed it.

`dispose` is the only lifecycle member. A watch is registered lazily, on the first
successful read of a file entry declaring an `mtime` policy, and unsubscribed by `dispose`
(I26).

## 6. Configuration

```ts
export type HttpCacheSpec = 'manual' | { readonly ttlMs: number };
export type FileCacheSpec = 'manual' | { readonly ttlMs: number } | { readonly mtime: true };

export interface RetrySpec {
  readonly attempts: number;
  readonly delayMs: number;
  readonly backoff?: 'fixed' | 'exponential';
  readonly jitter?: boolean;
}

interface SourceEntryCommon {
  readonly at: 'build' | 'runtime';
  readonly schema?: string;   // resolved by the consumer's schema registry
  readonly unwrap?: Unwrap;   // default 'none'; YAML expresses only 'none' | 'subzerodev'
}

export type SourceEntry =
  | (SourceEntryCommon & {
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;  // server map only (I7)
      readonly cache: HttpCacheSpec;                        // required; no default (I31)
      readonly timeoutMs?: number;   // default 10_000; bounds each attempt (I18)
      readonly retry?: RetrySpec;    // default { attempts: 1, delayMs: 0 }
      readonly maxBytes?: number;    // unbounded when absent (I27)
      readonly path?: never;
      readonly inline?: never;
    })
  | (SourceEntryCommon & {
      readonly path: string;
      readonly cache: FileCacheSpec;                        // required; no default (I31)
      readonly maxBytes?: number;
      readonly url?: never;
      readonly inline?: never;
    })
  | (SourceEntryCommon & {
      readonly inline: unknown;
      readonly url?: never;
      readonly path?: never;
      readonly cache?: never;        // nothing is transported; a policy would mean nothing
    });

export interface SourceMap {
  readonly version: 1;
  readonly sources: Readonly<Record<SourceId, SourceEntry>>;
}
```

The three variants are narrowed by key presence (`'url' in entry`), not by a tag. Declaring
more than one of `url`, `path`, `inline` is `config.invalidEntry`.

On disk:

```yaml
# config/sources.public.yml
version: 1
sources:
  projects:
    at: build
    url: https://the-running-dev.github.io/Data/portfolio/projects.json
    schema: project
    cache: manual
    maxBytes: 2000000
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
  readonly version: 1;
  readonly sources: Readonly<Record<SourceId, {
    readonly location: string;   // where the bytes came from, not what was requested (I30)
    readonly digest: Digest;
    readonly bytes: number;
  }>>;
}
```

An entry carries these three fields and nothing else. In particular it carries **no
timestamp**: the lockfile is committed so that builds are comparable, and a wall-clock stamp
makes every rebuild a diff, which is the one property the file is committed for (I21, D47).
Anything derived from a clock belongs in build logs, not here.

## 8. Invariants

Each invariant is testable, and the test must fail when the invariant is removed
(`00-brief.md` §7.1). I1–I13 keep their ids; I14 onward were appended in the 2026-08-07 pass.

| | Invariant | Owner |
|---|---|---|
| **I1** | The core imports no module — every specifier in `src/core/` is relative, so no Node builtin and no package. It references no `fs`, `fetch`, `window`, `process`, `Date.now`, `Math.random`, or non-bit-stable `Math.*`. `AbortController` is the one permitted ambient global, and only to cancel a transport attempt. Enforced by the determinism guard in CI, not by review, and the guard covers **both** halves: the ambient globals and the bare-specifier ban, the latter across static imports, dynamic `import()`, and re-exports (D50). | core |
| **I2** | `load()` never throws and never rejects. Every outcome — including a malformed request — is a `JsonResult`. | core |
| **I3** | When `fallback` is supplied, `data` is non-null on every result, `ok` either way. When it is not, `data` is `null` on every failure. | core |
| **I4** | `unwrap` is never inferred from payload shape. Absent means `'none'`, and `'none'` means the parsed body is returned exactly as parsed. | core |
| **I5** | Two payloads that are equal as JSON values produce the same `digest`, regardless of key order or whitespace. Two that differ produce different digests. | core |
| **I6** | Every port a supplied entry needs is present at construction, or `createJsonLoader` throws `JsonError('config.missingPort')` naming the entry and the port: `fetch` for an http entry, `fs` for a file entry, `clock` for a `ttl` policy, `rng` for retry jitter, `schedule` for a timeout or a non-zero delay. The check covers exactly the entries in the map supplied, never a wider set. Never a silent downgrade. **One clause is deliberately map-independent** (D48): a supplied `fetch` port requires a `schedule` port alongside it even where no entry declares an http source, because an ad-hoc `JsonRequest.source` (§3) can name an http URL the map never mentions and carries the default timeout. Where neither port is supplied the ad-hoc attempt runs unbounded and fails on the absent `fetch`; it never throws, because I2 admits no exception. | core |
| **I7** | `headers` may be declared only in `sources.server.yml`; declaring them in the public map is `config.invalidEntry`. The build gate's guarantee is **filename-scoped**: no file whose basename is a server-map source id appears in the public output directory. That catches a prefetched artifact written where a browser can read it, and nothing else — a server URL or a declared header name inlined into a JS chunk passes it (D46). Asserted in CI. Widening the gate to a content scan is issue #37 and is not contracted here. | build |
| **I8** | An `at: build` source is never fetched at runtime; an `at: runtime` source is never resolved at build. `prefetch` constructs its loader over the map filtered to its `at: build` entries, so a build demands under I6 exactly the ports the entries it resolves need, and never a port for an `at: runtime` entry it is guaranteed not to touch. | build |
| **I9** | A source's `at` value may change without any call site changing. | core, build |
| **I10** | `meta.validated` is `true` only when a validator ran in this call and returned `ok`. Absent validator means `false`, never `true`. | core |
| **I11** | `meta.attempts` equals the number of transport attempts, `1` on a first-try success, and `0` for `inline` and for a cache hit. A joined caller reports the attempts made by the load it joined, with `cached: false`. | core |
| **I12** | A cache hit returns data equal to the first success for an equal validator, and `meta.cached` is `true`. | core |
| **I13** | The core's canonical serializer is byte-identical to `src/engine/src/core/persistence/canonical.ts` on that module's test vectors, and rejects exactly the values that module rejects — **except that it may reject strictly more**, never less (D49). D39 read that module at `f7d8f59` and recorded no non-plain-object vector, so whether it rejects a `Date` is unknown and is not to be guessed at; this package rejects one. Stricter is the safe direction under D39's own argument, since J9 swaps this implementation in beneath the engine's determinism acceptance test. Message text is not compared — a rejection is compared as a rejection. Cross-checked until J9, when the engine's copy is deleted. | core |
| **I14** | Every value `load` returns is deeply frozen — on a miss, with caching off, after a validator transform, and on a fallback. Mutability never depends on a cache policy the call site cannot see. | core |
| **I15** | The cache line holds the post-unwrap, pre-validation value. Validation runs per call against it, so `validated` is a property of the call and never of the entry. | core |
| **I16** | The cache key is the source id, scoped to the loader instance. An entry records the `JsonSource` it was declared as, and a lookup is a hit only where that source equals the one the request resolves to — for an http source, url and headers both. *Elsewhere* means a **different declared source, never a different final URL**: a source that redirects caches under the id it was declared as, and `location` keeps its I30 meaning untouched. A request supplying its own `source` is neither read from, written to, nor joined against the cache. | core |
| **I17** | Concurrent misses for one key issue one transport. The rest join it and receive the same frozen value. A load compares the generation it started under before storing; on a mismatch it returns its result and writes nothing. | core |
| **I18** | Retry applies only to `json.transport`, `json.timeout`, and statuses 408, 429, and 5xx. Never to other 4xx, `json.parse`, `json.schema`, `json.notFound`, or `json.tooLarge`. `timeoutMs` bounds each attempt, never the call. | core |
| **I19** | A failed load neither populates nor evicts the cache. A stale entry is not a hit and is not deleted. A declared `fallback` is the only path by which a caller receives data it did not just read. | core |
| **I20** | `preload` and `prefetch` resolve every id before failing, and name every failed id in `JsonError.failures`. Never only the first. | core, build |
| **I21** | Lockfile entries are emitted in sorted-id order through the canonical serializer. Two builds over unchanged bytes produce a byte-identical lockfile — compared whole, with nothing excluded. No lock entry carries a clock-derived field, because one field that legitimately differs run to run is enough to defeat this (D47). | build |
| **I22** | The public/server gate runs after the last write into the public output directory. | build |
| **I23** | An id appearing in both the public and the server map is `JsonError('config.duplicateId')` and fails the build. | build |
| **I24** | Nothing in this package throws a bare `Error` or a string. Every throw and every rejection is a `JsonError` carrying an enumerated `code`. `load` still throws nothing at all (I2). | core, node, build |
| **I25** | An `mtime` stamp is captured before the read, never after. A null stamp is never a hit. An `mtime` policy on a non-file entry is `config.invalidEntry`. | core, node |
| **I26** | Every watcher a loader registered is unsubscribed by `dispose()`. A watch is registered lazily on first successful read, never at construction. After `dispose`, the process is not held open by this loader. | core, node |
| **I27** | A body exceeding a declared `maxBytes` — measured against `Content-Length` where present, and against the decoded length always — yields `json.tooLarge`, is not retried, and writes nothing to the cache. Where a declared `Content-Length` is what refused it, `meta.bytes` carries that declared length: no body was received to measure, and the declared length is the number the refusal was made on. | core |
| **I28** | The router maps reason to status and never forwards the upstream status: `json.unresolved` and `json.notFound` to 404; `json.timeout` and `json.transport` to 504; `json.status`, `json.parse`, `json.schema`, and `json.tooLarge` to 502. Its failure body is `{ success: false, message }` carrying the result's own `message` — the field the core's `'subzerodev'` unwrap reads (I34), so a data-json client of a data-json server receives the real text rather than generic fallback prose (D45). | node |
| **I29** | One `CacheStore` handed to two loaders serves neither loader the other's entries, and `invalidate` on either leaves the other's entries intact. | core |
| **I30** | `meta.location` and `JsonLock.sources[].location` record the location the bytes came from, not the location that was requested. | core, build |
| **I31** | `cache` is required on every http and file entry and forbidden on an inline entry. There is no default cache policy. Omitting it is `config.invalidEntry` naming the id. | core |
| **I32** | A `digest: true` request against an entry stored without one computes the digest from the cached value and memoizes it. It never re-transports, and never returns `digest: null` under `ok: true`. | core |
| **I33** | `prefetch` emits a `SourceMap` in which every `at: build` entry has become an inline entry carrying the resolved data. A runtime loader constructed from it resolves those ids without any port, and `10-design.md` §3.1's pipeline never branches on `at`. The rewritten entry keeps `at` and `schema` and carries none of `unwrap`, `cache`, `maxBytes`, `timeoutMs`, or `retry`: the data is already unwrapped, and an inline entry transports nothing for any of them to govern (I31 forbids `cache` there outright). | build |
| **I34** | An `unwrap: 'subzerodev'` envelope whose `success` is `false` yields `json.schema`, with the envelope's own error text in `message`. `ok: true` with `data: undefined` is unreachable. | core |
| **I35** | The canonical serializer accepts exactly `CanonicalValue` (§3). At any depth it filters `undefined`-valued object keys, and rejects a non-finite number, a bare `undefined`, a `bigint`, a symbol, a function, and **any object that is not a plain record** — one whose prototype is neither `Object.prototype` nor `null`, such as a `Date`, `Map`, `Set`, `RegExp`, or class instance (D49). Rejection is a throw. The serializer is pure: it reaches no port and no ambient global. | core |
| **I36** | The post-unwrap value is checked against I35's domain on every load — before it is frozen, before it is cached, and independently of `digest`. A value outside the domain yields `json.schema` and writes nothing to the cache. No cache entry ever holds an out-of-domain value, so I32's memoized digest never throws, and `digest` never changes a result's `ok`. | core |

## 9. Subpath Exports

```ts
// @subzerodev/data-json/node
export function nodeFileSystem(): FileSystemPort;
export function nodePorts(overrides?: Partial<JsonPorts>): JsonPorts;

/** Structural, so /node depends on no web framework. Compatible with an Express handler. */
export type JsonRouteHandler = (
  req: { readonly method: string; readonly params: Readonly<Record<string, string>> },
  res: { status(code: number): { json(body: unknown): void } },
  next: (err?: unknown) => void
) => void;

export function jsonRouter(loader: JsonLoader, ids: readonly SourceId[]): JsonRouteHandler; // GET only
export function envelope<T>(data: T): { readonly success: true; readonly data: T };
export function convertYamlToJson(from: string, to: string): Promise<number>;    // CLI core

// @subzerodev/data-json/zod
export function zodValidator<T>(schema: ZodType<T>): Validator<T>;

// @subzerodev/data-json/build
export interface PrefetchOutput {
  readonly lock: JsonLock;
  readonly runtimeMap: SourceMap;   // at: build entries rewritten to inline (I33)
}

export function prefetch(map: SourceMap, outDir: string, ports: JsonPorts): Promise<PrefetchOutput>;
export function assertNoServerSourcesInBundle(publicDir: string, serverMap: SourceMap): void;
export function assertNoDuplicateIds(publicMap: SourceMap, serverMap: SourceMap): void;
```

`jsonRouter` mounts GET routes only. The package writes nothing at runtime
(`00-brief.md` §5.1); `/build` writes with the Node runtime directly and the filesystem
port stays read-only (`90-decisions.md` D19).

The `'subzerodev'` literal stays in the core because it is declared in configuration and
the core reads configuration; `/node` owns the producer (`envelope`) for the success half
and `jsonRouter` emits the failure half (I28). J2.5's round-trip test is what keeps the two
ends agreeing, and it covers both halves — a test written to catch a shape divergence that
exercises only the success side is how D45's divergence survived.

`@subzerodev/data-json/react` is blocked — see §12 U1.

## 10. Error semantics

Two vocabularies, both closed. `ReasonCode` (§1) is the outcome of a load and never throws.
`JsonErrorCode` is the outcome of a misconfiguration or an eager resolution, and is the only
thing this package throws or rejects with (I24).

```ts
export interface JsonFailure {
  readonly id: SourceId;
  readonly reason: ReasonCode;
  readonly message: string;
}

export type JsonErrorCode =
  | 'config.missingPort'
  | 'config.invalidEntry'
  | 'config.duplicateId'
  | 'preload.failed'
  | 'build.failed'
  | 'build.serverSourceLeaked';

export class JsonError extends Error {
  readonly code: JsonErrorCode;
  readonly failures: readonly JsonFailure[];   // empty for the config.* codes
  constructor(code: JsonErrorCode, message: string, failures?: readonly JsonFailure[]);
}
```

### 10.1 `JsonErrorCode`

| Code | Raised by | When | Retryable | Caller does |
|---|---|---|---|---|
| `config.missingPort` | core, at `createJsonLoader` | An entry in the supplied map needs a port that was not passed (I6) | No | Fix the composition root. The loader does not exist |
| `config.invalidEntry` | core, at `createJsonLoader`; `/node` when reading YAML | Missing `at`, missing `cache` on an http or file entry, `cache` on an inline entry, more than one of `url`/`path`/`inline`, `mtime` on a non-file entry, `retry.attempts < 1`, or `version` not `1` | No | Fix the source map. The message names the id and the field |
| `config.duplicateId` | `/build`, across the two maps | An id declared in both the public and the server map (I23). The core does not raise this and cannot: duplicate keys within one `SourceMap` collapse before it sees them | No | Rename one. The message names the id and both files |
| `preload.failed` | core, from `preload` | One or more ids failed to resolve (I20) | Per `failures[].reason` — see §10.2 | Refuse to boot, exit non-zero, and report every entry in `failures` |
| `build.failed` | `/build`, from `prefetch` | One or more `at: build` sources failed (I20) | Per `failures[].reason` | Fail the build. Nothing was written; the previous output is untouched |
| `build.serverSourceLeaked` | `/build`, from `assertNoServerSourcesInBundle` | A file named for a server-map source id is present in the public output — the filename-scoped half of I7, run after the last write (I22) | No | Fail the build and remove the leak. Output is present but rejected |

### 10.2 `ReasonCode`

| Code | Raised when | Retried by the loader | Caller does |
|---|---|---|---|
| `json.ok` | The value resolved | — | Use `data` |
| `json.transport` | The fetch port rejected, or the filesystem port failed on permission or IO | Yes, while attempts remain | Treat as an outage. Quiet handling; the payload is fine |
| `json.status` | A response arrived with a non-2xx status | Only 408, 429, 5xx | 408/429/5xx is an outage; any other status is a misconfigured URL |
| `json.timeout` | No response inside one attempt's budget | Yes, while attempts remain | As `json.transport` |
| `json.parse` | The body was not JSON, or was empty | No | Loud. The upstream is serving something other than what was declared |
| `json.schema` | A declared unwrap could not produce a value, a `'subzerodev'` envelope reported `success: false` (I34), a caller-supplied unwrap threw or returned a value outside `CanonicalValue` (I35, I36), an `inline` entry carried such a value, or a validator returned not-ok or threw | No | Loud. The payload changed shape, or this caller's schema, unwrap, or inline entry is wrong. `message` names which. The cache entry stands |
| `json.notFound` | A file source's path does not exist | No | The path is wrong, or the file has not been produced yet |
| `json.tooLarge` | The body exceeded a declared `maxBytes` (I27) | No | Loud. Raise the bound deliberately or fix the upstream |
| `json.unresolved` | The id is absent from the map, or the request is malformed | No | A programming or configuration error. `meta.provider` is `'none'` |

`message` carries human detail for every one of these and is never load-bearing.

## 11. Persisted schemas and migration

Four persisted things. Only the first is written by a human.

| Artifact | Shape | Key | Constraints | Migration |
|---|---|---|---|---|
| **Source maps** — `sources.public.yml`, `sources.server.yml` | §6 `SourceMap` | `SourceId`, unique across both files (I23) | `version: 1`; `at` and `cache` required; `headers` only in the server file (I7) | No prior version exists. A `version` other than `1` is `config.invalidEntry`. J6.4 and J6.6 create these by hand, one migration decision per source |
| **Prefetched artifacts** — one per `at: build` source | The resolved post-unwrap value, canonically serialized | `SourceId` | Regenerable from the source map | None. Every build rewrites all of them; a stale artifact is overwritten wholesale. Never hand-edited, never merged |
| **Derived runtime map** — emitted by `prefetch` | §6 `SourceMap`, `at: build` entries rewritten to inline (I33) | `SourceId` | Build output; never hand-edited | None. Regenerated with the artifacts |
| **Lockfile** — `json.lock` | §7 `JsonLock` | `SourceId`, sorted (I21) | `version: 1`; `digest` matches `Digest`; no clock-derived field (D47); committed so builds are comparable | Regenerable. A change to what `digest` covers invalidates every entry (`90-decisions.md` D14, expensive) and is migrated by rebuilding and committing the whole diff, not by rewriting entries |

The cache is in-memory, per loader, per process, and never persisted (`10-design.md` §5).
It has no schema and no migration story, which is why `invalidate` can be a counter rather
than a protocol.

## 12. Unresolved

Six items the design does not determine. Each blocks the work named; none is invented here.
U7 and U8 are `30-slices.md`'s "contract gaps this pass surfaced" 2 and 1, moved to the
register that owns them — that section recorded them, this one is where they are answered.

| | Item | Blocks |
|---|---|---|
| **U1** | **How `useJson(id)` reaches a `JsonLoader`.** `10-design.md` §2 gives `/react` only `useJson` and `JsonBoundary`. A context provider, or a loader parameter, is a new public interface, and the design names neither. The two signatures from the 2026-08-06 draft stand unchanged and are not implementable until this is decided. | J4 |
| **U2** | **Redirect policy** (`90-decisions.md` O15). No redirect mode is specified, so a fetch port follows by default, and only `Authorization`, `Cookie`, and `Proxy-Authorization` are stripped cross-origin — a declared `X-Api-Key` reaches a different origin. I30 settles what `location` records; whether redirects are followed, and what happens to declared headers across an origin change, is undetermined. | J1, J3 |
| **U5** | **A concurrency bound for eager resolution** (`90-decisions.md` O5, O17). `10-design.md` §5 states fan-out is unbounded and records the smallness of a source map as an assumption rather than a guarantee. `loadMany` takes a caller-sized array, which that assumption does not reach. No bound is specified, so none is contracted. | J1, J3 |
| **U6** | **`stats()` reports hits, misses, and entries only** (`90-decisions.md` O3). Nothing about eviction or size pressure. Adequate until a consumer caches enough to care; stated so that it is a known limit rather than an oversight. | — |
| **U7** | **No public canonical serializer** (`30-slices.md` gap 2, `90-decisions.md` D44). J9.1 has the engine import this package's canonical serialization and delete its own copy, retiring I13's duplication. `10-design.md` §2 lists canonical serialization among what the core *owns* and exposes only `load`, the loader factory, source normalization, and the types — it determines neither which functions become public (`canonicalize` alone, or `digestOf` and `sha256Hex` with it) nor their signatures. Not invented here: adding an export later is additive, removing one after publication is not, and 0.1.0 is unpublished. D44 routes the three the core index exports today to `/fix` for removal, precisely so this is decided against J9.1's stated requirement rather than against whatever a slice happened to export. | J9 |
| **U8** | **Nothing turns `sources.*.yml` into a `SourceMap`** (`30-slices.md` gap 1). §10.1 names `/node` as raising `config.invalidEntry` "when reading YAML", but §9 exports no reader — `convertYamlToJson(from, to)` converts files, not configuration, and `10-design.md` §2 gives `/node` only "the YAML→JSON conversion the CLI wraps". A reader's return type, its error surface, and whether it validates the parsed map against §6 before returning are all undetermined. J3.1 takes a `SourceMap` already in memory and J6.4 puts sources into YAML, so something has to bridge them; until that signature is designed, §10.1's `/node`-reading-YAML clause names a raiser that does not exist. | J6 |

**U3 is resolved.** The parser is `js-yaml` `^4.1.0` on its `DEFAULT_SCHEMA`, a `dependencies`
entry resolved only by `/node`'s subpath (`90-decisions.md` D41, which names the alternatives
rejected and why). `10-design.md` §7 Q3's recommended *shape* — a normal dependency of `/node`
only, leaving the core at zero — is what shipped. The id is retired, not reused.

**U4 is resolved.** The engine's serializer has been read and cross-checked
(`90-decisions.md` D39); its key ordering, escaping, and number formatting are verified
identical, and its value domain is now this package's own (I35). The id is retired, not
reused — D39 and issue #17 cite it.
