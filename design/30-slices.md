# Slices — SubZeroDev.Data.Json

Ordered work units. `J` is this repository's slice prefix (`90-decisions.md` D10).

Per-criterion ids (`J1.1`, `J1.2`) are stable: never reused, never renumbered. A retired
criterion leaves a gap and the gap is recorded below.

**Slice numbers are identity, not sequence.** J1's original scope was the whole core; the
`/contract` pass of 2026-08-07 added roughly twenty core-owned invariants to it, and it no
longer fits one session. The work it shed became J10, J11, and J12 rather than renumbering
anything, because `20-contract.md` §12, `90-decisions.md`, `10-design.md` §2, and
`00-brief.md` all cite the existing ids. Read in the running order below, not in numeric
order.

**Running order:** J1 → J10 → J11 → J12 → J2 → J3 → J5 → J4 → J13 → J6+J7 → J8 → J9.

**J1, J10–J12 are the core. J2, J3, J5 are the environments. J4 is the fourth. J13 closes the
configuration gap all four left open. J6+J7 prove it. J8–J9 are adoption.**

J1 is first because it carries the two assumptions the whole design rests on and neither has
been tested: the digest's byte-identity with the GameEngine's serializer, which
`90-decisions.md` D14 marks expensive to reverse and D39 has now cross-checked, and the claim
that the core survives the determinism guard (I1). J10–J12 follow
in ascending order of what a mistake in them costs to undo.

**Where the work stands.** J1, J10, J11, J12, J2, J3, J5, and J4 are merged — the core and all
four leaves. **J13 is the frontier, and nothing is blocked.** J6+J7's block was `20-contract.md`
§12 U8, and the `/contract` pass of 2026-08-08 resolved it: `/node` owns the YAML-to-`SourceMap`
bridge (`90-decisions.md` D62), §9 declares it as `parseSourceMap` and `readSourceMap`, I42
constrains it, and `config.unreadable` joins §10's closed union (D63). No code in `src/node/`
implements any of it, so what was a block on J6+J7 is now a slice ahead of it. Doneness itself
is the issue's to record, not this file's (`AGENTS.md`, *Tracking work*); the checkboxes below
define a slice and are not a progress bar.

---

## J1 — Core: the inline pipeline, the canonical digest, and the determinism guard

Delivers: The first working loader. A call site names a payload declared directly in
configuration and gets back a result that says whether it worked, why not if it did not, and
a content fingerprint of what came back — with the package reaching for nothing outside
itself. This is also the exact loader a build hands to a runtime once it has already fetched
everything (I33), so the newest mechanism in the design is the first one proven.

**Contract:** `20-contract.md` §1–§3, §5, §6, §10; §8 I1–I6, I10, I11, I14, I23, I24, I31,
I33 (runtime half), I34
**Touches:** `src/core/`, the determinism guard config, the CI workflow, `package.json`
**Depends on:** nothing
**Blocked by:** nothing. J1.5's blocker was §12 U4, resolved by `90-decisions.md` D39

### Done when

- [ ] **J1.1** `load()` runs the `10-design.md` §3.1 pipeline for an `inline` entry — resolve,
      unwrap, digest, freeze, validate, assemble — with each stage skipped only by
      declaration, never by inference. No stage branches on `at`.
- [ ] **J1.2** `JsonResult`, `ReasonCode`, `JsonMeta`, `JsonRequest`, and `JsonSource` match
      §1–§3 exactly. `load()` never throws and never rejects (I2): a request naming an id
      absent from the map returns `json.unresolved` with `provider: 'none'`, `location: ''`,
      and `id: ''` when the request carried no usable id.
- [ ] **J1.3** Every port is optional. `createJsonLoader(map)` with the `ports` argument
      omitted entirely constructs and loads over a map of inline entries (I33, second half).
- [ ] **J1.4** `createJsonLoader` throws `JsonError('config.missingPort')` naming the entry
      and the port for each of the five map-scoped cases in I6 — `fetch` for an http entry,
      `fs` for a file entry, `clock` for a `ttl` policy, `rng` for retry jitter, `schedule`
      for a timeout or non-zero delay — checked against exactly the entries in the map
      supplied and never a wider set. **I6's sixth clause is deliberately map-independent**
      (D48): a supplied `fetch` port requires a `schedule` port alongside it even where no
      entry declares an http source, because an ad-hoc `JsonRequest.source` can name an http
      URL the map never mentions and carries the default timeout. With neither port supplied
      the ad-hoc attempt runs unbounded and fails on the absent `fetch` — it never throws,
      because I2 admits no exception. Never a silent downgrade.
- [ ] **J1.5** The core's canonical serializer is byte-identical to
      `src/engine/src/core/persistence/canonical.ts` on that module's own test vectors, and
      rejects at least the values that module rejects — **strictly more is permitted, less is
      not** (I13, D49). That file has been read and cross-checked at `f7d8f59` (D39); its
      behaviour is recorded there and is not to be guessed at again. D39 recorded no
      non-plain-object vector, so this package rejects a `Date` and the engine's treatment of
      one stays unknown rather than assumed. Message text is not compared — a rejection is
      compared as a rejection. The serializer accepts exactly `CanonicalValue` (I35): it
      filters `undefined`-valued keys and throws on non-finite numbers, `undefined`, `bigint`,
      symbols, functions, and any object whose prototype is neither `Object.prototype` nor
      `null`.
