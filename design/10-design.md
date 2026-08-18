# Design — SubZeroDev.Data.Json

Architecture, data model, and failure semantics. Exact types live in `20-contract.md`; this
file explains why they have the shape they do and settles the things the types alone do not
say. Decisions and their reversal costs are in `90-decisions.md`, which is also where the
revision history of this document lives — it is not repeated here.

**Nothing here contradicts the contract.** Where this document decides something, the decision
is logged; where the contract has since determined something more precisely than this file
said, the contract's reading is the one written here.

## 1. Data model

The system has eleven entities. Two are persisted configuration a human writes — the source
map and the entries in it. Three are build output, regenerable from that configuration. The
remaining six exist only for the duration of a call or the life of a loader.

### 1.1 Identity

**A source id is the only identity in the system.** It keys the source map, the cache, the
lockfile, the prefetched artifact, and `invalidate`. There is no second handle — no opaque
token, no per-request id, no cache key the caller can see or construct.

Ids are unique within a source map. An id appearing in *both* the public and the server map
is a configuration error the build gate rejects: an id whose meaning depends on which file
you read is exactly the ambiguity the two-file split exists to prevent (`90-decisions.md`
D6, D12).

A cache entry records the **declared source** it was written under, and a lookup is a hit only
where the source the request resolves to equals it — for an http source, url and headers both.
It also records the location the bytes came from, but that is recorded, never compared: under
D37 `location` is the *final* location, so a source that redirects would otherwise never match
its own still-static declaration and would miss forever (`90-decisions.md` D42,
`20-contract.md` I16).

A call passing an explicit source under an id already in the map is handled by a separate rule,
not by this comparison: an ad-hoc `JsonRequest.source` is neither read from, written to, nor
joined against the cache at all.

### 1.2 Entities

| Entity | Lives | Owned by | Identity | Lifecycle |
|---|---|---|---|---|
| **Source map** | Persisted, YAML, two files | The consuming repository | The file it came from | Read once, at build or at loader construction. Never reloaded — a changed file means a new loader |
| **Source entry** | Persisted, a row in a map | The consuming repository | Its id | Created and edited by hand, in review |
| **Normalized source** | In-memory | The loader | Its entry's id | Derived once at construction from the entry or a bare string; never re-derived per read |
| **Request** | In-memory, per call | The caller | None — a value | Constructed by the caller, or synthesized from a map entry by `loadById` |
| **Cache entry** | In-memory, per loader | The loader | Its source id | Written on success, replaced by a later success, dropped by `invalidate` or by the loader's `dispose` (§1.5). Never persisted, never shared between loaders or processes |
| **Meta** | In-memory, per result | The loader | None | Wholly derived (§1.3) |
| **Result** | In-memory, per call | The caller once returned | None | Discarded by the caller |
| **Event** | In-memory, transient | The log port | None | Fire-and-forget; nothing may depend on delivery |
| **Prefetched artifact** | Persisted, one JSON file per `at: build` source | The build | Its source id | Rewritten by every build; regenerable |
| **Derived runtime map** | Returned by the build, persisted by whoever it is handed to | The build | The map it was derived from | Emitted by every build; regenerable. Never hand-edited (§3.2) |
| **Lockfile** | Persisted, one per build target | The build | The build | Rewritten by every build; committed so builds are comparable |

The source map is the only persisted thing a human writes. The three build outputs are
regenerable from it, and a build rewrites all of them wholesale rather than merging.

### 1.3 Derived fields

Every field of `JsonMeta` is derived. Naming the derivation is the point, because two of
them are the design decisions most expensive to change later.

| Field | Derived from |
|---|---|
| `id` | The request |
| `provider`, `location` | The normalized source. `location` is `''` when nothing resolved and for an `inline` source; `20-contract.md` §1 owns which is which. On a cache hit, the entry's stored location — the bytes came from there when they were read |
| `bytes` | UTF-8 byte length of the body as received. `0` for `inline`. On a cache hit, the stored value — the payload was that size when it was read |
| `digest` | SHA-256 over the canonical serialization of the **post-unwrap, pre-validation** value. `null` unless requested |
| `cached` | Whether the value came from the cache line |
| `attempts` | Transport attempts made **by this call**. `0` for `inline` and for a cache hit; `1` on a first-try success |
| `validated` | A validator ran *in this call* and returned ok. Never true otherwise |

