# Design — SubZeroDev.Data.Json

Architecture, data model, and failure semantics. Exact types live in `20-contract.md`;
this file explains why they have the shape they do and settles the things the types alone
do not say. Decisions and their reversal costs are in `90-decisions.md`.

Where this document decides something the contract does not yet state, the decision is
logged and named here as needing to land in `20-contract.md`. Nothing here contradicts the
contract; the one capability the contract is missing is §7 Q1.

## 1. Data model

The system has ten entities. Two are persisted, one is persisted configuration, and the
rest exist only for the duration of a call or the life of a loader.

### 1.1 Identity

**A source id is the only identity in the system.** It keys the source map, the cache, the
lockfile, the prefetched artifact, and `invalidate`. There is no second handle — no opaque
token, no per-request id, no cache key the caller can see or construct.

Ids are unique within a source map. An id appearing in *both* the public and the server map
is a configuration error the build gate rejects: an id whose meaning depends on which file
you read is exactly the ambiguity the two-file split exists to prevent (`90-decisions.md`
D6, D12).

A cache entry records the location it was resolved from. A lookup whose request resolves to
a different location is a **miss**, not a hit — otherwise a call passing an explicit source
under an id already in the map would serve that id's cached bytes to everyone.

### 1.2 Entities

| Entity | Lives | Owned by | Identity | Lifecycle |
|---|---|---|---|---|
| **Source map** | Persisted, YAML, two files | The consuming repository | The file it came from | Read once, at build or at loader construction. Never reloaded — a changed file means a new loader |
| **Source entry** | Persisted, a row in a map | The consuming repository | Its id | Created and edited by hand, in review |
| **Normalized source** | In-memory | The loader | Its entry's id | Derived once at construction from the entry or a bare string; never re-derived per read |
| **Request** | In-memory, per call | The caller | None — a value | Constructed by the caller, or synthesized from a map entry by `loadById` |
| **Cache entry** | In-memory, per loader | The loader | Its source id | Written on success, replaced by a later success, dropped by `invalidate`. Never persisted, never shared between loaders or processes |
| **Meta** | In-memory, per result | The loader | None | Wholly derived (§1.3) |
| **Result** | In-memory, per call | The caller once returned | None | Discarded by the caller |
| **Event** | In-memory, transient | The log port | None | Fire-and-forget; nothing may depend on delivery |
| **Prefetched artifact** | Persisted, one JSON file per `at: build` source | The build | Its source id | Rewritten by every build; regenerable |
| **Lockfile** | Persisted, one per build target | The build | The build | Rewritten by every build; committed so builds are comparable |

The source map is the only persisted thing a human writes. The other two persisted things
are build output and are regenerable from it.

### 1.3 Derived fields

Every field of `JsonMeta` is derived. Naming the derivation is the point, because two of
them are the design decisions most expensive to change later.

| Field | Derived from |
|---|---|
| `id` | The request |
| `provider`, `location` | The normalized source. `location` is empty when nothing resolved |
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
does not currently cover the cache-hit case and should absorb this.

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
leaf's in-degree from siblings is zero, both checkable mechanically.

| Module | Owns | Depends on | Exposes |
|---|---|---|---|
| **core** | The pipeline, the source union, the result and reason vocabulary, the cache, canonical serialization, the digest, the port interfaces | Nothing. No module, no global | `load`, the loader factory, source normalization, and the types everything else is written against |
| **node** | The Node filesystem port, the YAML→JSON conversion the CLI wraps, the GET-only HTTP mount, the response envelope | core, the Node runtime, a YAML parser (§7 Q3) | A filesystem port, a composed port set, a router, the envelope and its producer |
| **react** | The hook and boundary bindings, mount and unmount lifecycle | core, React as an optional peer | `useJson`, `JsonBoundary` |
| **zod** | The adapter from a zod schema to the core's validator seam | core, zod as an optional peer | A validator factory |
| **build** | Build-time resolution, artifact and lockfile emission, the public/server gate | core, the Node runtime | Prefetch, and the bundle assertion |