- [ ] **J1.8** The determinism guard runs against `src/core/` in CI and passes, covering
      **both halves of I1** (D50): the ambient globals, and the bare-specifier ban across
      static imports, dynamic `import()`, and re-exports. The guard is copied from
      `src/engine/eslint.config.js`, and `AbortController` is permitted as the one named
      exception (D34) rather than by relaxing the rule.
- [ ] **J1.9** Each of I1–I4, I5, I6, I10, I11, I14, I24, I31, I34 has a test that fails when
      that invariant is removed from the implementation — demonstrated by removing it, not
      asserted (`00-brief.md` §7.1).
- [ ] **J1.10** Canonical serialization plus the core's own SHA-256: two payloads equal as
      JSON values produce the same `digest` regardless of key order or whitespace, and two
      that differ produce different digests (I5). The digest covers the post-unwrap,
      pre-validation value (D14). The SHA-256 matches the published FIPS test vectors.
- [ ] **J1.11** Every value `load` returns is deeply frozen — on a miss, with caching off,
      after a validator transform, and on a fallback (I14, D21).
- [ ] **J1.12** `unwrap` is never inferred from payload shape; absent means `'none'` and
      `'none'` returns the parsed body exactly as parsed (I4). An `unwrap: 'subzerodev'`
      envelope whose `success` is `false` yields `json.schema` carrying the envelope's own
      error text in `message`; `ok: true` with `data: undefined` is unreachable (I34).
- [ ] **J1.13** Configuration validation raises `JsonError('config.invalidEntry')` naming the
      id and the field for: `version` not `1`, missing `at`, missing `cache` on an http or
      file entry, `cache` present on an inline entry, more than one of `url`/`path`/`inline`,
      an `mtime` policy on a non-file entry, and `retry.attempts < 1` (I31, I24, §10.1).
- [ ] **J1.14** With `fallback` declared, `data` is non-null on every result whatever `ok`
      says; without it, `data` is `null` on every failure (I3). For an inline source
      `meta.provider` is `'inline'`, `bytes` is `0`, `attempts` is `0` (I11), and `validated`
      is true only when a validator ran in this call and returned ok (I10).
- [ ] **J1.15** `loadById` synthesizes a request from a map entry, and `loadMany` returns one
      result per id and never rejects — one failing id does not deny the caller the others.

**Retired:** J1.6 (three cache policies) is now J10.12. J1.7 (retry and backoff) is now
J12.3. Neither id is reused.

**Out of scope:** http and file resolution, and everything the cache implies — J10 and J12.
Leave the provider branch for them unwritten rather than stubbing a reason code J10 would
have to revert. Do not invent an export for the canonical serializer to satisfy J9.1;
`20-contract.md` §9 declares none and §12 U7 is where that is decided. Do not reconstruct what
the engine's serializer probably does either — D39 records what it actually does, and that
record is the only source for it.

---

## J10 — The cache, and file sources through a port

Delivers: The loader stops re-reading things it already has. A payload read twice is
transported once, three declared freshness policies decide when that stops being true, and a
file that changes on disk stops being served from memory. This is also the first slice that
reads anything from outside the process, through a filesystem port a test supplies.

**Contract:** `20-contract.md` §3 `CachePolicy`, §4 `FileSystemPort`/`CacheEntry`/`CacheStore`,
§5, §6 `FileCacheSpec`; §8 I12, I15, I16, I19, I25–I27, I29, I30 (file half), I32
**Touches:** `src/core/`
**Depends on:** J1

### Done when

- [ ] **J10.1** A `file` entry resolves through `FileSystemPort.read`. A path that does not
      exist yields `json.notFound` and is not retried; a permission or IO failure yields
      `json.transport` (`10-design.md` §4.1). `meta.bytes` is the UTF-8 byte length as read
      and `meta.location` is the path the bytes came from (I30).
- [ ] **J10.2** `manual` hits until `invalidate`. `ttl` hits while the injected clock says the
      entry is inside its window and misses outside it. `mtime` hits while
      `(path, mtimeMs, size)` is unchanged.
- [ ] **J10.3** The `mtime` stamp is captured by `stat` **before** the read, never after
      (I25, D36). A `stat` failure is treated as a miss and the read proceeds, with the read's
      own outcome authoritative; the resulting entry carries a null stamp, and a null stamp is
      never a hit.
- [ ] **J10.4** The cache line holds the post-unwrap, pre-validation value (I15, D13). Two
      call sites reading one id with different validators each get their own validated value
      from one shared entry, and `meta.validated` reflects the call, never the entry. A hit
      returns data equal to the first success for an equal validator, with `meta.cached` true
      and `meta.attempts` `0` (I12, I11).
- [ ] **J10.5** The cache key is the source id scoped to the loader instance. An entry records
      the **declared** source it resolved from, and a lookup whose request resolves to a
      different declared source is a miss. *Different* means a different declaration, never a
      different final URL: a source that redirects still caches under the id it was declared
      as, and `location` keeps its I30 meaning untouched (I16, D42). A request supplying its
      own `source` is neither read from, written to, nor stored in the cache.
- [ ] **J10.6** One `CacheStore` handed to two loaders serves neither the other's entries, and
      `invalidate` on either leaves the other's intact (I29, D35). The loader never calls
      `CacheStore.clear()`.
- [ ] **J10.7** `invalidate(id)` drops that id; `invalidate()` bumps this loader's epoch and
      drops only keys this loader owns, including keys that hold no entry yet. `stats()`
      returns `entries`, `hits`, and `misses` — and nothing about eviction or size pressure,
      which §12 U6 records as a known limit rather than an oversight.
