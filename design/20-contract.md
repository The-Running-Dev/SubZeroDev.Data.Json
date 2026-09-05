# Contract — SubZeroDev.Data.Json

Invariants, error semantics, and the surface the tree cannot state. Rationale lives in
`10-design.md`; this file is the reference an implementation is checked against.

All types are exported from the core (`subzerodev-data-json`) unless a subpath is named.

**Where a declaration exists in the tree, this file points at it rather than repeating it**
(`AGENTS.md`, *Single ownership*). What each section carries is the part a declaration cannot
express: which fields are meaningful under which state, what must never be normalised away,
what a caller may not assume. §8, §10.1 and §10.2 are wholly of that kind and point at nothing.

Sections §1–§9 keep their numbering and invariant ids from the 2026-08-06 draft.
§10–§12 are appended. Amendments made in the 2026-08-07 pass are logged as
`90-decisions.md` D22–D33; the canonical value domain appended later the same day is D40,
which discharges D39's deferral. The 2026-08-08 pass lands the four amendments D42, D43,
D45, and D46 each named as belonging here, and opens U7 and U8 for the two gaps
`30-slices.md` surfaced that no design document determines. A second 2026-08-08 pass — the
first `/reconcile` run against a tree with all four modules implemented — lands D47 (§7, §11,
I21), D48 (I6), D49 (I35, I13), and D50 (I1). Each corrects an invariant the implementation
had shown to be false as written, not a change of intent. A `/contract` re-derivation later
the same day appends two invariants the design determined and this file had never carried:
I37 as D51, because `10-design.md` §2 names a two-part guard on the module graph and only the
core half had ever been written down, and I38 as D52, because §3.1 step 9 emits an event that
nothing here obliged. D52 also settles §4's `phase` mapping, which the design does not
determine — the one thing in this pass that is a design decision rather than a transcription.
A later pass the same day answers §12 U1 as D53: `/react` gains a `JsonProvider` context,
I39 constrains it, and `config.missingProvider` joins §10's closed code union. That one is a
design decision outright — the design named no mechanism for it at all. A further
re-derivation the same day appends I40 and I41 as D59 and D60 — the three cache policies' hit
conditions, and the loader's construction-time normalization of its source map, both
determined by `10-design.md` and neither previously carried here — and extends I12 to say
where a hit's `bytes` and `location` come from. It also opens U9, and decides nothing for it:
`JsonRequest.cache: false` is declared in §3 and implemented, governed by no invariant and
exercised by no test, and whether it participates in I17's single-flight is undetermined.
A `/contract` pass later the same day closes U9 by **narrowing I17** (`90-decisions.md` D61):
participation in the in-flight join is exactly participation in the cache, so a `cache: false`
request neither joins a load in flight nor may be joined by one. §3 names the term the
narrowing turns on, and I40 says such a read performs no lookup at all. The narrowing makes
I17 true of the shipped pipeline rather than changing it — what it changes is what a test has
to assert. The same pass closes **U8** by declaring `/node`'s source-map reader in §9 as
`parseSourceMap` and `readSourceMap`, constrained by I42 and raising the new
`config.unreadable` alongside `config.invalidEntry`. D62 put the reader in `/node` and routed
its signatures here; those signatures, the two-function split, and the added error code are
D63, and they are this pass's one design decision rather than a transcription.

The 2026-09-03 `/contract` pass does two things. It **replaces every scaffold with a pointer**
to the file that now declares it (D69): §1–§7, §9 and §10 held full TypeScript declarations
written before the code existed, every one of them since materialised, and a declaration written
here *and* in the tree is the copy that rots. Nothing was decided by that replacement — what each
section keeps is what a declaration cannot carry, and §8's invariants, §10.1 and §10.2 were
untouched by it. It also **extends I32** (D70), which named the digest memoization but never the
generation guard on its write; `10-design.md` §5 determines that guard and cites I32 for it, so
the extension transcribes a fact this file had failed to carry rather than changing one.

## 1. Result

`SourceId`, `Digest`, `ReasonCode`, `JsonMeta` and `JsonResult<T>` are declared in
`src/core/types.ts`.

- **`SourceId` is the only identity in the system.** Unique within a source map, and across the
  public and server maps together (I23). There is no second handle: no opaque token, no
  per-request id, no cache key a caller can see or construct.
- **`Digest`** is lowercase hex, 64 digits, and is produced only by the core's canonical digest
  (I5). The template literal type constrains the prefix and nothing after it, so the digit count
  and the alphabet are this statement's to carry, not the declaration's.
- **`ReasonCode` is closed.** §10.2 owns when each variant is raised, whether the loader retries
  it, and what the caller does about it. That table is the definition; the union is its shape.
- **Every field of `JsonMeta` is derived** (`10-design.md` §1.3), never carried through from a
  caller. `id` is `''` when the request carried no usable id. `bytes` is the UTF-8 byte length as
  received and `0` for `inline`; `attempts` counts transport attempts made by *this* call and is
  `0` for `inline` and for a cache hit (I11); `digest` is `null` unless requested; `validated` is
  a property of the call and never of the cache entry (I10, I15).
- **`JsonResult<T>` discriminates on `ok`.** `message` exists only on the failure arm, and
  `data` there is the declared fallback or `null` — never a stale cached value (I19). Control
  flow branches on `reason`; `message` is for humans and logs and is never load-bearing.

`location` is `''` in two cases, not one: when nothing resolved, and for an `inline` source,
which has no location to record. `provider` is what tells them apart — `'none'` against
`'inline'` — so an exhaustive switch on `provider` never has to read `location` to know which
it is holding.