Two of those need their reasoning stated.

**The digest sits after unwrap and before validation** (`90-decisions.md` D13, D14). After
unwrap, because a transport envelope is not content: the same payload moving from a bundled
import to an enveloped HTTP endpoint must not change its digest, and that migration is a
real one this package exists to make cheap. Before validation, because `Validator<T>` may
transform — a schema with defaults or coercion produces a value that is the consumer's, not
the source's. A digest that depended on the consumer's schema would make two consumers of
one payload disagree about its identity, which destroys the lockfile's meaning and the
content-pack primitive the GameEngine needs from it (`00-brief.md` §5.7).

**A cache hit reports `attempts: 0`**, on the same reasoning as `inline`: no transport
occurred. `cached: true` already carries "this value was read earlier". `20-contract.md` I11
states this.

`bytes` and `location` on a hit are the entry's stored values rather than anything re-derived
on the call, for the same reason (`20-contract.md` I12). Both are facts about a read that
already happened, and there is nothing on a hit to derive them from — no body was received to
measure and no request was issued to be redirected. A hit that recomputed them would have to
invent them.

### 1.4 What the cache line holds

The cached value is the **post-unwrap, pre-validation** value — the same position as the
digest. Validation runs per call, against the shared value.

This is what makes the cache correct when two call sites read one id with different
validators: the expensive and shared work (transport, decode, parse, unwrap, digest) happens
once; the per-caller work (validation, and any transform it applies) happens per caller.
`meta.validated` is therefore a property of the call, not of the entry. `20-contract.md` I12
says a hit returns data equal to the first success; that holds for equal validators and is
deliberately not claimed for unequal ones.

**Every value the loader returns is frozen** — not only the cached ones. Freezing only cached
values would make mutability depend on a cache policy the call site cannot see, and a call
site's behaviour must not change when a source's configuration does (`20-contract.md` I9 is
the same principle applied to `at:`).

### 1.5 The loader's own lifetime

A loader owns two things that outlive a call: its cache entries, and any filesystem watchers
it registered. Both end together, and they end only when whoever constructed the loader says
so (`90-decisions.md` D31, `20-contract.md` I26).

**A watch is registered lazily**, on the first successful read of a file entry declaring an
`mtime` policy — never at construction. Registering eagerly opens a watcher per file entry
whether or not anything reads it, and forces a not-yet-existing path to be handled before any
read has been attempted. The cost of lazy registration is a first-read side effect, which is
the cheaper of the two.

**`dispose` is the only unwind**, and it is the loader's, not a component's. It unsubscribes
every watcher and drops this loader's cache keys, so a disposed loader holds no process open.
`/react`'s provider accepts a loader and never constructs one, and therefore never disposes
one (`90-decisions.md` D53): a component that did would unwind state belonging to a
composition root that may still be using it. This is why §5's "the cache is per loader" stays
true under React — nesting two providers nests two independent caches, and neither can end the
other's.

## 2. Module boundaries

Five modules. The graph is a **star**: every module depends on the core, no module depends on
a sibling, and the core depends on nothing at all.

```
                 react ──┐
                 zod   ──┤
                 node  ──┼──▶ core ──▶ (nothing)
                 build ──┘
```

Acyclic by construction, and the only way to break it is a leaf importing a leaf. That is the
thing to guard against, and it has a cheap guard: the core's out-degree is zero and each
leaf's in-degree from siblings is zero, both checkable mechanically — and both now checked,
the second as `20-contract.md` I37 with a test that fails when the rule is neutered
(`90-decisions.md` D50, D51). A guard nothing exercises reports green whether or not it works.

| Module | Owns | Depends on | Exposes |
|---|---|---|---|
| **core** | The pipeline, the source union, the result and reason vocabulary, the cache, canonical serialization, the digest, the port interfaces | Nothing. No module, no global | `load`, the loader factory, source normalization, and the types everything else is written against |
| **node** | The Node filesystem port, the YAML→JSON conversion the CLI wraps, **reading a source map from YAML**, the GET-only HTTP mount, the response envelope | core, the Node runtime, a YAML parser (§7 Q3) | A filesystem port, a composed port set, a source-map reader, a router, the envelope and its producer |
| **react** | The hook and boundary bindings, mount and unmount lifecycle, and the context a call site reaches its loader through | core, React as an optional peer | `JsonProvider`, `useJson`, `JsonBoundary` |
| **zod** | The adapter from a zod schema to the core's validator seam | core, zod as an optional peer | A validator factory |
| **build** | Build-time resolution, artifact, runtime-map and lockfile emission, the public/server gate | core, the Node runtime | Prefetch, and the bundle assertion |