- [ ] **J10.8** A failed load neither populates nor evicts the cache. A stale entry is not a
      hit and is not deleted, and no failure path returns it (I19, D18).
- [ ] **J10.9** A `digest: true` request against an entry stored without one computes the
      digest from the cached value and memoizes it into the entry. It never re-transports, and
      never returns `digest: null` under `ok: true` (I32, D29).
- [ ] **J10.10** `dispose()` unsubscribes every watcher this loader registered, drops this
      loader's cache keys, and is idempotent; `[Symbol.dispose]` does the same. A watch is
      registered lazily on the first successful read of a file entry declaring an `mtime`
      policy, never at construction (I26, D31).
- [ ] **J10.11** A file body exceeding a declared `maxBytes` yields `json.tooLarge`, is not
      retried, and writes nothing to the cache (I27).
- [ ] **J10.12** The three `FileCacheSpec` forms — `'manual'`, `{ ttlMs }`, `{ mtime: true }` —
      each drive the behaviour named above, and entries are frozen on every path (I14 still
      holds through the cache).
- [ ] **J10.13** Each of I12, I15, I16, I19, I25, I26, I27, I29, I32 has a test that fails
      when that invariant is removed.

**Out of scope:** http (J12), single-flight and the generation guard (J11), and the real Node
filesystem port (J2) — use a fake port here, which is what makes `mtime` testable without
real elapsed time. Do not add a `keys()` member to `CacheStore` to make `invalidate()`
enumerable; D35 rejected that and put the epoch in the loader instead.

---

## J11 — Single-flight and the generation guard

Delivers: Three components mounting at once and reading the same payload cause one read, not
three, and they all get the same value. Asking the loader to forget something while it is
mid-read actually forgets it, instead of the forgotten value reappearing a moment later.

**Contract:** `20-contract.md` §8 I11 (joined caller), I16, I17; `10-design.md` §5
**Touches:** `src/core/`
**Depends on:** J10

### Done when

- [ ] **J11.1** Concurrent misses for one cache key issue exactly one transport. The rest join
      that load and receive the same frozen value (I17, D15).
- [ ] **J11.2** A joined caller's `meta.attempts` reports the attempts made by the load it
      joined, and its `meta.cached` is `false` (I11).
- [ ] **J11.3** A load stamps the generation it started under and compares before storing. An
      `invalidate` during an in-flight load means the result is returned to every caller and
      nothing is written to the cache (I17, D15).
- [ ] **J11.4** A watch callback firing mid-load invalidates through the same path and is
      covered by the same guard (`10-design.md` §5).
- [ ] **J11.5** A request supplying its own `source` is never joined to an in-flight load and
      never joined against (I16).
- [ ] **J11.6** Validation still runs per caller against the shared value, so two joiners with
      different validators do not share a schema (`10-design.md` §1.4).
- [ ] **J11.7** Each of I17 and the joined-caller half of I11 has a test that fails when that
      invariant is removed. Interleaving is driven by a deferred fake port, not by elapsed
      time.

**Out of scope:** a concurrency bound on fan-out. §12 U5 leaves it undetermined and nothing
here may invent one — record what the unbounded behaviour does and stop.

---

## J12 — HTTP sources: timeout, retry, size bound, and refusing to boot

Delivers: The loader can read from the network, and it does so on a declared budget — one
attempt gives up after a stated time, failures worth retrying are retried and failures that
are not are reported immediately, and a response too large to accept is refused rather than
loaded. A server can also demand that everything it cannot serve without resolved before it
finishes starting.

**Contract:** `20-contract.md` §3 `RetryPolicy`, §4 `ScheduledWait`, §5 `preload`, §6 http
entry, §10; §8 I18, I20, I24, I27, I30
**Touches:** `src/core/`
**Depends on:** J11
**Blocked in part by:** §12 U2 (redirect policy) and §12 U5 (fan-out bound). §12's *Blocks*
column names J1 and J3 for both; under this ordering the http half lands here

### Done when

- [ ] **J12.1** An `http` entry resolves through the fetch port. A non-2xx response yields
      `json.status`; a rejected fetch yields `json.transport`; a truncated or non-JSON 2xx
      body yields `json.parse` and is not retried. `meta.location` records the location the
      bytes came from, not the location requested (I30, D37).
- [ ] **J12.2** `timeoutMs` bounds each attempt and never the call (I18, D16), waiting through
      the `schedule` port. A timed-out attempt is aborted with `AbortController` rather than
      abandoned (D34), and the scheduled wait is cancelled when the attempt settles first so
      no live timer outlives it (D23).
- [ ] **J12.3** Retry applies only to `json.transport`, `json.timeout`, and statuses 408, 429,
      and 5xx — never to other 4xx, `json.parse`, `json.schema`, `json.notFound`, or
      `json.tooLarge` (I18, D16). `backoff` supports `'fixed'` and `'exponential'`; `jitter`
      draws only from the `rng` port and never from an ambient source.
- [ ] **J12.4** A body exceeding a declared `maxBytes` yields `json.tooLarge`, checked against
      `Content-Length` where present and against the decoded length always, not retried and
      not cached (I27, D33). Where a declared `Content-Length` is what refused it,
      `meta.bytes` carries **that declared length** — no body was received to measure, and the
      declared length is the number the refusal was made on. Absent `maxBytes` is unbounded —
      no default is invented.
- [ ] **J12.5** `preload` performs a full load per id, writes the cache under each entry's
      declared policy, resolves every id before failing, and rejects with
      `JsonError('preload.failed')` naming every failed id in `failures` — never only the
      first (I20, D17). It is the only member of `JsonLoader` that rejects.