## 2. Sources

`JsonSource` and `SourceSpec` are declared in `src/core/types.ts`; `normalizeSource` in
`src/core/config.ts`.

`normalizeSource` maps a string beginning `http://` or `https://` to an http source and every
other string to a file source. **It never produces `inline`**, and must not learn to: a bare
string is sugar for a *location*, and inline data is not a location — inferring one from the
other is the payload-shape guessing `00-brief.md` §4 rules out. An inline source is declared in
its object form or not at all.

A `SourceSpec` is normalized **once, at construction**, and never re-derived per read (I41).

`inline` is the mechanism by which an `at: build` payload reaches a runtime call site:
`prefetch` rewrites every `at: build` entry into an inline entry carrying the resolved data
(§9 `/build`, I33).

## 3. Request

`Unwrap`, `CanonicalValue`, `Validator<T>`, `CachePolicy`, `RetryPolicy` and `JsonRequest<T>`
are declared in `src/core/types.ts`.

- **`Unwrap`'s function form keeps returning `unknown`**; `CanonicalValue` states the domain its
  return value must fall in, and the domain is enforced at runtime (I36), not by the type. A
  value outside it is `json.schema`, on every load and independently of `digest`. The same bound
  applies to an `inline` entry's `data`, which is the other way a value that never passed
  through `JSON.parse` reaches the pipeline.
- **`CanonicalValue` admits finite numbers only** and filters `undefined`-valued object keys at
  any depth. The type states the shape; I35 states what is rejected and that rejection is a
  throw. The two are not interchangeable — a `Date` satisfies neither, but only I35 says so.
- **`Validator<T>` may transform.** Its `value` is the consumer's, which is why the digest sits
  before it and the cache line holds the pre-validation value (I15). A validator that throws is
  caught and is `json.schema`, indistinguishable to the caller from one returning not-ok.
- **`RetryPolicy.attempts` is total attempts, not retries**, and is at least 1 — `attempts: 1`
  means one try and no retry. `delayMs` above zero requires a `schedule` port and `jitter`
  requires an `rng` port, both checked at construction (I6). `backoff` defaults to `'fixed'`,
  `jitter` to `false`.
- **`CachePolicy`'s `ttl` requires a `clock` port**, and `mtime` is valid only on a file entry
  — an `mtime` policy anywhere else is `config.invalidEntry` (I6, I25).
- **`JsonRequest.cache` admits only `false`.** There is no `true` to write, because
  participating is the default and the field exists solely to opt out (I17, I31).
- **`JsonRequest.digest` defaults to false** and is always true at build.

A request carries only what belongs to the caller. Everything that shapes the transport —
`unwrap`, `headers`, `timeoutMs`, `retry`, `maxBytes`, and the cache policy — is declared
on the source entry (§6). Two callers reading one id therefore differ only in `fallback`,
`validate`, `digest`, and the cache opt-out, which is what makes the cache key the id
(I16) and the in-flight join safe (I17).

A request supplying its own `source` resolves that source, is neither read from nor written
to the cache, and is never joined to an in-flight load. It receives `unwrap: 'none'`, the
default timeout, one attempt, and no size bound.

A read is **cache-eligible** when it resolves through the loader's source map and carries no
`cache: false`. Exactly the cache-eligible reads take part in the cache line and in the
in-flight join, and those two go together because the in-flight map is keyed by cache key
(I17, I40): a `cache: false` request, like a request carrying its own `source`, performs no
lookup, writes no entry, joins no load in flight, and is joined by none. Two concurrent
opt-out reads of one id therefore issue two transports, which is the declared meaning rather
than a leak (`90-decisions.md` D61).

`at` is not a request field. A source's `at` value may change without a call site changing
(I9), which a request-level `at` would contradict.

## 4. Ports

`FileSystemPort`, `ScheduledWait`, `CacheEntry`, `CacheStore`, `JsonEvent` and `JsonPorts` are
declared in `src/core/types.ts`.

- **`FileSystemPort` is read-only, and must never acquire a write member.** The package is
  read-only, and that member is the seam through which it would stop being
  (`90-decisions.md` D19, `00-brief.md` §5.1). `watch` is optional and returns its own
  unsubscribe, which is what `dispose` calls (I26).
- **`ScheduledWait.cancel` settles nothing** — it releases the timer and leaves the promise
  pending forever. A `cancel` that rejected would turn every abandoned wait into an unhandled
  rejection; a `cancel` that resolved would be indistinguishable from the wait elapsing.
- **`CacheEntry.data` is frozen, post-unwrap and pre-validation** (I15). `source` is the source
  the entry was *declared* under and is compared on every lookup; `location` is where the bytes
  came from and is recorded, never compared (I16, I30) — conflating them makes a redirecting
  source miss forever. `digest` is the one mutable field, memoized under a generation guard on
  first request against the entry (I32). `storedAt` is `null` where no clock port was supplied,
  and `stamp` is populated under an `mtime` policy only; a null value of either is never a hit
  (I25, I40).
- **`CacheStore` is a store, not a policy.** It holds what it is given under opaque keys and
  decides no expiry — every hit condition is I40's, evaluated before a `get`.
- **`JsonPorts` requires nothing in general.** A port whose absence would silently disable a
  declared feature is a construction-time error instead (§10, I6), never a downgrade: `fetch`
  for an http entry, `fs` for a file entry, `clock` for a `ttl` policy, `rng` for retry jitter,
  `schedule` for a timeout or a non-zero delay.

Cache keys are opaque to the caller and namespaced per loader instance (I29). A loader
never calls `CacheStore.clear()`; `invalidate()` with no argument bumps that loader's
epoch and deletes only its own keys.