**`/build` does not depend on `/node`.** It reads through whatever ports it is handed and
writes with the Node runtime directly. That keeps the filesystem port read-only — the package
is read-only, and a write member on the port would be the seam through which that stops being
true (`90-decisions.md` D19). A consumer that wants Node's filesystem port composes it from
`/node` and passes it in; the two modules meet in the consumer, not in the graph.

**`/node` owns the step from a YAML source map to a `SourceMap`** (`90-decisions.md` D62). It
is the module that already carries a YAML parser and a filesystem, and configuration is read
in exactly two places — a Node server's composition root and a build — both of which are Node.
The browser never reads YAML at all: it receives its map as `/build`'s prefetch output, already
a value (I33). So the reader goes where the parser already is, and `/build` reaches it the same
way it reaches the filesystem port — through the composition root, never through the graph. The
star is untouched.

**The shape check that reader applies is the core's, not a second copy.** Every rule a source
map must satisfy — `at` present, `cache` required on http and file entries and forbidden on
inline, one of `url`/`path`/`inline`, `version: 1` — is already enforced where a loader is
constructed, and a reader with its own copy is two implementations of one rule with nothing
saying which is authoritative. Reading is `/node`'s; deciding what a valid entry is stays the
core's, and `20-contract.md` I42 is what makes that checkable rather than a claim. The reader
adds exactly one check the core's cannot, because the core's input is already typed: that the
parsed document is an object carrying a `sources` record at all (D63).

This costs the core no public surface. A leaf reaching relatively into `src/core/` is what I37
permits and the star graph is built on, so the shared check is reached the way `/build` already
reaches canonical serialization — internally. The narrow-surface rule below and the reader
decision here do not pull against each other.

**The core's public surface is deliberately narrower than what the core owns.** It owns
canonical serialization and the digest; it exposes neither. That gap is not an oversight, it is
the default direction: adding an export later is additive, and removing one after publication
is not — and the package is published, so the asymmetry has teeth it did not have when D44
first argued it. Canonical serialization becomes public when J9.1 states what the GameEngine
actually needs to import, and `20-contract.md` §12 U7 is where that lands. This section fixes
the rule; it does not pick the functions.

**Isomorphism is a boundary property, and it is proven rather than asserted.** The core
reaches for no filesystem, no fetch, no window, no process, no wall clock, no randomness.
Environment arrives only through ports. That is what makes the core testable without a
network and importable by the GameEngine without tripping its determinism guard, and the same
guard runs against the core in CI — a constraint that is not enforced regresses on the first
convenient ambient call, and the guard therefore bans every non-relative specifier rather than
an enumerated list of runtime modules (D50).

It is also why the browser and the server migrations land as **one gate**. A core proven
against one environment first accretes that environment's assumptions, and the isomorphism
claim then becomes retroactive: something you assert about code that only ever ran in one
place. Two consumers landing together is the only version of that claim that is evidence.

Peer dependencies are optional in both directions: a Node consumer resolves no React, and a
browser consumer resolves no Node module. That is the whole reason the boundaries are drawn
where they are rather than by layer (`90-decisions.md` D2).

## 3. Control flow

Three paths, named by what triggers them.

### 3.1 A call site reads a payload

The runtime path, and the one every consumer sees.

1. **Resolve.** The id is looked up in the loader's normalized source map, or the request
   carries its own source. No source, or a malformed one, ends here with `json.unresolved`.
2. **Cache lookup.** Keyed by id, checked against the entry's declared source (§1.1), then
   against the policy: `manual` always hits until invalidated; `ttl` hits while the clock says the
   entry is inside its window, which is **half-open** — an entry exactly at `ttlMs` has expired,
   and an entry stored with no clock is never a hit; `mtime` hits while `(path, mtimeMs, size)` is
   unchanged. A hit returns immediately and skips to step 8. `20-contract.md` I40 states all
   three conditions.

   A request carrying `cache: false`, or its own ad-hoc `source`, **skips this step and step 3
   together** and goes straight to transport. Both are reads with no cache key, and a read with
   no cache key has nothing to look up, nothing to store, and nothing to join through (§5,
   `90-decisions.md` D61).