- [ ] **J12.6** A ttl entry preloaded at boot and read after its window expires fails like any
      other expired entry. `preload`'s guarantee is that every named id resolved once, at the
      moment it was called (D38) — assert this rather than leaving it to be discovered.
- [ ] **J12.7** Nothing in the core throws a bare `Error` or a string; every throw and every
      rejection is a `JsonError` with an enumerated `code` (I24), and `load` still throws
      nothing at all (I2).
- [ ] **J12.8** Each of I18, I20, I27, I30 has a test that fails when that invariant is
      removed, driven by a fake fetch port and a fake scheduler — no test waits on real
      elapsed time.
- [ ] **J12.9** With the core complete, `node harness/run-real.mjs` runs the same probes
      against the real, built core and every probe that still reproduces is accounted for —
      as a genuine regression, or as a finding the design accepted. `harness/run.mjs` stays
      on the reproduction (`90-decisions.md` D56) — it is what *Regression corpus* below and
      `harness/README.md` mean by "the harness". F9 (redirects, U2) and F11 (fan-out, U5) are
      expected to keep reproducing and are not regressions; F10 rested on U4 and no longer
      has that excuse, so a probe that still reproduces after J1.5 is a genuine regression.
      See *Regression corpus* below for why this check belongs at the end of this slice.

**Out of scope:** redirect policy, including whether redirects are followed and what happens
to a declared header across an origin change — §12 U2 is undetermined and this slice records
the observed behaviour of whatever fetch port it is handed rather than specifying one.
Streaming and chunking are F5. A total-call timeout was rejected by D16 and is not to be
added as a convenience.

---

## J2 — Node: filesystem port, composed ports, GET-only mount, YAML CLI

Delivers: Everything a Node process needs to use the loader for real — a filesystem port
backed by the actual disk, a one-call set of ports wired to the Node runtime, a read-only
HTTP mount that serves loaded payloads and translates failures into honest status codes, and
the YAML-to-JSON conversion that replaces the two hand-rolled converters this package exists
to retire.

**Contract:** `20-contract.md` §9 (`/node`); §8 I24, I25, I28, I37
**Touches:** `src/node/`
**Depends on:** J10 (for the `mtime` policy the port serves), J12 (for the router's failure
mapping)
**Blocked by:** nothing. J2.3's blocker was §12 U3, resolved by `90-decisions.md` D41

### Done when

- [ ] **J2.1** `nodeFileSystem()` supplies `read`, `stat`, and `watch`, and `watch` returns a
      working unsubscribe.
- [ ] **J2.2** Against a real file on disk, the `mtime` policy invalidates on
      `(path, mtimeMs, size)` and never returns a stale read; the stamp is taken before the
      read (I25, D36). D36's known-and-retained limit — a same-size edit inside the
      filesystem's mtime resolution — is written into the test as a documented gap, not left
      to be rediscovered as a bug.
- [ ] **J2.3** `convertYamlToJson(from, to)` reproduces the behaviour of both existing
      converters, recursive directories included, and is exposed as a CLI. The parser is
      `js-yaml` `^4.1.0` on its `DEFAULT_SCHEMA` (`90-decisions.md` D41, which discharges
      §12 U3 and names the alternatives rejected).
- [ ] **J2.4** `jsonRouter` mounts GET routes only. No write verb is reachable through it, and
      the package writes nothing at runtime (`00-brief.md` §5.1).
- [ ] **J2.5** `envelope()` produces the shape `unwrap: 'subzerodev'` consumes, verified by a
      round-trip test — owning both ends is the point (D28). The round-trip covers **both
      halves**: the success envelope `envelope()` writes, and the failure envelope
      `jsonRouter` writes under I28. A test that exercises only the success side is how D45's
      divergence survived, so a shape divergence on either half fails this criterion.
- [ ] **J2.7** The router maps reason to status per I28 and never forwards the upstream
      status (D20): `json.unresolved` and `json.notFound` to 404; `json.timeout` and
      `json.transport` to 504; `json.status`, `json.parse`, `json.schema`, and
      `json.tooLarge` to 502. Its failure body is `{ success: false, message }` carrying the
      **result's own `message`** — the field the core's `'subzerodev'` unwrap reads (I34), so
      a data-json client of a data-json server receives the real text rather than generic
      fallback prose (D45).
- [ ] **J2.8** `nodePorts(overrides?)` composes `fetch`, `fs`, `clock`, `rng`, and `schedule`
      from the Node runtime, with any supplied override winning. A loader constructed with it
      satisfies I6 for any entry kind.
- [ ] **J2.9** Every throw originating in `/node` is a `JsonError` with an enumerated code
      (I24). No bare `Error`, no string.

**Retired:** J2.6 (`preload` rejects on any failure) belonged to the core and is now J12.5.
The id is not reused.

**Out of scope:** write support of any kind — D5 and `00-brief.md` §5.1 are binding, and F2
gates it on a second consumer. Do not add a write member to `FileSystemPort` to make the
build's job easier; D19 rejected exactly that. **A YAML-to-`SourceMap` reader is not in this
slice**: `convertYamlToJson` converts files, not configuration. §12 U8 left the reader
undesigned when this slice was written and it is now designed, but it belongs to **J13** —
either way, not here.

---

## J3 — Build: prefetch, lockfile, derived runtime map, and the gates