There is no hash port. The digest is computed by the core's own SHA-256 so that one
payload has one digest regardless of who loads it (I5, I13).

`JsonEvent.phase` is **the last phase that ran** before the result was assembled. Stating it
that way makes it mechanical, where "the phase that caused the outcome" would be a judgement
call on every `json.schema` (D52):

| Phase | Runs at | Terminal for |
|---|---|---|
| `resolve` | `10-design.md` §3.1 step 1 | `json.unresolved` |
| `cache` | Step 2, on a hit | `json.ok` from the cache line where no validator ran |
| `fetch` | Step 4, for a `file` source as well as an `http` one — the union has no separate read phase | `json.transport`, `json.status`, `json.timeout`, `json.notFound`, `json.tooLarge` |
| `parse` | Step 5 | `json.parse` |
| `unwrap` | Steps 6–7, I36's domain check included | `json.schema` from an unwrap or from the domain check; `json.ok` on a fresh load where no validator ran |
| `validate` | Step 8 | `json.schema` from a validator; `json.ok` wherever a validator ran |

Steps 3 and 9 have no phase: joining is not work on the value, and assembly is where the event
is emitted rather than a phase it could report. A joined caller therefore reports **its own**
last phase — `validate` where it supplied a validator, `unwrap` otherwise — which is the same
per-call rather than per-entry split I15 draws for `validated`.

## 5. Loader

`JsonLoader` is declared in `src/core/types.ts`; `createJsonLoader` in `src/core/loader.ts`.

- **`load` and `loadById` differ only in where the request comes from** — the caller's, or
  synthesized from the map entry. Neither branches on `at` (I9), and both are subject to I2:
  no member of this interface except `preload` ever throws or rejects.
- **The three eager members are bounded** — `loadMany`, `preload`, and `/build`'s `prefetch`
  each fan out to at most 64 loads at a time, per call (I43). A caller sizes the array; it does
  not size the concurrency.
- **`loadMany` never rejects** and returns a result per id. One unreachable source does not deny
  the caller the other four; aggregating them into a single failure is what §4.3 rules out.
- **`preload` is the only member that rejects.** Its guarantee is that every named id resolved
  once, at the moment it was called; it does not extend past the cache policy that warmed it
  (`90-decisions.md` D38). It resolves every id before failing and names all of them (I20).
- **`invalidate()` with no id drops everything this loader owns, and nothing another owns**
  (I29). It bumps an epoch rather than enumerating keys, which is why `CacheStore` needs no
  enumeration member and why `clear()` is never called.
- **`stats()` reports hits, misses, and entries only** — nothing about eviction or size
  pressure. That limit is known and stated rather than an oversight (§12 U6).
- **`dispose` is the only lifecycle member, and it is idempotent.** A watch is registered
  lazily, on the first successful read of a file entry declaring an `mtime` policy, never at
  construction, and every watcher a loader registered is unsubscribed here (I26). Disposal
  belongs to whoever constructed the loader (`90-decisions.md` D31, I39);
  `[Symbol.dispose]` is the same operation reached under `using`, not a second one.

`createJsonLoader` takes the source map and the ports, and takes them **once**: the map is
normalized at construction, and editing the object afterward changes no later load (I41). A
changed map means a new loader.

## 6. Configuration

`HttpCacheSpec`, `FileCacheSpec`, `RetrySpec`, `SourceEntry` and `SourceMap` are declared in
`src/core/types.ts`.

- **The three `SourceEntry` variants are narrowed by key presence** (`'url' in entry`), not by a
  tag, and declaring more than one of `url`, `path`, `inline` is `config.invalidEntry`. The
  `never` members are what make the union exclusive to a type checker only; a source map arriving
  as YAML was never type-checked, so the runtime check is the one that binds — and it is the
  core's, applied by `/node`'s reader rather than copied into it (I42).
- **`at` and `cache` are both required, with no default for either** (`90-decisions.md` D3,
  I31). `cache` is forbidden on an inline entry: nothing is transported, so a policy would
  govern nothing. `version` other than `1` is `config.invalidEntry`.
- **`headers` may be declared only in `sources.server.yml`** (I7). A type cannot express which
  file an entry was read from, so this is enforced where the file is read and by the build gate,
  never by the union.
- **`timeoutMs` defaults to 10 000 ms and bounds each attempt, never the call** (I18) — a
  three-attempt policy at that default can take thirty seconds, which is the declared meaning.
  `retry` defaults to one attempt and no delay. `maxBytes` absent means unbounded (I27).
- **`schema` is a name this package never resolves.** The consuming repository's registry
  resolves it; schema authoring is a non-goal (`00-brief.md` §5.6).
- **`unwrap` defaults to `'none'`**, and YAML can express only `'none'` and `'subzerodev'` —
  the function form is reachable from code alone. Nothing is ever inferred from payload shape
  (I4).

On disk — the one shape here that no file in the tree carries:

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

`JsonLock` is declared in `src/core/types.ts`. Written by `/build` for every `at: build` source.

An entry carries a location, a digest, and a byte count — and **nothing else**. `location` is
where the bytes came from, not what was requested (I30). In particular an entry carries **no
timestamp**: the lockfile is committed so that builds are comparable, and a wall-clock stamp
makes every rebuild a diff, which is the one property the file is committed for (I21, D47).
Anything derived from a clock belongs in build logs, not here. One field that legitimately
differs run to run is enough to defeat the whole artifact, which is why this is a constraint on
the shape and not merely on what is written into it.

## 8. Invariants