3. **Join or start.** A miss checks the in-flight map. A load already running for this key is
   **joined**, not duplicated (§5). Otherwise a new one starts and registers itself.
4. **Transport.** `http` goes through the fetch port under a per-attempt timeout, with retries
   for transport-class failures only (§4.3). `file` goes through the filesystem port. `inline`
   makes no attempt at all.
5. **Decode and parse.** Bytes are counted, decoded as UTF-8, and parsed. A body that is not
   JSON ends here with `json.parse`.
6. **Unwrap.** `'none'` — the default and the only behaviour when nothing is declared —
   returns the parsed body exactly as parsed. Nothing is ever inferred from payload shape.
7. **Domain-check, freeze, store, digest.** The post-unwrap value is checked against the
   canonical value domain on every load, whether or not a digest was asked for; a value outside
   it ends here with `json.schema` and writes nothing (`20-contract.md` I36). The value is then
   frozen and written to the cache, unless the generation guard says the key was invalidated
   while the load was in flight (§5), in which case the result is returned but not stored. A
   requested digest is computed from the canonical form and memoized onto the entry afterward,
   under the same guard (§5, I32).
8. **Validate.** Per call, against the shared value. A validator that fails or throws ends
   with `json.schema`.
9. **Assemble.** Meta is derived (§1.3), the result is assembled, and an event goes to the log
   port if one was supplied — exactly one, carrying the phase that last ran, which
   `20-contract.md` §4 and I38 own. `load` returns; it does not throw and does not reject.

The call site is identical whether the source is `at: build` or `at: runtime`. That is the
entire reason `at:` is a property of the source rather than an argument to the read: a payload
can move between them in review, without touching code (`20-contract.md` I9). No step above
branches on `at`, and §3.2 is what makes that possible.

### 3.2 A build resolves the declared build-time sources

1. **Read exactly one source map** — public or server, never both in one pass. A build reads
   its map through `/node`'s reader, reached from the composition root (§2), not through a
   parser of its own.
2. **Resolve every `at: build` entry**, concurrently, with digests requested, over a loader
   constructed on **that half of the map alone**. `at: runtime` entries are not touched
   (`20-contract.md` I8), and scoping the loader to the half it resolves is what keeps the
   construction-time port check honest at this boundary: a build demands exactly the ports the
   entries it resolves need, and never a port for an entry it is guaranteed never to reach
   (`90-decisions.md` D43).
3. **Nothing is written until everything resolves.** A failure in any entry fails the build
   and reports *every* failed id, not the first (`90-decisions.md` D17).
4. **Write one artifact per source, then the lockfile** — sorted by id, serialized through the
   canonical serializer, so two builds over unchanged bytes produce a byte-identical file
   and a real diff means real change. No field of the lockfile is derived from a clock; one
   that was would make every rebuild a diff and destroy the only property the file is committed
   for (`90-decisions.md` D47).
5. **Emit the derived runtime map.** Every `at: build` entry is rewritten to an inline entry
   carrying the resolved data, and the result is handed back for the consumer to persist and
   import. **This is the handoff**, and it is the reason §3.1 has no `at` branch
   (`90-decisions.md` D24, `20-contract.md` I33): a runtime loader constructed from this map
   resolves those ids with no port at all, because there is nothing left to transport. The
   rewritten entry keeps only what still governs an inline value — everything describing a
   transport that no longer happens is dropped.
6. **Run the public/server gate last**, after everything that could write into the public
   output directory. A gate that runs before the last writer proves nothing.

### 3.3 A composition root refuses to boot

A server reads its source map, constructs a loader, and calls preload in its startup with the
ids it cannot serve without. Every id resolves concurrently; the call rejects if any failed,
naming all of them. This is the only member of the loader that rejects, and it exists because a
process that starts and then 500s on first request is worse than one that refuses to start
(`90-decisions.md` D7).

The guarantee is scoped to the moment it was called (`90-decisions.md` D38). `preload` performs
a full load per id and writes the cache under each entry's declared policy; it does not pin
those entries against later expiry. A process that boots is one whose configuration and
upstreams were reachable at boot, and declaring a ttl is declaring that a later failure is
acceptable.