Delivers: The build resolves every payload declared as build-time, writes them next to the
application, and records what it got in a committed lockfile so two builds over unchanged
content are provably identical. It also emits a rewritten configuration in which those
payloads are already present, so the running application resolves them without any network or
disk at all — and it refuses to finish if a server-only source has reached anything a browser
can read.

**Contract:** `20-contract.md` §6, §7, §9 (`/build`), §11; §8 I7, I8, I20, I21, I22, I23,
I30, I33, I37
**Touches:** `src/build/`, the CI workflow
**Depends on:** J1, J12
**Blocked in part by:** §12 U2 (redirect policy affects what the lockfile attests)

### Done when

- [ ] **J3.1** `prefetch(map, outDir, ports)` resolves every `at: build` source with digests
      requested, writes one artifact per source into `outDir`, and returns
      `PrefetchOutput { lock, runtimeMap }`. Exactly one source map is read per pass — public
      or server, never both (`10-design.md` §3.2). The map arrives already in memory; nothing
      here reads YAML — the reader is `/node`'s and the slice is J13.
- [ ] **J3.2** The lockfile matches §7. Each entry carries exactly `id`, `digest`, and
      `location` — no `resolvedAt` or other clock-derived field (D47).
- [ ] **J3.3** Two builds over unchanged remote bytes produce identical digests **and a
      byte-identical lockfile**, compared whole with nothing excluded, with entries emitted in
      sorted-id order through the canonical serializer (I21, D47). Changed bytes produce a
      changed digest and a diff that means something.
- [ ] **J3.4** `assertNoServerSourcesInBundle` throws `JsonError('build.serverSourceLeaked')`
      naming the offending id and file. The guarantee is **filename-scoped** (I7, D46): no
      file whose basename is a server-map source id appears in the public output directory.
      That catches a prefetched artifact written where a browser can read it, and nothing
      else — a server URL or a declared header name inlined into a JS chunk passes it, and
      the test says so rather than implying a wider gate. Asserted in CI, not by convention.
      Widening to a content scan is issue #37 and is not contracted.
- [ ] **J3.5** A source missing `at:` is `config.invalidEntry` naming the offending id, and
      the build fails.
- [ ] **J3.6** An `at: build` source is never fetched at runtime and an `at: runtime` source is
      never resolved at build (I8). `prefetch` constructs its loader over the map filtered to
      its `at: build` entries, so the build demands under I6 exactly the ports the entries it
      resolves need and never a port for an `at: runtime` entry it is guaranteed not to touch.
- [ ] **J3.7** Every `at: build` entry in the emitted `runtimeMap` has become an inline entry
      carrying the resolved data, keeping `at` and `schema` and carrying none of `unwrap`,
      `cache`, `maxBytes`, `timeoutMs`, or `retry` (I33). A loader constructed from that map
      with the `ports` argument omitted resolves those ids, and no stage of the pipeline
      branches on `at` (D24).
- [ ] **J3.8** The public/server gate runs after the last write into the public output
      directory (I22), demonstrated by a test in which a later writer would otherwise have
      slipped a leak past it.
- [ ] **J3.9** `assertNoDuplicateIds` throws `JsonError('config.duplicateId')` naming the id
      and both files when one id appears in both the public and the server map (I23).
- [ ] **J3.10** A failure in any `at: build` source fails the build with
      `JsonError('build.failed')` naming **every** failed id (I20, D17). Nothing is written and
      the previous build output is untouched.

**Out of scope:** importing `/node`. `10-design.md` §2 and I37 state `/build` does not depend
on it — `/build` reads through whatever ports it is handed and writes with the Node runtime
directly (D19). The consumer composes the two, not the module graph. Do not read both source
maps in one pass to save a step, and do not add a YAML reader to close what was §12 U8 from
this side — that reader is J13's, and `/build` reaches it through the composition root rather
than through the module graph (I37).

---

## J5 — Zod

Delivers: A consumer with a zod schema can hand it to the loader directly, without the
package knowing anything about zod and without a zod-free consumer paying for it.

**Contract:** `20-contract.md` §9 (`/zod`); §8 I37
**Touches:** `src/zod/`, `package.json` peer dependencies
**Depends on:** J1

### Done when

- [ ] **J5.1** `zodValidator(schema)` returns a `Validator<T>`. A failure yields
      `reason: 'json.schema'` with the zod message in `message`, and a schema that throws is
      caught and reported the same way (§10.2).
- [ ] **J5.2** zod is an optional peer dependency. A consumer importing only the core or
      `/node` does not resolve it.

**Out of scope:** authoring schemas, or shipping any. `00-brief.md` §5.6 makes validation a
seam and schemas the consumer's. Do not re-export zod types through the core.

---

## J4 — React

Delivers: A React component reads a named payload with one hook and renders loading, error,
and success states from the reason code rather than from a message string.

**Contract:** `20-contract.md` §9 (`/react`); §8 I37, I39
**Touches:** `src/react/`, `package.json` peer dependencies
**Depends on:** J1
**Was blocked by:** §12 U1, resolved as `90-decisions.md` D53 — the loader arrives through a
`JsonProvider` context, and both 2026-08-06 signatures stand unchanged.

### Done when

- [ ] **J4.1** `useJson(id)` returns the core's `JsonResult` plus `loading` and `refetch` —
      not a reshaped parallel type.
- [ ] **J4.2** `JsonBoundary` renders loading and error states from `reason`, not from message
      strings.