Each invariant is testable, and the test must fail when the invariant is removed
(`00-brief.md` §7.1). I1–I13 keep their ids; I14–I36 were appended in the 2026-08-07 pass,
I37 and I38 in the 2026-08-08 re-derivation, I39 with D53 later that day, and I40 and I41 in
the re-derivation after it. I17 was **narrowed** in the pass after that (D61) and I40 extended
with it; no id was added for either, because a correction to an existing invariant is not a new
invariant. I42 was appended in the same pass, with D62 and D63. I32 was **extended** on
2026-09-03 (D70) for the same reason and likewise without a new id. I43 and I44 were appended on
2026-09-03 (D71, D72), resolving what was §12 U5 and issue #37 respectively.

This section carries no declarations and points at none: an invariant is exactly the thing a
type cannot state, which is why the 2026-09-03 pointer pass (D69) left it untouched.

| | Invariant | Owner |
|---|---|---|
| **I1** | The core imports no module — every specifier in `src/core/` is relative, so no Node builtin and no package. It references no `fs`, `fetch`, `window`, `process`, `Date.now`, `Math.random`, or non-bit-stable `Math.*`. `AbortController` is the one permitted ambient global, and only to cancel a transport attempt. Enforced by the determinism guard in CI, not by review, and the guard covers **both** halves: the ambient globals and the bare-specifier ban, the latter across static imports, dynamic `import()`, and re-exports (D50). | core |
| **I2** | `load()` never throws and never rejects. Every outcome — including a malformed request — is a `JsonResult`. | core |
| **I3** | When `fallback` is supplied, `data` is non-null on every result, `ok` either way. When it is not, `data` is `null` on every failure. | core |
| **I4** | `unwrap` is never inferred from payload shape. Absent means `'none'`, and `'none'` means the parsed body is returned exactly as parsed. | core |
| **I5** | Two payloads that are equal as JSON values produce the same `digest`, regardless of key order or whitespace. Two that differ produce different digests. | core |
| **I6** | Every port a supplied entry needs is present at construction, or `createJsonLoader` throws `JsonError('config.missingPort')` naming the entry and the port: `fetch` for an http entry, `fs` for a file entry, `clock` for a `ttl` policy, `rng` for retry jitter, `schedule` for a timeout or a non-zero delay. The check covers exactly the entries in the map supplied, never a wider set. Never a silent downgrade. **One clause is deliberately map-independent** (D48): a supplied `fetch` port requires a `schedule` port alongside it even where no entry declares an http source, because an ad-hoc `JsonRequest.source` (§3) can name an http URL the map never mentions and carries the default timeout. Where neither port is supplied the ad-hoc attempt runs unbounded and fails on the absent `fetch`; it never throws, because I2 admits no exception. | core |
| **I7** | `headers` may be declared only in `sources.server.yml`; declaring them in the public map is `config.invalidEntry`. The build gate's guarantee is **filename-scoped**: no file whose basename is a server-map source id appears in the public output directory. That catches a prefetched artifact written where a browser can read it, and nothing else — a server URL or a declared header value inlined into a JS chunk passes it (D46). Asserted in CI. It is the cheap half and stays; the content half is I44 (D72), and neither subsumes the other. | build |
| **I8** | An `at: build` source is never fetched at runtime; an `at: runtime` source is never resolved at build. `prefetch` constructs its loader over the map filtered to its `at: build` entries, so a build demands under I6 exactly the ports the entries it resolves need, and never a port for an `at: runtime` entry it is guaranteed not to touch. | build |
| **I9** | A source's `at` value may change without any call site changing. | core, build |
| **I10** | `meta.validated` is `true` only when a validator ran in this call and returned `ok`. Absent validator means `false`, never `true`. | core |
| **I11** | `meta.attempts` equals the number of transport attempts, `1` on a first-try success, and `0` for `inline` and for a cache hit. A joined caller reports the attempts made by the load it joined, with `cached: false`. | core |
| **I12** | A cache hit returns data equal to the first success for an equal validator, and `meta.cached` is `true`. Its `meta.bytes` and `meta.location` are the entry's stored values, never re-derived on this call: the payload was that size, and came from that location, when it was read. | core |
| **I13** | The core's canonical serializer is byte-identical to `src/engine/src/core/persistence/canonical.ts` on that module's test vectors, and rejects exactly the values that module rejects — **except that it may reject strictly more**, never less (D49). D39 read that module at `f7d8f59` and recorded no non-plain-object vector, so whether it rejects a `Date` is unknown and is not to be guessed at; this package rejects one. Stricter is the safe direction under D39's own argument, since J9 swaps this implementation in beneath the engine's determinism acceptance test. Message text is not compared — a rejection is compared as a rejection. Cross-checked until J9, when the engine's copy is deleted. | core |
| **I14** | Every value `load` returns is deeply frozen — on a miss, with caching off, after a validator transform, and on a fallback. Mutability never depends on a cache policy the call site cannot see. | core |
| **I15** | The cache line holds the post-unwrap, pre-validation value. Validation runs per call against it, so `validated` is a property of the call and never of the entry. | core |
| **I16** | The cache key is the source id, scoped to the loader instance. An entry records the `JsonSource` it was declared as, and a lookup is a hit only where that source equals the one the request resolves to — for an http source, url and headers both. *Elsewhere* means a **different declared source, never a different final URL**: a source that redirects caches under the id it was declared as, and `location` keeps its I30 meaning untouched. A request supplying its own `source` is neither read from, written to, nor joined against the cache. | core |
| **I17** | Concurrent **cache-eligible** misses (§3) for one key issue one transport. The rest join it and receive the same frozen value. A read that is not cache-eligible takes no part in the join in either direction: a `cache: false` request and a request carrying its own `source` (I16) each go straight to transport, joining no load in flight and being joined by none — so two concurrent opt-out reads of one id issue two transports, and an opt-out read never initiates a load a normal read commits (D61). A load compares the generation it started under before storing; on a mismatch it returns its result and writes nothing. | core |
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
| **I32** | A `digest: true` request against an entry stored without one computes the digest from the cached value and memoizes it. It never re-transports, and never returns `digest: null` under `ok: true`. The memo is written **under the same generation guard as any other store** (I17, D70): a caller that computed it after the entry's generation moved on — an `invalidate`, or a watch callback — writes nothing and leaves the entry's `digest` null, and still returns the digest it computed to its own caller, because the value it was computed from is the value that caller is being handed. The guard matters only where an await point separates the load from the memo; on a cache hit the lookup and the memo are one synchronous step, and there is no interleaving for it to lose. | core |
| **I33** | `prefetch` emits a `SourceMap` in which every `at: build` entry has become an inline entry carrying the resolved data. A runtime loader constructed from it resolves those ids without any port, and `10-design.md` §3.1's pipeline never branches on `at`. The rewritten entry keeps `at` and `schema` and carries none of `unwrap`, `cache`, `maxBytes`, `timeoutMs`, or `retry`: the data is already unwrapped, and an inline entry transports nothing for any of them to govern (I31 forbids `cache` there outright). | build |
| **I34** | An `unwrap: 'subzerodev'` envelope whose `success` is `false` yields `json.schema`, with the envelope's own error text in `message`. `ok: true` with `data: undefined` is unreachable. | core |
| **I35** | The canonical serializer accepts exactly `CanonicalValue` (§3). At any depth it filters `undefined`-valued object keys, and rejects a non-finite number, a bare `undefined`, a `bigint`, a symbol, a function, and **any object that is not a plain record** — one whose prototype is neither `Object.prototype` nor `null`, such as a `Date`, `Map`, `Set`, `RegExp`, or class instance (D49). Rejection is a throw. The serializer is pure: it reaches no port and no ambient global. | core |
| **I36** | The post-unwrap value is checked against I35's domain on every load — before it is frozen, before it is cached, and independently of `digest`. A value outside the domain yields `json.schema` and writes nothing to the cache. No cache entry ever holds an out-of-domain value, so I32's memoized digest never throws, and `digest` never changes a result's `ok`. | core |
| **I37** | No leaf module imports another leaf. A specifier in `src/node/`, `src/build/`, `src/zod/`, or `src/react/` is relative within its own directory, a relative reach into `src/core/`, or a bare specifier for a dependency that module declares — never a reach into a sibling leaf, across static imports, dynamic `import()`, and re-exports. `/build` in particular never imports `/node`, which is what keeps `FileSystemPort` read-only (D19). I1 is the core's out-degree and this is each leaf's in-degree from its siblings; together they are the whole of `10-design.md` §2's star graph, and neither half rests on review (D50, D51). Test files are outside the guard: a fixture is not a shipped edge. | node, build, zod, react |
| **I38** | A supplied `log` port receives exactly one `JsonEvent` per `load` call that completes — including each id resolved through `loadById`, `loadMany`, `preload`, and `prefetch`, and including a caller that joined an in-flight load rather than starting one. The event is emitted after the result is assembled and before `load` resolves, and carries that result's own `id`, `reason`, and `meta`, with `phase` as §4 defines it. Delivery is fire-and-forget: a `log` port that throws changes neither the result nor the cache and never makes `load` throw (I2). No other member emits. | core |
| **I39** | `useJson` and `JsonBoundary` read their loader from the nearest `JsonProvider` above them and from nowhere else — no module-level default, no ambient singleton, no fallback loader. Rendered with none above them, each throws `JsonError('config.missingProvider')`. That throw does not weaken I2: no loader was reached, so `load` was never called. `JsonProvider` accepts a loader and never constructs one, and never calls `dispose()` on unmount — disposal stays with whoever created it (D31). Two loaders coexist in one tree as nested providers, and the nearest wins, which is what keeps §5's per-loader cache boundary true under React. | react |
| **I40** | A lookup is a hit only where I16's source comparison passes **and** the entry's declared policy admits it. `manual` admits any stored entry, until `invalidate` drops it. `ttl` admits an entry whose `storedAt` is non-null and for which `clock() - storedAt < ttlMs` — the window is half-open, so an entry exactly at `ttlMs` has expired, and an entry stored without a clock is never a hit. `mtime` admits an entry whose stored `(mtimeMs, size)` equals the stamp taken before this read, with a null stamp on either side never a hit (I25). Everything else is a miss, and it is a miss that §5's in-flight join is checked against. A read that is not cache-eligible (§3) evaluates none of these conditions: it performs no lookup at all, so it is neither a hit nor the kind of miss I17's join is reached from (D61). | core |
| **I41** | A loader normalizes its `SourceMap` once, at construction. The set of ids it can resolve, and each entry's normalized source, `unwrap`, cache policy, timeout, retry, and `maxBytes`, are fixed for that loader's life: adding, removing, or editing an entry in the `SourceMap` object after `createJsonLoader` returns changes no later load, and normalization is never re-derived per read. A changed source map means a new loader, which is what makes the map a construction input rather than mutable state the cache would have to track. | core |
| **I42** | `parseSourceMap` and `readSourceMap` accept exactly the maps `createJsonLoader` accepts and reject exactly the ones it rejects, because they apply the core's own entry check by relative import into `src/core/` rather than a second copy of §6's rules (D62, I37). The reader adds one check the core's cannot make, because the core's input is already typed: that the parsed document is an object carrying a `sources` record. Every failure out of either is a `JsonError` (I24) — `config.unreadable` where the bytes could not be obtained, `config.invalidEntry` for everything else, and never a `YAMLException` or a bare `TypeError`. | node |
| **I43** | Eager resolution is **bounded**: a single call to `loadMany`, `preload`, or `prefetch` has at most **64** loads in flight at any instant, however long the id list it was given. The bound is **per call, not per loader** — two concurrent `loadMany` calls may reach 128 between them — because the O5 entry's own terms fix it there (D71): below the ceiling behaviour is identical to today, which a loader-wide semaphore would break by throttling one call on account of another's. Below it every id starts at once; above it the fan-out becomes batches. Batching never converts a partial failure into an early stop: every id is attempted whatever an earlier id returned, which is what keeps I20 true once the ids no longer start together, and resolution order stays nondeterministic, which is why I21 emits sorted. The ceiling is **not configurable** — no port, no factory option, and no source-map field reaches it (O5 rejected a knob outright) — and `/build` is bound by the core's single constant reached across I37's permitted edge, never by a second copy of the number. It raises no reason code of its own: it lowers the odds of a descriptor exhaustion, and does nothing to how one is classified when it happens. | core, build |
| **I44** | The public/server gate also **scans the bytes** of every file in the public output for each server entry's `url` and each of its declared **header values**, with common JSON and JS string escaping normalised first so that an escaped occurrence is not a miss. A hit is `build.serverSourceLeaked` and fails the build; there is no suppression mechanism, no per-entry opt-out, and no severity below failure. Three exclusions are deliberate, not gaps. **Header names are never scanned** — a name is not a secret and `Authorization` ships inside any HTTP client in the bundle, so scanning names would find the one item that is not a leak while being the only item that collides. **A header value shorter than 8 characters is not scanned**, for the same reason at the other end. And **the message never carries the matched text**, only the id, the file, and which class matched, because a gate that prints a header value writes the credential into the CI log it was raised to protect. Both a whole `url` and its origin-and-path prefix count as matches, so a rewritten query string still trips it. What this **does not** prove, stated rather than implied (D72, D46's move at the wider scope): it catches *accidental* inlining and not an adversary — an occurrence split across concatenation, base64-encoded, or otherwise transformed passes clean, and no scan over output bytes can change that. Runs under I22's ordering, in the same call as I7. | build |