**`/build` does not depend on `/node`.** It reads through whatever ports it is handed and
writes with the Node runtime directly. That keeps the filesystem port read-only — the package
is read-only, and a write member on the port would be the seam through which that stops being
true (`90-decisions.md` D19). A consumer that wants Node's filesystem port composes it from
`/node` and passes it in; the two modules meet in the consumer, not in the graph.

**Isomorphism is a boundary property, and it is proven rather than asserted.** The core
reaches for no filesystem, no fetch, no window, no process, no wall clock, no randomness.
Environment arrives only through ports. That is what makes the core testable without a
network and importable by the GameEngine without tripping its determinism guard, and the same
guard runs against the core in CI — a constraint that is not enforced regresses on the first
convenient ambient call.

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
2. **Cache lookup.** Keyed by id, checked against the entry's recorded location, then against
   the policy: `manual` always hits until invalidated; `ttl` hits while the clock says the
   entry is inside its window; `mtime` hits while `(path, mtimeMs, size)` is unchanged. A hit
   returns immediately and skips to step 8.
3. **Join or start.** A miss checks the in-flight map. A load already running for this key is
   **joined**, not duplicated (§5). Otherwise a new one starts and registers itself.
4. **Transport.** `http` goes through the fetch port under a per-attempt timeout, with retries
   for transport-class failures only (§4.3). `file` goes through the filesystem port. `inline`
   makes no attempt at all.
5. **Decode and parse.** Bytes are counted, decoded as UTF-8, and parsed. A body that is not
   JSON ends here with `json.parse`.
6. **Unwrap.** `'none'` — the default and the only behaviour when nothing is declared —
   returns the parsed body exactly as parsed. Nothing is ever inferred from payload shape.
7. **Digest, freeze, store.** The digest is computed when requested. The value is frozen and
   written to the cache, unless the generation guard says the key was invalidated while the
   load was in flight (§5), in which case the result is returned but not stored.
8. **Validate.** Per call, against the shared value. A validator that fails or throws ends
   with `json.schema`.
9. **Assemble.** Meta is derived (§1.3), the result is assembled, and an event goes to the log
   port if one was supplied. `load` returns; it does not throw and does not reject.

The call site is identical whether the source is `at: build` or `at: runtime`. That is the
entire reason `at:` is a property of the source rather than an argument to the read: a payload
can move between them in review, without touching code (`20-contract.md` I9).

### 3.2 A build resolves the declared build-time sources

1. Read exactly one source map — public or server, never both in one pass.
2. Resolve every `at: build` entry, concurrently, with digests requested. `at: runtime`
   entries are not touched (`20-contract.md` I8).
3. **Nothing is written until everything resolves.** A failure in any entry fails the build
   and reports *every* failed id, not the first (`90-decisions.md` D17).
4. Write one artifact per source, then the lockfile — sorted by id, serialized through the
   canonical serializer, so two builds over unchanged bytes produce a byte-identical file
   and a real diff means real change.
5. **Run the public/server gate last**, after everything that could write into the public
   output directory. A gate that runs before the last writer proves nothing.

### 3.3 A composition root refuses to boot

A server calls preload in its startup with the ids it cannot serve without. Every id resolves
concurrently; the call rejects if any failed, naming all of them. This is the only member of
the loader that rejects, and it exists because a process that starts and then 500s on first
request is worse than one that refuses to start (`90-decisions.md` D7).

There is a fourth, minor path: **a watched file changes**, and the filesystem port's callback
invalidates that id's cache entry in process. It retires the external file watcher
`Docs-Template` runs today and ties invalidation to the cache that would otherwise go stale.

## 4. Failure modes