- [ ] **J4.3** No `Date.now` or `Math.random` in a render path or a hook dependency array —
      the existing `HttpDataProvider` calls `Date.now()` inside a `useMemo` dependency and
      that is not reproduced.
- [ ] **J4.4** Unmounting — or `id` or the provider's loader changing — discards an
      in-flight call's result instead of committing it: no state update after unmount, and
      no stale `(id, loader)` pair's result rendered under a new one. `JsonLoader.loadById`
      (§9) carries no cancellation token, so the underlying request itself is not aborted
      (D55).
- [ ] **J4.5** The same call site compiles and behaves identically under either `at:` value
      (I9).
- [ ] **J4.6** `useJson` and `JsonBoundary` rendered with no `JsonProvider` above them each
      throw `JsonError('config.missingProvider')` — not `json.unresolved`, and not a bare
      `Error` (I39, I24). That throw does not weaken I2: no loader was reached, so `load` was
      never called. Nested providers resolve to the nearest, and two loaders in one tree serve
      their own caches.
- [ ] **J4.7** `JsonProvider` accepts a loader and never constructs one, and unmounting it
      does not dispose the loader it was given: after the unmount the loader still reads, and
      its watchers are still registered (I39, D31).

**Out of scope:** `useJsonLoader()`. D53 rejected it for now rather than on the merits, and
adding it needs a slice that states the requirement — not a session that finds it convenient.
Do not add a store binding on the way past either — `00-brief.md` §6 mentions an optional store
binding and `20-contract.md` §9 exports none, so it is not in this slice.

---

## J13 — Node: reading a source map out of the YAML it is written in

Delivers: A Node server or a build reads its configuration straight from the file a human
wrote it in, instead of every consumer inventing its own way to turn that file into something
the loader accepts. A configuration mistake is reported when the file is read — naming the
file, and the entry and field at fault — rather than surfacing later as a payload that will
not load.

**Contract:** `20-contract.md` §6, §9 (`/node`, `parseSourceMap` and `readSourceMap`), §10.1
(`config.invalidEntry`, `config.unreadable`), §11 (source maps row); §8 I24, I37, I41, I42
**Touches:** `src/node/`
**Depends on:** J1 (the entry check the reader applies is the core's), J2 (the module, its
YAML parser, and its filesystem)
**Blocked by:** nothing. This slice *is* the resolution of what was §12 U8
(`90-decisions.md` D62 for the module, D63 for the signatures)

### Done when

- [ ] **J13.1** `parseSourceMap(text)` returns the `SourceMap` §6 declares — the parsed
      document, not a normalized one. The returned value handed to `createJsonLoader`
      constructs a working loader, and the loader normalizes it itself, once, at construction
      (I41). No second shape for one configuration is introduced.
- [ ] **J13.2** Every per-entry fault the core rejects, the reader rejects, with the same
      `JsonError('config.invalidEntry')` naming the same id and field: `version` not `1`,
      missing `at`, missing `cache` on an http or file entry, `cache` present on an inline
      entry, more than one of `url`/`path`/`inline`, an `mtime` policy on a non-file entry,
      and `retry.attempts < 1` (§10.1).
- [ ] **J13.3** A shared fixture corpus is asserted against **both** `createJsonLoader` and
      `parseSourceMap`, and the two agree on every case — that is what makes I42's "exactly
      the maps `createJsonLoader` accepts" checkable rather than reviewed, and it fails if
      `/node` grows a second copy of §6's rules that drifts from the core's. Accepted and
      rejected counts are both stated and both non-zero (`AGENTS.md`, *Verification*).
- [ ] **J13.4** The one check the core cannot make, because its own input is already typed:
      text that is not YAML, and a document that parses to something other than an object
      carrying a `sources` record, each yield `config.invalidEntry` naming the file-level
      fault rather than an id (I42). No `YAMLException` and no bare `TypeError` escapes
      either function (I24).
- [ ] **J13.5** `readSourceMap(path)` is the file half, built on the parser. An absent path, a
      directory, and a permission or IO failure each yield `JsonError('config.unreadable')`
      naming the path and the underlying reason — never `config.invalidEntry`, because no
      bytes arrived and so no id can be named. `parseSourceMap` never raises
      `config.unreadable`: it is handed text and cannot fail that way (D63).
- [ ] **J13.6** The split is where the failure was, not which function was called: a file that
      exists and reads cleanly but carries a bad entry yields `config.invalidEntry` out of
      `readSourceMap`, with the id and field named exactly as `parseSourceMap` would have
      named them.
- [ ] **J13.7** Both functions are exported from the `/node` subpath and from nowhere else.
      `/node` reaches the core's check by relative import into `src/core/` and imports no
      sibling leaf, and the core gains no new public export to serve this (I37,
      `10-design.md` §2).
- [ ] **J13.8** I42 has a test that fails when the invariant is removed, demonstrated by
      removing it rather than asserted (`00-brief.md` §7.1).

**Out of scope:** converting data files. `convertYamlToJson` is J2's, it reads data rather
than configuration, and the two paths share nothing beyond the parser (§9) — do not route one
through the other. Do not normalize in the reader; I41 makes that the loader's, once. Do not
read both maps in one pass, merge them, or check cross-file duplicate ids — `assertNoDuplicateIds`
is `/build`'s (I23, J3.9) and this reader is handed one file. Do not watch the file for changes:
a changed map means a new loader (`10-design.md` §1.2), not a reload. Do not migrate a consumer
onto it here — that is J6+J7 — and do not add a writer, which `00-brief.md` §5.1 forbids
outright.

---