## 9. Subpath Exports

Each subpath's public surface is what its `index.ts` re-exports, and nothing beyond it — a
symbol exported from a module file but absent from that barrel is internal, whatever its
visibility to a type checker. What each declaration cannot say:

| Export | Declared in | What the declaration cannot say |
|---|---|---|
| `nodeFileSystem` | `src/node/fs.ts` | Read-only, and stays so (§4, D19). Its `watch` is the real filesystem watcher `dispose` unsubscribes (I26) |
| `nodePorts` | `src/node/ports.ts` | Composes a Node port set; every override replaces wholesale rather than merging into the composed one. Supplying `fetch` here still obliges `schedule` under I6's map-independent clause |
| `JsonRouteHandler` | `src/node/router.ts` | **Structural on purpose**, so `/node` depends on no web framework — it must never be narrowed to an Express type. Compatible with an Express handler by shape alone |
| `jsonRouter` | `src/node/router.ts` | **GET only.** It never forwards an upstream status (I28), and its failure body carries the field the core's `'subzerodev'` unwrap reads (I34, D45). Serves only the ids it was handed, never the whole map |
| `envelope` | `src/node/envelope.ts` | The success half of the shape `jsonRouter` emits the failure half of; the two are kept agreeing by J2.5's round-trip test, not by proximity |
| `convertYamlToJson` | `src/node/yaml.ts` | The CLI's core, reading **data**. Resolves the number it returns as a count of documents converted. The only place YAML meets runtime data; the runtime loader never sees it (`00-brief.md` §5.3) |
| `parseSourceMap`, `readSourceMap` | `src/node/source-map.ts` | Configuration, not data. Validated against §6 by the core's own check before return, never a second copy of it (I42). Both return the **parsed** map, not a normalized one |
| `JsonProvider`, `JsonProviderProps` | `src/react/context.tsx` | Accepts a loader and **never constructs one**, never disposes one on unmount (I39, D31). Nesting is how two loaders coexist in one tree, and the nearest wins |
| `useJson` | `src/react/use-json.ts` | Widens a `JsonResult<T>` with `loading` and `refetch`. Reads its loader from the nearest provider and nowhere else; with none above it, throws `config.missingProvider` (I39). Unmounting suppresses the state update, it does not abort the request (D55) |
| `JsonBoundary` | `src/react/json-boundary.tsx` | Renders from `reason`, never from `message` (`10-design.md` §4.2). Same provider requirement as `useJson` |
| `zodValidator` | `src/zod/zod-validator.ts` | Adapts a zod schema to the core's `Validator<T>` seam and is the whole of `/zod`. Keeps zod out of the core, as an optional peer resolved by no other subpath |
| `prefetch`, `PrefetchOutput` | `src/build/prefetch.ts` | Writes nothing until everything resolves, and names every failure rather than the first (I20). Fans out under the core's ceiling, not a bound of its own (I43). Its `runtimeMap` has every `at: build` entry rewritten to inline (I33); its loader is constructed over that half of the map alone (I8, D43) |
| `assertNoServerSourcesInBundle` | `src/build/gates.ts` | Two checks under one name and one signature: the filename scope (I7) and the content scan (I44). Must run after the last write into the public directory (I22). Its failure message is part of the contract, not diagnostics — it must never print the text that matched (I44) |
| `assertNoDuplicateIds` | `src/build/gates.ts` | Compares **across** the two maps. The core cannot raise this and does not: duplicate keys within one map collapse before it sees them (I23) |