`load` never throws and never rejects. Every outcome is a result carrying a reason code from a
closed vocabulary, and control flow branches on the code, never on the message
(`90-decisions.md` D8).

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
| Parse | Body is not JSON, or is empty | Parse throws | No retry | `json.parse` | None |
| Unwrap | Declared envelope absent, or a caller-supplied unwrap throws | Shape check, or a catch | No retry | `json.schema` | None |
| Validate | Validator returns not-ok, or throws | Return value, or a catch | No retry | `json.schema`, `validated` false | Cache entry stands — the value is fine, this caller's schema is not |
| Resolve | Id absent from the map, or a malformed request | Lookup | Nothing to attempt | `json.unresolved` | None |
| Construction | A `ttl` policy with no clock, `jitter` with no rng | Construction-time check | Throws. Never a silent downgrade | An exception at loader construction | No loader exists |
| Build | Any `at: build` source fails | Aggregate of §3.2 | Fails the build, writes nothing | Every failed id, named | Previous build output, untouched |
| Build gate | A server-file entry reached the public output | Scan of the built output | Fails the build | The offending id and file | Build output present but rejected |

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
  status, parse, and schema to 502. Forwarding an upstream 404 as the API's own 404 tells a
  client "your route is wrong" when the truth is "our upstream is wrong".
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
- The digest is computed **before** the value is frozen and stored, so a cache hit can return a
  digest without recomputing it.
- The build gate runs **after** the last write into the public output (§3.2).
- Lockfile entries are emitted in sorted-id order, so resolution order — which is
  nondeterministic under concurrency — cannot change the bytes.

What is not shared: **the cache is per loader, per process.** Two loaders in one process share
nothing. Two server workers share nothing. There is no cross-process cache and no distributed
invalidation, which is a non-goal (`00-brief.md` §5.4) and the reason invalidation can be a
counter rather than a protocol.

Concurrency in eager resolution is **unbounded**, because a source map is hand-written
configuration and is small by construction. That is an assumption, not a guarantee, and it is
recorded in the open register rather than defended here.

## 6. Alternatives considered

Five choices where a different option was genuinely viable. The earlier five — package shape,
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

## 7. Open questions

Four, in descending order of cost. The first is a contract gap and blocks part of J1.

**Q1 — The core cannot wait, and two declared features require waiting.** Time was made a port
for reading (`90-decisions.md` D4) but not for *scheduling*. Both `timeoutMs` and a retry's
`delayMs` need to schedule work in the future, and the declared port set has no member that
can. Three options: add a scheduling port and make its absence a construction-time error
wherever a timeout or a non-zero retry delay is declared, matching the existing treatment of a
missing clock; use an ambient timer in the core, which is available in both environments but
makes retry and timeout untestable without real elapsed time and puts an ambient call in a core
whose whole claim is that it has none; or drop `delayMs` and per-attempt timeouts from v1.
**Recommendation: add the port.** It is the smallest change that keeps the core's claim true,
and it is the same shape as the decision already taken for the clock. This needs a
`20-contract.md` amendment before J1 can implement retry or timeout.

**Q2 — A missing port for a declared source kind: construction error or read-time failure?**
An http source with no fetch port, or a file source with no filesystem port, is a loader that
can never satisfy something its own map declares. Making it a construction-time error matches
the existing treatment of a ttl policy without a clock; making it a read-time transport failure
is more forgiving of a map that declares more than a given environment uses — which is a real
case, since one map may be read by both a build and a runtime. **Recommendation:
construction-time error, checked only against the sources that environment will actually
resolve.** Either way `20-contract.md` I6 is enumerated and would need amending.

**Q3 — Which YAML parser, and is a runtime dependency acceptable at all?** The Node module's
conversion needs one, and the package currently declares zero dependencies outside optional
peers. Options: a normal dependency of `/node` only, leaving the core at zero; an optional peer
the consumer supplies, keeping the dependency count at zero at the cost of setup in three
consumer repositories; or a parser port, which is consistent with everything else here but is
ceremony for a build-time convenience. **Recommendation: a normal dependency of `/node` only.**
The core's zero-dependency claim is the one that matters, and it is untouched. This needs a
decision-log entry naming the parser and the alternatives before J2.

**Q4 — Does the GameEngine's determinism guard ban ambient timers?** It bans the wall clock and
randomness; whether it also bans scheduling is not stated in anything available here, and that
repository is not present in this tree. It does not change the Q1 recommendation, which stands
on testability alone, but it determines whether the ambient-timer option is available as a
fallback at all.