## J6+J7 — Migrate Docs-Template and Portfolio/api

**One gate, both consumers.** Landing the browser first lets the core accrete browser
assumptions, and the isomorphism claim then becomes retroactive (`10-design.md` §2).

Delivers: The two repositories this package was written for stop carrying their own loaders.
Four divergent HTTP paths, three unrelated cache policies, two copies of the same
provider-selection function, and the untyped file reads behind the API all become one
declared configuration and one call. The line count goes down; if it does not, the design is
wrong.

**Contract:** all of `20-contract.md`
**Touches:** `Docs-Template`, `Portfolio`, `Portfolio/api`, `config/sources.public.yml`,
`config/sources.server.yml`
**Depends on:** J2, J3, J4, J5, J13. The §12 U1 block that reached this slice through J4 is
lifted (`90-decisions.md` D53), and so is the §12 U8 block that was stated here

**Blocked by:** nothing. U8 was this slice's block — J6.4 and J6.6 put sources into
`config/sources.public.yml` and nothing turned that file into a `SourceMap`. It is resolved
(`90-decisions.md` D62, D63), and the bridge is J13 rather than a signature this slice invents
on the way past. The two consumers still need different halves of it: the browser reaches its
map through the build's derived runtime map (I33), and the API reads `sources.server.yml` at
runtime through `readSourceMap`.

### Done when

- [ ] **J6.1** These are deleted: `src/services/dataLoader.ts`,
      `src/context/HttpDataProvider.tsx`, `src/hooks/useApi.ts`, both copies of
      `getProviderType`, and the `getData` content-keyed cache.
- [ ] **J6.2** `useAuthenticatedFetch` either composes with the loader or is retained
      deliberately, with its retention recorded — it owns 401-refresh, which is out of scope
      here (`00-brief.md` §5.5).
- [ ] **J6.3** `DataProvider` survives as feature-gate composed with `useJson`, not as a
      component that also picks a provider, fetches, caches, and unwraps. It sits below a
      `JsonProvider` the application mounts at its composition root (I39).
- [ ] **J6.4** `projectsPage.source`, `portfolioPage.source`, and `cvPage.source` move to
      `config/sources.public.yml`; the `FeatureToConfigMap` source lookup is gone.
- [ ] **J6.5** Every remote payload has a declared schema and passes it.
- [ ] **J6.6** Every existing HTTP source has an explicit `at:` — a migration decision per
      source, not a default (D3).
- [ ] **J6.7** The `{ success, data }` heuristic is gone; call sites that need it declare
      `unwrap: 'subzerodev'`.
- [ ] **J6.8** Every migrated source declares an explicit `cache:` (I31, D32). In particular
      `HttpDataProvider`'s 5-minute TTL is carried across as `cache: { ttlMs: 300000 }` or
      changed on purpose with the change recorded — D32 names this exact source as the one a
      line-deleting migration would silently turn static.
- [ ] **J6.9** Each migrated repository reaches its `SourceMap` through J13's reader — the API
      through `readSourceMap`, the browser through the build's derived runtime map (I33) — and
      neither repository hand-rolls a YAML reader of its own. A second private
      parser in a consumer is the duplication this package exists to retire, reappearing one
      layer up.
- [ ] **J7.1** `FileUtils.readJsonFile` and `fileExists` are replaced by the loader.
      `JsonFileRepository` keeps its filter, sort, paginate, and write logic.
- [ ] **J7.2** Per-request full-file reads are replaced by `mtime`-cached reads.
- [ ] **J7.3** `JsonFileRepository`'s lost-update race and mid-write truncation are **recorded
      in that repository** as known-and-retained, with the reasoning. They are out of scope
      here (`90-decisions.md` D5) and must not simply disappear from the record.
- [ ] **J7.4** Both YAML→JSON converters are replaced by the J2 CLI.
- [ ] **J7.5** **The migration deletes more lines than it adds.** If it does not, stop: the
      design is wrong and this is where that surfaces (`00-brief.md` §7.3).

**Out of scope:** fixing the `JsonFileRepository` defects J7.3 records. D5 leaves them
unowned deliberately, and repairing them here converts a scoping decision into an unreviewed
one. Do not migrate `Data` on the way past — that is J8. **Do not build or extend the YAML
reader here**: it is J13's, and a migration that reshapes it under its own pressure reshapes it
for one consumer's convenience rather than for both — which is why U8 was answered by
`/contract` and not by this slice. **Do not change what `useJson().refetch()` does either**,
however plainly the migration wants it to: `20-contract.md` §9 declares the signature and
names no semantics, `10-design.md` names none, and `90-decisions.md` records that under a
`manual` policy it can never return a fresh value. That is a decision owed before it is code,
and it is not this slice's to take.

---

## J8 — Data repository adopts the CLI

Delivers: The content repository stops maintaining its own YAML-to-JSON step and uses the
published one, with proof that the files it publishes did not change in the process.

**Touches:** `Data/build.ts`
**Depends on:** J2

### Done when

- [ ] **J8.1** `Data/build.ts` uses the published CLI; its bespoke `processYamlToJson` is
      deleted.
- [ ] **J8.2** Published artifact bytes are unchanged from before the migration — asserted,
      not assumed.

**Out of scope:** changing what `Data` publishes. A byte difference here is a defect in J2.3,
not an improvement to the content.

---

## J9 — GameEngine adoption *(deferred)*

**Gated on content packs existing.** v1 makes this possible; it does not schedule it.
Nothing in J1–J8 may depend on J9.