`ReactNode` and `ReactElement` are React's own types, reached through the optional peer
dependency; `/react` re-exports neither. `ZodType` is likewise zod's.

The package writes nothing at runtime (`00-brief.md` §5.1); `/build` writes with the Node
runtime directly and the filesystem port stays read-only (`90-decisions.md` D19).

The `'subzerodev'` literal stays in the core because it is declared in configuration and
the core reads configuration; `/node` owns the producer (`envelope`) for the success half
and `jsonRouter` emits the failure half (I28). J2.5's round-trip test is what keeps the two
ends agreeing, and it covers both halves — a test written to catch a shape divergence that
exercises only the success side is how D45's divergence survived.

`JsonProvider` is how `useJson(id)` reaches a loader, and it is the whole of the answer to
what was §12 U1 (`90-decisions.md` D53). It **accepts** a loader rather than constructing one:
`createJsonLoader` needs the source map and the ports, and `config.missingPort`'s remedy is to
fix the composition root, which is the consuming application's and not a component's. For the
same reason the provider never calls `dispose()` on unmount — a component does not dispose
what it did not create, and D31 leaves that with whoever did. Nesting providers is how two
loaders coexist in one tree, which §5's per-loader cache requires be possible.

`readSourceMap` and `parseSourceMap` are what make §10.1's "`/node` when reading YAML" clause
name a raiser that exists, and they are the answer to what was §12 U8 (`90-decisions.md` D62 for
the module, D63 for these signatures). They read **configuration**, where `convertYamlToJson`
reads data; nothing about the two paths is shared beyond the parser. The reader is the file half
and is built on the parser, so a caller holding bytes from anywhere else — an env var, a
bundler's raw import — validates through the same check rather than casting `unknown` to
`SourceMap` by hand, which is the defect D62 rejected having no reader for.