There is a fourth, minor path: **a watched file changes**, and the filesystem port's callback
invalidates that id's cache entry in process. It retires the external file watcher
`Docs-Template` runs today and ties invalidation to the cache that would otherwise go stale.
§1.5 owns when that watcher is registered and what ends it.

## 4. Failure modes

`load` never throws and never rejects. Every outcome is a result carrying a reason code from a
closed vocabulary, and control flow branches on the code, never on the message
(`90-decisions.md` D8). Everything the package *does* throw is one error type carrying an
enumerated code, so a composition root can branch on why boot failed without parsing a string
(`90-decisions.md` D26).

This replaces three conventions coexisting in one codebase today: throw, write to a store and
continue, and warn-then-substitute-defaults. A consumer currently cannot distinguish "the
upstream site is unreachable" from "the payload changed shape", because both arrive as an
error with a formatted string — and those two want opposite handling, the first quiet, the
second loud.

### 4.1 By boundary

| Boundary | What fails | Detected by | System does | Caller sees | State left behind |
|---|---|---|---|---|---|
| Fetch port | Connection refused, DNS, network abort | The port rejects | Retries if attempts remain | `json.transport` | None. Cache untouched |
| Fetch port | Non-2xx response | Status inspection | Retries only 408, 429, 5xx | `json.status` | None |
| Fetch port | No response inside the per-attempt budget | Timeout (§7 Q1) | Aborts the attempt, retries if attempts remain | `json.timeout` | An aborted request; no partial value |
| Fetch port | Truncated 2xx body | Parse failure | No retry | `json.parse` | None |
| Filesystem port | Path does not exist | Port error | No retry — it will not appear | `json.notFound` | None |
| Filesystem port | Permission or IO error | Port error | No retry | `json.transport` | None |
| Filesystem port | `stat` fails under an `mtime` policy | Port error | Treats it as a miss and reads; the read's own outcome is authoritative | Whatever the read produced | Entry left as it was |
| Size bound | Body exceeds a declared `maxBytes` | A declared `Content-Length` where one is present, and the decoded length always | No retry — asking again returns the same oversized body | `json.tooLarge`. Where a declared `Content-Length` is what refused it, `meta.bytes` carries that declared length, since no body was received to measure | None. Nothing is written |
| Parse | Body is not JSON, or is empty | Parse throws | No retry | `json.parse` | None |
| Unwrap | Declared envelope absent, or a caller-supplied unwrap throws | Shape check, or a catch | No retry | `json.schema` | None |
| Validate | Validator returns not-ok, or throws | Return value, or a catch | No retry | `json.schema`, `validated` false | Cache entry stands — the value is fine, this caller's schema is not |
| Resolve | Id absent from the map, or a malformed request | Lookup | Nothing to attempt | `json.unresolved` | None |
| Configuration read | The file is absent, is a directory, or the read failed | The read rejects | Throws. Nothing was parsed, so no id can be named | `config.unreadable`, naming the path | No map, and therefore no loader |
| Configuration read | The bytes arrived but their content is wrong — unparseable YAML, no `sources` record, or any per-entry fault the core already names | The core's own entry check, applied by the reader (§2) | Throws | `config.invalidEntry`, naming the id and field, or the file where the fault sits above the entries | No map, and therefore no loader |
| Construction | A supplied entry needs a port that was not passed: `fetch` for an http entry, `fs` for a file entry, `clock` for a `ttl` policy, `rng` for retry jitter, `schedule` for a timeout or a non-zero delay. One clause is map-independent — a supplied `fetch` requires a `schedule` alongside it, because an ad-hoc request can name an http URL the map never mentions | Construction-time check, scoped to the entries in the map supplied | Throws. Never a silent downgrade | `config.missingPort`, naming the entry and the port | No loader exists |
| Render | `useJson` or `JsonBoundary` rendered with no `JsonProvider` above it | Context lookup | Throws. There is no default loader to fall back to | `config.missingProvider` | None. No load was attempted, so I2 is untouched |
| Build | Any `at: build` source fails | Aggregate of §3.2 | Fails the build, writes nothing | Every failed id, named | Previous build output, untouched |
| Build gate | A server-file entry reached the public output | Scan of the built output | Fails the build | The offending id and file | Build output present but rejected |