Delivers: The game engine deletes its own copy of the canonical serializer and imports this
one, retiring a duplication that has been deliberate and dated since D9, and starts using
build digests as content-pack identity.

**Touches:** `SubZeroDev.GameEngine`
**Depends on:** J1, and a GameEngine consumer that actually loads JSON
**Blocked by: `20-contract.md` §12 U7.** J9.1 needs a public canonical-serialization export
and §9 declares none. D44 removed the three the core index carried by accident, precisely so
the export set is decided against J9.1's stated requirement rather than against whatever a
slice happened to export — which function or functions become public, and under what
signatures, is a `/contract` amendment. Adding an export later is additive; removing one after
publication is not. §12 U4 no longer blocks this slice (D39)

### Done when

- [ ] **J9.1** The engine imports the package's canonical serializer and deletes
      `src/engine/src/core/persistence/canonical.ts`, retiring the I13 duplication.
- [ ] **J9.2** The engine's determinism harness passes with the package in the graph. This is
      also where `10-design.md` §7 Q4 is answered rather than speculated about: whether that
      guard bans ambient timers is checkable here and nowhere else.
- [ ] **J9.3** `json.lock` digests feed content-pack identity. The engine owns
      `campaignVersion` semantics; this package supplies the digest primitive and nothing
      above it (`00-brief.md` §5.7).

**Out of scope:** `campaignVersion` semantics, content-pack resolution, and anything above the
digest — `00-brief.md` §5.7 is binding in both directions.

---

## Invariants landed outside the slice plan

Three contracted invariants were appended after the slice that would have carried them had
already merged, and were implemented through `/fix` rather than through a slice. They are
recorded here so that "which slice proves I37?" has an answer, and **not** as criteria on a
closed slice — appending a permanently unticked box to a merged issue would make the tracker
lie in the other direction.

| Invariant | Contracted | Landed | Proven by |
|---|---|---|---|
| **I35, I36** — the canonical value domain, enforced on every load | D40, the 2026-08-07 pass | `1dc18e7` (#23), immediately after J1 merged | `src/core/loader.test.ts`, *I35/I36: canonical value domain, enforced on every load* |
| **I37** — no leaf module imports another leaf | D51, `6abde9f` (#48) | same commit | `src/boundaries.test.ts`, which lints a violating fixture rather than asserting the real tree is clean — the latter passes with the rule deleted (D50) |
| **I38** — exactly one `JsonEvent` per completed load | D52, `6abde9f` (#48) | `530ca3b` (#50) | `src/core/loader.test.ts`, `cache.test.ts`, `join.test.ts` |

I37 is listed on the `Contract:` line of all four leaf slices because it constrains each of
them; it is a single guard, not four.

**One more is owed and takes the same route.** D61 narrowed I17 to concurrent *cache-eligible*
misses and extended I40 alongside it, after J11 — the slice that proves I17 — had already
merged. `src/core/pipeline.ts` already behaves that way, so no pipeline change is owed; what is
owed is the test, in both directions, because `JsonRequest.cache: false` is exercised by no
test anywhere in the tree and under `00-brief.md` §7.1 an invariant whose test still passes with
the invariant removed is not a contracted invariant. That is **`/fix`'s**, at `sonnet`,
`medium`, and it gains a row in the table above when it lands. It is deliberately **not** a new
slice and **not** a criterion appended to J11: J11 is merged, and an appended box would leave
its issue permanently unticked, which is the failure this section exists to avoid.

## Regression corpus

`harness/` reproduces the red-team findings as originally reported (`node harness/run.mjs`,
no install). It is not `src/` and nothing in it moves there (`harness/README.md`).

The probes run against `harness/core.mjs`, a reproduction — so a green harness is evidence
about the reproduction, not about the shipped core. Once the core slices land, a probe that
**keeps** reproducing against the real core means an amendment did not land. That check is
**J12.9** (`node harness/run-real.mjs`, D56), and it is stated as a criterion rather than as
prose here because a check that lives only in a narrative section is a check nobody runs.
Probes for findings still open — F9
(redirects, U2) and F11 (fan-out, U5) — are expected to keep reproducing and are not
regressions. F10 (untestable) rested on U4 and no longer has that excuse: D39 read the
cross-check target, so a probe that still reproduces after J1.5 is a genuine regression.

## Contract gaps

**Both gaps this document used to record have moved to `20-contract.md` §12**, which is the
register that answers them; this section is a pointer, not a second copy (`AGENTS.md`,
*Single ownership*).

- **§12 U8 is closed.** Nothing turned `sources.*.yml` into a `SourceMap`; §9 now declares
  `parseSourceMap` and `readSourceMap` under I42 (`90-decisions.md` D62, D63). Was gap 1. It
  blocked **J6+J7** and it no longer does — the work is **J13**, and J2 and J3 still leave it
  alone.
- **§12 U7** — no public canonical serializer. Was gap 2. Blocks **J9**.
- Gap 3, `meta.location` for an `inline` source, is **closed**: `20-contract.md` §1 states that
  `location` is `''` both when nothing resolved and for an `inline` source, and that `provider`
  is what distinguishes them.

No slice above may invent a signature for an open U-item (`AGENTS.md`, *Hard rules*). Each is
answered by `/contract`, at `opus`, `high`.

One routing note, for the same reason: §12's *Blocks* column names **J1 and J3** for U2 and
U5. Under this ordering the http work is J12 and the fan-out is J10 and J12; the U-items
themselves are unchanged, and the column is a pointer to the design-era slice numbering rather
than an error.