Both return the parsed `SourceMap`, not a normalized one: normalization is the loader's, once, at
construction (I41), and a reader that returned something else would be a second shape for the
same configuration. Validating here as well is deliberate rather than redundant — it is the same
check run earlier, so a malformed `at: runtime` entry is caught by a build that under I8 and D43
never constructs a loader over those entries at all.

## 10. Error semantics

Two vocabularies, both closed. `ReasonCode` (§1) is the outcome of a load and never throws.
`JsonErrorCode` is the outcome of a misconfiguration or an eager resolution, and is the only
thing this package throws or rejects with (I24).

`JsonFailure` and `JsonErrorCode` are declared in `src/core/types.ts`; `JsonError` in
`src/core/errors.ts`.

`JsonError.failures` is **empty for every `config.*` code** — those name one entry inline in
`message` instead, because a misconfiguration is one fault at one named site, where
`preload.failed` and `build.failed` are aggregates whose whole point is naming all of them
(I20). A caller may read `failures` unconditionally; it is never absent, only empty.

**The two tables below are this section's substance, and it points at nothing for them.** An
error variant's name is in the tree; when it fires, whether it is retryable, and what the caller
is expected to do about it are not, and cannot be.

### 10.1 `JsonErrorCode`

| Code | Raised by | When | Retryable | Caller does |
|---|---|---|---|---|
| `config.missingPort` | core, at `createJsonLoader` | An entry in the supplied map needs a port that was not passed (I6) | No | Fix the composition root. The loader does not exist |
| `config.missingProvider` | `/react`, at render | `useJson` or `JsonBoundary` rendered with no `JsonProvider` above it (I39) | No | Mount a `JsonProvider` at the composition root. There is no loader to read, and no default to fall back to |
| `config.invalidEntry` | core, at `createJsonLoader`; `/node`, from `parseSourceMap` and `readSourceMap` | Missing `at`, missing `cache` on an http or file entry, `cache` on an inline entry, more than one of `url`/`path`/`inline`, `mtime` on a non-file entry, `retry.attempts < 1`, or `version` not `1`. From the reader, also: the text is not YAML, or it parsed to something that is not an object carrying a `sources` record — the bytes arrived, so the fault is in their content | No | Fix the source map. The message names the id and the field, or names the file where the fault is above the entries |
| `config.unreadable` | `/node`, from `readSourceMap` | The configuration file is absent, is a directory, or the read failed on permission or IO. Never raised by `parseSourceMap`, which is handed text and cannot fail this way (D63) | No | Fix the path in the composition root, or produce the file. Nothing was parsed, so no id can be named — the message names the path and the underlying reason |
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
| **Source maps** — `sources.public.yml`, `sources.server.yml` | §6 `SourceMap` | `SourceId`, unique across both files (I23) | `version: 1`; `at` and `cache` required; `headers` only in the server file (I7). Enforced on the way in by `/node`'s reader, against the core's own check (I42) | No prior version exists. A `version` other than `1` is `config.invalidEntry`. J6.4 and J6.6 create these by hand, one migration decision per source |
| **Prefetched artifacts** — one per `at: build` source | The resolved post-unwrap value, canonically serialized | `SourceId` | Regenerable from the source map | None. Every build rewrites all of them; a stale artifact is overwritten wholesale. Never hand-edited, never merged |
| **Derived runtime map** — emitted by `prefetch` | §6 `SourceMap`, `at: build` entries rewritten to inline (I33) | `SourceId` | Build output; never hand-edited | None. Regenerated with the artifacts |
| **Lockfile** — `json.lock` | §7 `JsonLock` | `SourceId`, sorted (I21) | `version: 1`; `digest` matches `Digest`; no clock-derived field (D47); committed so builds are comparable | Regenerable. A change to what `digest` covers invalidates every entry (`90-decisions.md` D14, expensive) and is migrated by rebuilding and committing the whole diff, not by rewriting entries |