The two configuration-read rows split on **whether the bytes arrived** (`90-decisions.md` D63).
That is the distinction a caller acts on: one means create the file or fix the path, the other
means fix a field. Folding them into one code would put that difference back into the message
string, which is what the enumerated codes exist to retire.

**A failed load neither populates nor evicts the cache.** A stale entry is not a hit, but it is
not deleted either — nothing is gained by destroying a value that a later policy change or a
follow-up read might still want, and eviction on failure is how a cache turns one outage into
a cold start.

### 4.2 What the user sees

The reason code is the interface; the surface is per module.

- **Browser.** The boundary component renders from the reason, never from the message string.
  "Unreachable" and "wrong shape" are different renderings because they are different problems.
- **Server.** The router maps reason to status and **never forwards the upstream status**
  (`90-decisions.md` D20): unresolved and not-found to 404; timeout and transport to 504;
  status, parse, schema, and too-large to 502 (D33). Forwarding an upstream 404 as the API's
  own 404 tells a client "your route is wrong" when the truth is "our upstream is wrong". Its
  own failure envelope carries the same field the core's unwrap reads, so a data-json client
  reading a data-json server gets the real message rather than a generic substitute (D45).
- **Build.** Failures are named by id at the point of resolution, before anything is written.

### 4.3 Retry and partial failure

Retries cover **transport-class failures only**: transport, timeout, and the three retryable
statuses. A 404 will not become a 200 by asking again, and a malformed body will not become
well-formed — retrying those spends the timeout budget to arrive at the same answer
(`90-decisions.md` D16). `timeoutMs` is **per attempt**, not per call; a three-attempt policy
with a ten-second timeout can take thirty seconds, and that is the declared meaning rather than
an accident.

Partial failure is per id and never aggregated away:

- **Many ids at once** returns a result per id and never rejects. One unreachable source does
  not deny the caller the other four.
- **Preload and prefetch** report every failure. Failing fast on the first hides the other
  three misconfigured sources, and boot-time and build-time diagnostics are exactly where a
  complete list is worth the extra wait.

When a fallback is declared, data is populated on failure as well as success. The distinction
between "worked" and "degraded" lives in the ok flag and the reason, not in whether the caller
got something usable — and a fallback is the **only** degraded-data path. Serving a stale
cached value on failure was rejected: it makes the cached flag and the ok flag jointly
ambiguous, and it reintroduces the silent-substitution behaviour the result type exists to
kill (`90-decisions.md` D18).

## 5. Concurrency and ordering

**Nothing runs in parallel.** The runtime is single-threaded and everything here is one event
loop. What is real is **interleaving at await points**, and that is enough to lose a write, so
"nothing is concurrent" would be the wrong answer.

Three things can interleave, and each has a named enforcer.

**Concurrent reads of one id.** Three components mounting at once and each reading the same id
would issue three transports on a cold cache — no cache policy helps, because the cache is
still empty when all three miss. An **in-flight map keyed by cache key** coalesces them: the
first starts the load, the rest join its promise. All three get the same frozen value, which is
safe precisely because it is frozen (`90-decisions.md` D15, D21). Validation still runs per
caller, so joining does not force callers to share a schema (§1.4).

**What participates in that join is exactly what participates in the cache** (`90-decisions.md`
D61). The in-flight map is keyed by cache key, so a read that has no cache key has nothing to
join through: an ad-hoc `JsonRequest.source` (§1.1) and a `cache: false` request both go
straight to transport, neither joining a load in flight nor being joined by one. Two concurrent
opt-out reads of one id therefore issue two transports, and that is the declared meaning rather
than a leak.

The reason is that **the in-flight map is a cache with a lifetime of one load.** A caller that
joins receives a value fetched in response to somebody else's earlier call, which is precisely
what a caller opting out of the cache is asking not to receive; "fresh, unless another call
beat you to it by a few milliseconds" is not a property anyone can reason about. Making
participation follow cache-eligibility also keeps one caller's flag out of another caller's
behaviour: were an opt-out read allowed to initiate a load that a normal read joined, the
question of whether that entry gets stored would depend on which of the two arrived first. A
call site's behaviour must not turn on an unrelated concurrent call, for the same reason §1.4
does not let it turn on a cache policy it cannot see.