The cache is in-memory, per loader, per process, and never persisted (`10-design.md` §5).
It has no schema and no migration story, which is why `invalidate` can be a counter rather
than a protocol.

## 12. Unresolved

Three items the design does not determine. Each blocks the work named; none is invented here.
U7 is `30-slices.md`'s "contract gaps this pass surfaced" 2, moved to the register that owns
it — that section recorded it, this one is where it is answered. Gap 1 was U8, below.

| | Item | Blocks |
|---|---|---|
| **U2** | **Redirect policy** (`90-decisions.md` O15). No redirect mode is specified, so a fetch port follows by default, and only `Authorization`, `Cookie`, and `Proxy-Authorization` are stripped cross-origin — a declared `X-Api-Key` reaches a different origin. I30 settles what `location` records; whether redirects are followed, and what happens to declared headers across an origin change, is undetermined. | J1, J3 |
| **U6** | **`stats()` reports hits, misses, and entries only** (`90-decisions.md` O3). Nothing about eviction or size pressure. Adequate until a consumer caches enough to care; stated so that it is a known limit rather than an oversight. | — |
| **U7** | **No public canonical serializer** (`30-slices.md` gap 2, `90-decisions.md` D44). J9.1 has the engine import this package's canonical serialization and delete its own copy, retiring I13's duplication. `10-design.md` §2 lists canonical serialization among what the core *owns* and exposes only `load`, the loader factory, source normalization, and the types — it determines neither which functions become public (`canonicalize` alone, or `digestOf` and `sha256Hex` with it) nor their signatures. Not invented here: adding an export later is additive and removing one after publication is not — and the package **is** published, at 0.2.0, so that asymmetry now has teeth it did not have when D44 first argued it against an unpublished 0.1.0 (`10-design.md` §2). D44's removal has since landed: `src/core/index.ts` exports none of the three, so the decision is made against J9.1's stated requirement rather than against whatever a slice happened to export. | J9 |

**U5 is resolved.** Eager resolution carries a fixed ceiling of 64 loads in flight per call,
stated as I43 (`90-decisions.md`, the 2026-09-03 O5 entry and D71; O5 names the loader `concurrency`
option, contracting the unboundedness outright, and bounding `/node`'s filesystem port alone, and
why each was rejected). The ceiling sits above any source map small enough to be hand-written, so
it engages only where `10-design.md` §5's smallness assumption has already been violated — which
is why the answer is a ceiling and not a knob, and why neither §5 nor §6 acquires a field for it.
What O5 leaves undetermined and I43 therefore settles is the bound's scope: that entry's "below
the ceiling, behaviour is identical to today" admits only a per-call reading, since a loader-wide
bound would throttle a forty-id call on account of a concurrent one. **`10-design.md` §5's closing
paragraph still states fan-out is unbounded and now contradicts I43** — that is a decision
changing rather than a transcription error, so it is `/design`'s to correct and is deliberately
left standing here. The id is retired, not reused.

**U8 is resolved.** `/node` owns the reader (`90-decisions.md` D62), and §9 declares it as two
functions: `parseSourceMap(text)` for the validation half and `readSourceMap(path)` for the file
half built on it (D63, which names the one-export and parse-only alternatives and why each was
rejected). Both return a `SourceMap` validated against §6 by the core's own entry check rather
than a second copy of it, which I42 makes checkable. The error surface is two codes: the new
`config.unreadable` where the bytes could not be obtained, and `config.invalidEntry` for
unparseable YAML, a document with no `sources` record, and every per-entry fault the core already
names. J6 is unblocked. The id is retired, not reused.

**U9 is resolved.** A `cache: false` request does not participate in single-flight, because
participation in the in-flight join is exactly participation in the cache
(`90-decisions.md` D61, which names the join-but-never-store and delete-the-flag alternatives
and why each was rejected). §3 defines *cache-eligible*, I17 narrows to concurrent
cache-eligible misses, and I40 records that a non-eligible read performs no lookup at all. The
shipped pipeline already behaves this way, so the amendment ratifies code rather than obliging
a change to it — but the flag is still exercised by no test, so what the narrowing now demands
is the test, in both directions. The id is retired, not reused.

**U1 is resolved.** `useJson(id)` reaches its loader through a `JsonProvider` context, added to
§9 as `/react`'s third export and constrained by I39 (`90-decisions.md` D53, which names the
loader-parameter and module-singleton alternatives and why each was rejected). Both signatures
from the 2026-08-06 draft stand exactly as drafted; the answer was additive rather than a
revision of them. J4 is unblocked, and so is J6+J7 through it. The id is retired, not reused.

**U3 is resolved.** The parser is `js-yaml` `^4.1.0` on its `DEFAULT_SCHEMA`, a `dependencies`
entry resolved only by `/node`'s subpath (`90-decisions.md` D41, which names the alternatives
rejected and why). `10-design.md` §7 Q3's recommended *shape* — a normal dependency of `/node`
only, leaving the core at zero — is what shipped. The id is retired, not reused.

**U4 is resolved.** The engine's serializer has been read and cross-checked
(`90-decisions.md` D39); its key ordering, escaping, and number formatting are verified
identical, and its value domain is now this package's own (I35). The id is retired, not
reused — D39 and issue #17 cite it.