This narrows `20-contract.md` I17, which as originally written admitted no exception: the
guarantee is over concurrent **cache-eligible** misses, a term §3 there now defines, and I40
carries the other half — a read outside it performs no lookup at all.

**Invalidation during a load.** Each cache key carries a generation counter, incremented by
`invalidate`. A load stamps the generation it started under and compares before storing; a
mismatch means the result is returned to its callers but not written. Without this, invalidate
has a race in which the value you asked to be forgotten reappears moments later, from a request
that was already in the air.

**A watch callback firing mid-load.** The same generation guard covers it, because a watch
callback invalidates through the same path.

Ordering that must hold:

- Cache lookup happens **before** transport; the in-flight join happens **after** the lookup
  misses. Reversing either reintroduces the duplicate-fetch case.
- An `mtime` stamp is captured **before** the read, never after. Before is the safe direction:
  the stamp may be older than the bytes, which costs one redundant re-read, where after may be
  newer than the bytes, which serves stale content under a fresh stamp (`90-decisions.md` D36).
- A cache hit can return a digest without re-transporting. It is **memoized onto the entry**
  rather than computed ahead of the store: a value is frozen and written with `digest: null`,
  and the first request that asks for one computes it from the canonical form and writes it
  back under the same generation guard, so an invalidate that landed meanwhile is not clobbered
  (`20-contract.md` I32, I17). Computing it eagerly would pay for a digest on every load for
  the callers that never ask.
- The build gate runs **after** the last write into the public output (§3.2).
- Lockfile entries are emitted in sorted-id order, so resolution order — which is
  nondeterministic under concurrency — cannot change the bytes.

What is not shared: **the cache is per loader, per process.** Two loaders in one process share
nothing — enforced by namespacing each loader's keys with its own instance identity, so even an
injected `CacheStore` reaching two loaders cannot cross-serve (`90-decisions.md` D35). Two
server workers share nothing. There is no cross-process cache and no distributed invalidation,
which is a non-goal (`00-brief.md` §5.4) and the reason invalidation can be a counter rather
than a protocol.

Concurrency in eager resolution is **unbounded**, because a source map is hand-written
configuration and is small by construction. That is an assumption, not a guarantee, and it is
recorded in the open register rather than defended here.

## 6. Alternatives considered

Eight choices where a different option was genuinely viable. The earlier five — package shape,
`at:` with no default, the two-file config split, result-not-throw, and the deliberate
serializer duplication — are settled in `90-decisions.md` D2, D3, D6, D8, and D9 and are not
reopened.

**Where the cache line sits in the pipeline.** Chosen: post-unwrap, pre-validation, with
validation per call. Rejected: caching the *validated* value, which is what a naive
read-through cache does — it is wrong the moment two call sites read one id with different
schemas, and it silently gives the second caller the first caller's transform. Also rejected:
caching the *raw text* and re-parsing per call, which is correct but pays parse cost on every
hit for a payload that is by definition unchanged.

**What the digest covers.** Chosen: the canonical form of the post-unwrap value. Rejected: the
raw bytes as received, which is cheaper and needs no canonical serializer, but makes a
whitespace change or a key reorder look like a content change and makes the digest change when
a payload moves from a bundled import to an enveloped endpoint — the exact migration this
package is for. Also rejected: the post-validation value, which ties a payload's identity to
the consumer's schema, so two consumers of one payload compute two different digests and the
lockfile stops meaning anything.

**How a build-time payload reaches a runtime call site.** Chosen: the build emits a derived
source map in which every `at: build` entry has become an inline entry carrying the resolved
data (§3.2 step 5). Rejected: reading the prefetched artifact through the filesystem port at
runtime, which fails outright in a browser — half of a consumer set the brief calls co-equal —
and would make "an `at: build` source is never fetched at runtime" a wording argument rather
than a property. Also rejected: a third `artifacts` argument to the loader factory, which needs
no rewritten map and no codegen, but leaves two places that must agree on ids and adds an
argument only build-time consumers ever pass. The chosen option is also what keeps §3.1 free of
any branch on `at`, which is the property the whole `at:` axis rests on.

**Whether concurrent reads of one id are coalesced.** Chosen: single-flight, with a generation
guard so invalidation wins. Rejected: no coalescing, which is meaningfully simpler and needs no
in-flight map or generation counter — but the duplicated-fetch behaviour is one of the defects
in the code being replaced, and a cache does not fix it, because the race is precisely the
window where the cache is empty. Also rejected: coalescing on the full request rather than the
cache key, which is more conservative and coalesces almost nothing, since two call sites rarely
construct byte-identical requests.

**What happens to a cached value when a refresh fails.** Chosen: nothing — the failure is
reported, the entry stands, and a declared fallback is the only path to degraded data.
Rejected: stale-while-error, which is the resilient-looking option and is what a CDN would do,
but it makes the cached flag and the ok flag jointly ambiguous and hands the caller old data
under a success they did not ask for. That is warn-then-substitute-defaults again, which is one
of the three conventions this package exists to retire.

**How eager resolution reports failure.** Chosen: resolve everything, then report every
failure. Rejected: fail fast on the first, which is the obvious implementation and returns
sooner — but a boot or a build that stops at the first of four misconfigured sources costs four
round trips of a human's time to discover what one round trip could have said.

**Whether a cache opt-out participates in single-flight.** Chosen: it does not — participation
in the in-flight join is exactly participation in the cache, so an opt-out read and an ad-hoc
source are governed by one rule rather than two exceptions. Rejected: letting an opt-out read
join and be joined while never reading or writing an entry, which is the reading that keeps the
single-transport guarantee unqualified and saves a round trip — but it forces a second choice
the first reading never has to make, namely whether an entry is committed when the caller that
*initiated* the load had opted out, and every answer to that makes one call site's caching
depend on an unrelated concurrent call's flag. Also rejected: deleting `cache: false` outright,
which removes the contradiction rather than deciding it and is the cheapest edit by some way —
but the package is published, so the removal is now a breaking change rather than the free one
the same asymmetry argument assumed in D44, and `refetch` is the consumer that will want it.

**Which module turns a YAML source map into a `SourceMap`.** Chosen: `/node`, applying the
core's own shape check rather than a second copy of it. Rejected: no reader at all, with each
consumer parsing YAML and handing the result to `createJsonLoader`, which already validates it
— genuinely cheaper, adds no public surface to a published package, and stays inside the
brief's §6 list for `/node`; but it leaves three consumers each casting `unknown` to
`SourceMap` by hand, it defers every configuration error in an `at: runtime` entry past a build
that never constructs a loader over those entries (I8), and it requires *removing* a behaviour
`20-contract.md` §10.1 already names. Also rejected: `/build` owning the reader, which puts it
where the build needs it with no wiring — but duplicates the YAML parser into a second leaf and
leaves the server consumer, which reads `sources.server.yml` and must not depend on `/build`,
with no reader at all.

## 7. Open questions

Four were raised. **Three are resolved**, and their rejected alternatives live in
`90-decisions.md` rather than being restated here:

- **Q1 — how the core waits, given it may not reach for a timer.** Answered by a cancellable
  scheduling port whose absence is a construction-time error (`90-decisions.md` D23, D48;
  `20-contract.md` §4, I6).
- **Q2 — a missing port for a declared source kind: construction error or read-time failure?**
  Answered as a construction-time error, scoped to the entries in the map supplied
  (`90-decisions.md` D30). The forgiving reading Q2 rejected turned out to have one narrow case
  after all, and it is not the one Q2 described: an **ad-hoc** source the map never declares.
  D48 handles it by widening the requirement with one map-independent clause rather than moving
  the check to read time.
- **Q3 — which YAML parser, and is a runtime dependency acceptable at all?** Answered as a
  normal dependency of `/node` only, leaving the core at zero (`90-decisions.md` D41;
  `20-contract.md` §12 U3). The parser was constrained by what the two existing converters
  already emit, not chosen on general merit — D41 records the measurements.

**Q4 — STILL OPEN, and no longer blocking. Does the GameEngine's determinism guard ban ambient
timers?** It bans the wall clock and randomness; whether it also bans scheduling is not stated
in anything available here, and that repository is not present in this tree.

It was asked to decide whether the ambient-timer option was available as a fallback to Q1. Q1
took the port, so there is no fallback to keep available and nothing waits on this answer. It is
kept because J9 puts this core inside that guard, and the question will be asked again there —
by which point the answer is checkable rather than speculative.
