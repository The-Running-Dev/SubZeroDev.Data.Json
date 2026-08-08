# Decisions — SubZeroDev.Data.Json

Decision history, deferred items, and judgement calls to revisit. Each entry records what
was decided, what it cost to reject the alternative, and what reversing it would cost.

Settled 2026-08-06, in the spike that produced `00-brief.md` through `30-slices.md`.

---

## D1 — Name: `SubZeroDev.Data.Json`

**Decided.** Repository `SubZeroDev.Data.Json`, published as `@subzerodev/data-json`.

Two alternatives were on the table. `SubZeroDev.Middleware.Json` was the original proposal;
it misdescribes a package whose core is a loader and whose Express middleware is one export
out of five. `SubZeroDev.Json` was the counter-proposal; it names the transport rather than
the namespace.

`Data.Json` names the namespace and leaves room for `SubZeroDev.Data.Yaml` or `.Sql`
siblings without renaming anything.

**Known cost, accepted.** `The-Running-Dev/Data` already exists and becomes a consumer at
J8. "Data" will mean both the content publisher and the data-access namespace. Different
orgs and different naming eras make this survivable; it will occasionally need
disambiguating out loud.

**Reversing:** cheap before publication, expensive after — a published package name is a
one-way door in practice.

---

## D2 — One package with subpath exports

**Decided.** A single package exporting `.`, `/node`, `/react`, `/zod`, `/build`. React,
zod, and zustand are optional peer dependencies.

Rejected: a workspace of four packages. It buys an independent dependency and version story
at the cost of four release processes, four changelogs, and cross-package version skew —
solving a problem that optional peer dependencies and tree-shaking already solve. A Node
consumer importing `.` and `/node` resolves no React.

Also rejected: keeping the code inside `Docs-Template`. Cheapest by a wide margin, but
`Portfolio/api`, `Data`, and the GameEngine cannot reach it, which is the entire ask.

**Reversing:** moderate. Splitting later is mechanical; the exports map already draws the
seams the packages would follow.

---

## D3 — `at:` declared per source, no default

**Decided.** Every source declares `at: build` or `at: runtime`. A missing value is a
configuration error.

Rejected: build-time as the default, which would have silently changed the behaviour of
every existing HTTP source during migration. Also rejected: runtime as the default, which
preserves the current state — remote content absent from the static HTML, a loading flash,
and availability coupled to the Data Pages site — by inertia rather than by decision.

The cost is real: J6.6 requires a per-source migration decision rather than a bulk move.
That cost is the point. It is paid once, in review, by someone who knows which payloads
need to be live.

**Reversing:** cheap. Adding a default later is additive.

---

## D4 — GameEngine constraints in v1

**Decided.** The core is designed clock-free and guard-clean now; the engine's *adoption*
is deferred to J9 and gated on content packs.

This is the decision that shaped the core. Because the engine's eslint guard bans
`Date.now`, `Math.random`, and the non-bit-stable `Math.*` in `src/`, time and randomness
became injected ports rather than ambient calls. Two consequences follow — TTL caching
requires a `clock` port, retry jitter requires an `rng` port — and both are
construction-time errors rather than silent downgrades (I6).

Rejected: designing for the browser and server only, deferring determinism until the engine
actually needed it. Retrofitting ambient `Date.now()` calls out of a shipped core is far
more expensive than never making them, and the resulting core is better for every consumer,
not only the engine.

**Reversing:** not worth reversing. The constraint costs little and improves testability
across the board.

---

## D5 — Read-only. The package does not write

**Decided.** Core and `/node` load, validate, and cache. No create, update, delete, atomic
write, or locking.

Rejected: reads plus atomic writes, and the fuller document-store option. Writing is a
different problem from loading, and absorbing it would have roughly doubled v1.

**Known-and-retained, and the reason this entry is long.** The spike found real defects in
`Portfolio/api`'s `JsonFileRepository` that this decision leaves unowned:

- `findAll` re-reads the file on every call, and `findById`, `count`, `create`, `update`,
  and `delete` all route through it. A single POST is a full read plus a full write.
- `create`/`update`/`delete` are read-modify-write with no lock. Two concurrent writes and
  one is silently lost.
- `writeJsonFile` is a bare `fs.writeFile`. A crash mid-write truncates the file rather
  than leaving the previous version intact.

These are legitimate defects and legitimately out of scope. **J7.3 requires them to be
written into `Portfolio` as known-and-retained issues** rather than evaporating because the
package declined to own them. A defect that leaves the record because of a scoping decision
is a defect nobody will find again.

**Reversing:** cheap and additive. `/node` can gain a write path without changing the core,
whose read-only shape is not load-bearing for anything else.

---

## D6 — Two configuration files, not one with a `scope:` field

**Decided.** `config/sources.public.yml` and `config/sources.server.yml`. Only the public
file is compiled into browser-importable data; only the server file may carry `headers`.

The risk is concrete. `Docs-Template`'s `config/globalConfig.yml` is compiled into
`data/globalConfig.json`, which is `import`ed into the client bundle. A credential added to
a source in that file ships to every visitor with nothing in the pipeline objecting.

Rejected: one map with `scope: browser | server | both`. Less duplication and one place to
look, but the safe outcome depends on a field being present and correct. With two files a
credential leaks only by being written into the wrong file — visible in review, greppable
in CI (I7).

Also rejected: forbidding headers in configuration entirely and resolving everything from
environment variables. The strongest guarantee, and the most plumbing per deployment. It
remains available as a later tightening.

**Reversing:** moderate. Merging to one file means re-auditing every entry.

---

## D7 — No `at: start`; `preload()` instead

**Decided.** `at:` has two values on both browser and server. A server that wants
fail-fast-at-boot calls `await loader.preload([...])` in its composition root.

Servers genuinely want boot-time failure — a process that starts and then 500s on first
request is worse than one that refuses to start. But that is a property of the composition
root, not of the payload, and `at: start` would have made `at:` mean different things in
different environments. `preload` gives the same guarantee with no environment-specific
config axis, and it is the only member of `JsonLoader` that rejects.

**Reversing:** cheap. Adding a third `at:` value is additive.

---

## D8 — `load()` returns a result and never throws

**Decided.** Every outcome is a `JsonResult` carrying a `ReasonCode` from a closed
vocabulary.

This replaces three conventions coexisting in one codebase today: throw
(`JsonFileRepository`), write to a store and continue (`DataLoader`), and `console.warn`
then silently substitute defaults (`DataProvider`). A consumer currently cannot distinguish
"the Data site is unreachable" from "the payload changed shape" — both arrive as an `Error`
with a formatted string — and those two want opposite handling.

**Reversing:** expensive. Every call site branches on the result shape.

---

## D9 — The canonical serializer is duplicated, deliberately, until J9

**Decided.** This package carries its own canonical serializer, verified byte-identical to
`src/engine/src/core/persistence/canonical.ts` on that module's existing test vectors
(I13). The engine deletes its copy and imports this one at J9.

Rejected: moving the engine's implementation into this package now. That makes a repository
with zero consumers the owner of code an established repository depends on, and reversing it
means unwinding a cross-repo dependency. Duplicating a small pure function with a
cross-check test is the cheap direction.

**This is a known-and-retained duplication, not an unnoticed one.** It has an owner (this
entry), an expiry (J9), and a test that fails if the copies diverge.

**Reversing:** J9 is the reversal, and it is planned.

---

## D10 — Slice prefix `J`

**Decided.** Work units are `J1`–`J9`, with stable per-criterion ids (`J1.1`).

The agent kit's generic prefix is `S`. `J` was already in use for these units before the
repository existed, and switching now would impose a translation cost immediately for no
benefit. Precedent: `SubZeroDev.GameEngine` retains `W` for the same reason.

**Reversing:** cheap now, expensive once issues and commits cite the ids.

---

## D11 — Installed the SubZeroDev.AgentKit (2026-08-07)

**Decided.** Ran `/install` from `SubZeroDev.AgentKit` @ `3624e16dacc10e46d2c29bf779bb1e8f3108208f`. The
repository had no `.git`; initialised it first (root commit `4e68976`, `README.md` and the
five existing `design/` docs) so the install had a real tree to reconcile against, per
`INSTALL.md` phase 0's stop-if-not-a-repo rule.

Three forks were resolved, all with the recommended option:

- **`AGENTS.md`/`CLAUDE.md` direction.** Neither existed. Installed the kit's default
  arrangement: `AGENTS.md` holds the contract plus a project-identity header (owner,
  companions, status) drawn from `README.md`; `CLAUDE.md` is a pointer. Rejected: inverting
  the direction — no reason to diverge from the kit's own default on a fresh repo.
- **`agent.md` seed.** Installed verbatim. Reviewed every lesson against this repo's actual
  stack (TypeScript, design-heavy, git, the PowerShell verify workflow this install also
  added) and found none demonstrably inapplicable — no lesson pruned. Rejected: pruning
  speculatively to shorten the file; the seed is short enough that a few plausibly-relevant
  lessons cost less than losing one that turns out to matter.
- **`Measure-Session.ps1` hooks.** `pwsh` is on `PATH`; `.claude/settings.json` was absent, so
  it was created containing only the `SessionEnd` and `UserPromptSubmit` hooks for this
  script, per `INSTALL.md`'s two-event carve-out. Rejected: installing the script without the
  hooks — cheaper to reverse, but loses the automatic session-cost reporting the tool exists
  for, with no reason here to withhold it.

`design/00-brief.md` through `30-slices.md` and this file's own prior entries (D1–D10,
`Deferred`, `Open register`) were already present with real content in the kit's exact
filenames — classified divergent, target wins wholesale per `INSTALL.md` phase 2. The kit's
`templates/design/` seeds were not written.

**Rejected overall alternative:** not installing at all, leaving the repo to accumulate
project-specific agent instructions from scratch. The kit's contract (model routing, session
boundaries, decision logging, tracking-work rules) is exactly what this repo's own
`design/90-decisions.md` and `30-slices.md` already assume a reader knows.

**Reversibility:** cheap. Every installed file is additive against a repo that had none of
them; removing the kit is deleting the files this entry lists.

---

Settled 2026-08-07, in the `/design` pass that restructured `10-design.md`. D12–D21 are the
pipeline and concurrency decisions the type signatures alone did not settle.

---

## D12 — The source id is the only identity (2026-08-07)

**Context.** The cache, the lockfile, the prefetched artifact, `invalidate`, and the source
map all need a handle. Any second handle would need a mapping, and a mapping can be wrong.

**Chosen.** The source id keys all five. A cache entry additionally records the location it
resolved from, and a lookup whose request resolves elsewhere is a miss. An id present in both
`sources.public.yml` and `sources.server.yml` is a configuration error the build gate rejects.

**Rejected.** A composite cache key over id plus request options — it makes `invalidate(id)`
unable to name what it is invalidating without enumerating the cache. Also rejected: allowing
an id in both maps, which makes an id's meaning depend on which file the reader opened, the
exact ambiguity D6 exists to prevent.

**Reversibility:** expensive. The id is in the lockfile, the artifact names, and the public
`invalidate` signature.

---

## D13 — The cache line is the post-unwrap, pre-validation value (2026-08-07)

**Context.** Two call sites may read one id with different validators, and a validator may
transform. Something has to say what the cache holds.

**Chosen.** The cache holds the value after unwrap and before validation. Validation runs per
call against the shared value, so `meta.validated` is a property of the call, not the entry.

**Rejected.** Caching the validated value — what a read-through cache does by default, and it
silently hands the second caller the first caller's transform. Also rejected: caching the raw
text and re-parsing per call, which is correct but pays parse cost on every hit for a payload
that by definition has not changed.

**Reversibility:** moderate. It is internal, but `20-contract.md` I12's wording is written
around it.

---

## D14 — `digest` covers the post-unwrap value (2026-08-07)

**Context.** The digest is the lockfile's content identity and the primitive the GameEngine
builds content-pack identity on (`00-brief.md` §5.7). Where it sits in the pipeline decides
what it means.

**Chosen.** SHA-256 over the canonical serialization of the value after unwrap and before
validation.

**Rejected.** The raw bytes as received — cheaper, and needs no canonical serializer, but a
key reorder or a whitespace change reads as a content change, and the digest changes when a
payload moves from a bundled import to an enveloped endpoint, which is the migration this
package exists to make cheap. Also rejected: the post-validation value, which ties a payload's
identity to a consumer's schema, so two consumers of one payload compute two digests and the
lockfile stops meaning anything.

**Reversibility:** expensive. Committed lockfiles carry the digests; changing the definition
invalidates every one of them.

---

## D15 — Concurrent reads of one id are coalesced, and `invalidate` wins (2026-08-07)

**Context.** Three components mounting together and reading one id issue three transports on a
cold cache. No cache policy helps — the race is exactly the window in which the cache is empty.
Separately, an `invalidate` during a load has a race where the forgotten value reappears.

**Chosen.** An in-flight map keyed by cache key: the first caller starts the load, the rest
join its promise. Each key carries a generation counter that `invalidate` increments; a load
compares the generation it started under before storing, and on a mismatch returns its result
without caching it.

**Rejected.** No coalescing — meaningfully simpler, no in-flight map and no counter, but
duplicated fetches are one of the defects being replaced and a cache demonstrably does not fix
them. Also rejected: coalescing on the full request rather than the cache key, which coalesces
almost nothing because two call sites rarely build identical requests. Also rejected: letting a
late load populate the cache after an invalidate, which is the version with the race.

**Reversibility:** cheap. Both are internal to the loader.

---

## D16 — Retry covers transport-class failures only; `timeoutMs` is per attempt (2026-08-07)

**Context.** `RetryPolicy` says how many attempts, not what is worth reattempting. Left
unstated, the natural implementation retries everything.

**Chosen.** Retries apply to `json.transport`, `json.timeout`, and statuses 408, 429, and 5xx.
Never to other 4xx, never to `json.parse`, `json.schema`, or `json.notFound`. `timeoutMs`
bounds each attempt, not the call.

**Rejected.** Retrying every failure — a 404 does not become a 200 and a malformed body does
not become well-formed, so it spends the whole budget to reach the same answer more slowly.
Also rejected: a total-call timeout, which is friendlier to a caller reasoning about worst-case
latency but makes the last attempt's budget depend on how long the earlier ones took, so a
retry policy silently degrades under load.

**Reversibility:** cheap for the classification, moderate for the timeout meaning — the latter
changes observed latency at every call site.

---

## D17 — Eager resolution reports every failure, not the first (2026-08-07)

**Context.** `preload` and `prefetch` both resolve a set of ids up front and both can fail on
several at once.

**Chosen.** Resolve all concurrently, then fail with every failed id named.

**Rejected.** Fail fast on the first — the obvious implementation and it returns sooner, but a
boot or a build that stops at the first of four misconfigured sources costs four round trips of
a human's attention to discover what one could have said. These are the two places where a
complete diagnosis is worth waiting for.

**Reversibility:** cheap.

---

## D18 — No stale-on-error; `fallback` is the only degraded-data path (2026-08-07)

**Context.** A refresh failure with a stale entry present is a fork: report the failure, or
serve the stale value.

**Chosen.** Report the failure. The stale entry is neither returned nor evicted — it is simply
not a hit. A declared `fallback` is the only way a caller receives data it did not just read.

**Rejected.** Stale-while-error, which is what a CDN would do and looks more resilient, but it
makes `meta.cached` and `ok` jointly ambiguous and hands the caller old data under a success
they did not ask for — warn-then-substitute-defaults again, one of the three conventions D8
exists to retire. Also rejected: evicting on failure, which turns one outage into a cold start
for no gain.

**Reversibility:** cheap and additive. Stale-on-error can arrive later as a declared policy,
which is the form it should have had anyway.

---

## D19 — `/build` writes with Node directly; the filesystem port stays read-only (2026-08-07)

**Context.** `prefetch` writes artifacts and a lockfile, and the declared `FileSystemPort` has
no write member. Something has to give.

**Chosen.** `/build` reads through whatever ports it is handed and writes with the Node runtime
directly. The filesystem port keeps `read`, `stat`, and `watch` only. `/build` does not depend
on `/node`; a consumer composes the two. Lockfile entries are emitted in sorted-id order through
the canonical serializer, so concurrent resolution order cannot change the bytes.

**Rejected.** Adding a write member to the port — it is the seam through which "the package is
read-only" (D5) stops being true, and it would be available to the core. Also rejected: an
unsorted lockfile, which would make a diff-driven review of build output meaningless the moment
resolution order changed.

**Reversibility:** cheap for the write path, expensive for lockfile ordering once lockfiles are
committed and compared.

---

## D20 — The router maps reason to status and never forwards the upstream status (2026-08-07)

**Context.** The GET-only mount serves payloads the loader fetched from somewhere else. An
upstream failure has two plausible renderings.

**Chosen.** `json.unresolved` and `json.notFound` to 404; `json.timeout` and `json.transport`
to 504; `json.status`, `json.parse`, and `json.schema` to 502.

**Rejected.** Forwarding the upstream status, which preserves more information and is a
one-liner — but an upstream 404 arriving as the API's own 404 tells a client "your route is
wrong" when the truth is "our upstream is wrong", and those two send a caller in opposite
directions.

**Reversibility:** moderate. It is observable behaviour that clients will encode.

---

## D21 — Returned values are frozen on every path, not only the cached one (2026-08-07)

**Context.** `20-contract.md` I12 requires cached values to be frozen. It does not say what
happens when caching is off.

**Chosen.** Every value the loader returns is frozen, including on a cache miss, with caching
disabled, and after a validator transform.

**Rejected.** Freezing only cached values — cheaper, and literally what I12 asks for, but it
makes mutability depend on a cache policy the call site cannot see. A source's configuration
changing must not change a call site's semantics; that is the same principle I9 states for
`at:`, and it is worth an O(n) walk on a payload that is already assumed to fit in memory.

**Reversibility:** expensive. Consumers will come to rely on it, and relaxing it is invisible
until something mutates shared state.

---

Settled 2026-08-07, in the `/contract` pass that amended `20-contract.md` against the
red-team register. D22–D33 adjudicate O6, O7, O8, O10–O14, and O18–O20, plus `10-design.md`
§7 Q1 and Q2. D34–D38 are the corrections those twelve carried with them, and close O9, O15
in part, and O21–O23.

---

## D22 — The core computes SHA-256 itself; there is no hash port (2026-08-07)

**Context.** O8, ruled a defect: the contract declared a `'sha256-<hex>'` digest and no legal
way to produce one. `node:crypto` is a module I1 forbids and is absent in a browser;
`globalThis.crypto.subtle` is ambient and async; a dependency contradicts the
zero-dependency core.

**Chosen.** A hand-written SHA-256 in the core, synchronous, roughly 90 lines, cross-checked
against published test vectors and against the engine's (I13).

**Rejected.** A sync `hash` port matching the clock and rng treatment — a browser consumer
still has to supply a JS implementation from somewhere, so the code moves rather than
vanishes, and the algorithm becomes per-consumer. That is the objection D14 makes against a
consumer-dependent digest: two consumers of one payload compute two identities and the
lockfile stops meaning anything. Also rejected: an async port so both environments can use
native subtle crypto — same per-consumer weakness, plus a new await point inside the
digest-freeze-store step. Also rejected: dropping the digest, which takes the lockfile, J3.3,
and the content-pack primitive with it.

**Reversibility:** cheap to add a port later; expensive to change what the digest covers
(D14).

---

## D23 — A cancellable scheduling port (2026-08-07)

**Context.** `10-design.md` §7 Q1: the core cannot schedule work in the future, so neither
`timeoutMs` nor `retry.delayMs` was implementable.

**Chosen.** `schedule?: (ms: number) => { promise: Promise<void>; cancel(): void }` on
`JsonPorts`. Its absence is a construction error wherever a timeout or a non-zero delay is
declared, matching I6's existing treatment of `clock` and `rng`.

**Rejected.** A bare `sleep(ms): Promise<void>` — simpler and equally testable, but with no
cancellation every attempt that finishes before its timeout leaves a live timer, visible as a
process that will not exit. Also rejected: an ambient `setTimeout` in the core, which puts an
ambient call in a core whose whole claim is that it has none and makes retry and timeout
untestable without real elapsed time. Also rejected: dropping `delayMs` and per-attempt
timeouts from v1, when timeout is one of the seven properties `00-brief.md` §2 counts as
missing from all five existing implementations.

**Reversibility:** cheap. The port is additive and its absence is already an error.

---

## D24 — `/build` emits a derived source map whose `at: build` entries are inline (2026-08-07)

**Context.** O6, ruled a defect: nothing read a prefetched `at: build` artifact at runtime.
The build wrote one artifact per source, no type named them, and `10-design.md` §3.1's nine
steps never branched on `at`.

**Chosen.** `prefetch` returns and writes a `SourceMap` in which every `at: build` entry has
become `{ inline: <resolved data> }`. The consumer constructs its runtime loader from that
map. §3.1 stays at nine steps with no `at` branch, I8 and I9 both hold literally, and O2's
question about whether `inline` earns its keep is answered — it is the handoff mechanism.

**Rejected.** Reading the artifact through the filesystem port at runtime, which fails
outright in a browser — half the co-equal consumer set — and makes I8's "never fetched at
runtime" a wording argument rather than a property. Also rejected: a third `artifacts`
argument to `createJsonLoader`, which needs no codegen but leaves two places that must agree
on ids and an argument only build-time consumers use.

**Reversibility:** moderate. The emitted map is build output and regenerable, but consumers
import it, so the import path is a public surface.

---

## D25 — Transport shape is configuration; the cache key is the source id (2026-08-07)

**Context.** O7, BLOCKING: the cache and in-flight keys were the id checked against the
recorded location, while `JsonRequest` varied `unwrap`, `headers`, `timeoutMs`, and `retry`
under one id. Reproduced as an I4 violation, a credential reaching a caller who supplied
none, and an I11 violation where a joiner reported attempts it did not make.

**Chosen.** `unwrap`, `headers`, `timeoutMs`, `retry`, `maxBytes`, and the cache policy leave
`JsonRequest` and live only on `SourceEntry`. A request keeps `fallback`, `validate`,
`digest`, and a `cache: false` opt-out. A request supplying its own `source` is never cached,
never written, and never joined. `at` leaves `JsonRequest` too — a request-level `at`
directly contradicts I9.

**Rejected.** Widening the key to include a digest of the transport-affecting request fields,
which keeps every field but contradicts D15's explicit rejection of coalescing on the full
request and reintroduces D12's rejected alternative: `invalidate(id)` can no longer name what
it evicts, and `CacheStore` declares no enumeration (O21). Also rejected: keeping the key and
documenting that per-request options are ignored on a hit — the credential case is real, and
"documented" is the warn-then-continue convention D8 exists to retire.

**Reversibility:** expensive. Every call site that wanted a per-call unwrap or header now
declares a source.

---

## D26 — One `JsonError` with an enumerated code (2026-08-07)

**Context.** O12: `preload` rejected with an untyped `Error` carrying reason codes inside a
formatted string, and `createJsonLoader`'s I6 throw and the build gate's throw were likewise
untyped. The one place a composition root must branch on why boot failed was the one place
the package returned what D8 was written to retire.

**Chosen.** `class JsonError extends Error` with `code: JsonErrorCode` — a closed union of
six — and `failures: readonly JsonFailure[]`. It is the only thing this package throws or
rejects with (I24). `load` still throws nothing at all (I2).

**Rejected.** Per-module error classes, which give more precise catch clauses but split
across subpaths — construction lives in the core, the gate in `/build` — for a caller who
mostly wants one type. Also rejected: keeping the untyped `Error` and specifying the message
format, which makes the message load-bearing, something §1 already forbids for results.

**Reversibility:** expensive. Consumers catch on `code`.

---

## D27 — `provider: 'none'` for a result where nothing resolved (2026-08-07)

**Context.** O20: `JsonMeta.provider` had no member for `json.unresolved` or a malformed
request, yet I2 requires a `JsonResult` for both. Whatever an implementer picked, a consumer
switching exhaustively was told something false, and `JsonEvent.meta` inherited it.

**Chosen.** `'http' | 'file' | 'inline' | 'none'`, with `location: ''` and `id: ''` when the
request carried no usable id. §1.3 already gave `location` this treatment; `provider` now
matches.

**Rejected.** A nullable `provider`, which carries the same information but invites
optional-chaining at every call site rather than an exhaustive switch. Also rejected:
reporting the provider the request would have used, which is unresolvable when the id is
absent from the map — `json.unresolved`'s main case — so it does not close the hole.

**Reversibility:** moderate. Adding a union member is a breaking change for exhaustive
switches, which is why it is done before 0.1.0.

---

## D28 — A `success: false` envelope is `json.schema` (2026-08-07)

**Context.** O18: `200 {"success":false,"error":"rate limited"}` under
`unwrap: 'subzerodev'` produced `ok: true` with `data: undefined`. `10-design.md` §4.1
defined only "declared envelope absent → `json.schema`", and this envelope is present, so an
implementer could equally reject it. The design admitted both.

**Chosen.** An envelope whose `success` is false carries no `data` member, so the declared
unwrap cannot produce a value — the same condition as an absent envelope, and §4.1's existing
row already routes that to `json.schema`. The envelope's own error text goes into `message`.

**Rejected.** A distinct `json.envelope` reason code, which is more precise — a boundary
could render an upstream refusal differently from a schema break, exactly the distinction
§4.2 says the vocabulary exists for — at the cost of a tenth code in every exhaustive switch
and in D20's router mapping. Reconsider it if a consumer actually needs the two rendered
apart. Also rejected: unwrapping `data` regardless of the flag, which is the reproduced
defect.

Separately settled: the `'subzerodev'` literal stays in the core, because it is declared in
configuration and the core reads configuration. `10-design.md` §2 assigns `/node` the
envelope's *producer*, which is `envelope()`, and J2.5's round-trip test keeps the two ends
agreeing.

**Reversibility:** cheap for the classification; adding a code later is additive.

---

## D29 — A digest is computed from the cached value on demand (2026-08-07)

**Context.** O11: a cache entry stored one digest, so a later `digest: true` request against
an entry cached without one returned `digest: null` under `ok: true`, and
`JsonLock.sources[].digest` is typed `string` with nothing to put in it.

**Chosen.** The cache holds the post-unwrap, pre-validation value (D13), which is exactly
what the digest covers (D14), so a hit computes the digest without any transport and
memoizes it into the entry. `10-design.md` §5's claim that a hit returns a digest without
recomputing becomes an optimisation for the common case rather than a guarantee that breaks.

**Rejected.** Always computing the digest and deleting the flag — one fewer axis and the
entry always has one, but an O(n) canonicalization plus a SHA-256 on every load of every
payload, including hot paths that never read it, when the D21 freeze is already one O(n)
walk. Also rejected: treating it as a cache miss and re-transporting, which spends a round
trip to derive something already computable from data in hand.

**Reversibility:** cheap. It is internal to the loader.

---

## D30 — Port presence is checked at construction, scoped to the map supplied (2026-08-07)

**Context.** `10-design.md` §7 Q2 and O19: I6 was checked against every entry in the source
map, so a build could not construct a loader over a map containing an `at: runtime` ttl
source without a clock for a source I8 guarantees it will never touch. A missing `fetch` or
`fs` port for a declared kind was specified nowhere.

**Chosen.** I6 extends to `fetch`, `fs`, and `schedule` alongside `clock` and `rng`, and
covers exactly the entries in the map handed to `createJsonLoader`. Because D24 has `/build`
rewrite `at: build` entries to inline, a runtime map contains only entries that loader can be
asked to resolve; `prefetch` checks only `at: build` entries. The scoping falls out of D24
rather than needing a mechanism.

**Rejected.** An explicit `{ resolves: 'build' | 'runtime' }` option, which is more explicit
but restates what `at` already says and silently checks the wrong half when set wrong. Also
rejected: a read-time `json.transport` failure for a missing `fetch` or `fs`, which is more
forgiving of a map declaring more than an environment uses but lets a loader that can never
satisfy its own map boot happily.

**Reversibility:** cheap in either direction.

---

## D31 — `dispose()` on the loader; watches register lazily (2026-08-07)

**Context.** O10: `FileSystemPort.watch` returned an unsubscribe no member of `JsonLoader`
could call. Three loaders registered three watchers and all three stayed active, Node will
not exit while one is, and `10-design.md` §2 assigns `/react` a mount and unmount lifecycle
with nothing to unwind. The design also never stated when a watch is registered.

**Chosen.** `dispose(): void` plus `[Symbol.dispose]`, unsubscribing every watcher and
dropping this loader's cache keys, idempotent. A watch is registered lazily, on the first
successful read of a file entry declaring an `mtime` policy.

**Rejected.** Registering at construction, which is more predictable — no first-read side
effect — but opens a watcher per file entry whether or not anything reads it, and forces a
not-yet-existing path to be handled at construction. Also rejected: dropping `watch` from the
port in v1, which gives up §3.3's fourth path, the retirement of the external file watcher
`Docs-Template` runs today.

**Reversibility:** cheap. Both are additive.

---

## D32 — No default cache policy; `cache` is required on http and file entries (2026-08-07)

**Context.** O13: the default was `{ kind: 'manual' }`, which always hits until invalidated,
so a source migrated without a `cache:` line was read once per process lifetime.
`HttpDataProvider.tsx` carries a 5-minute TTL today, and the line-deleting migration
`00-brief.md` §7.3 rewards would silently have made it static.

**Chosen.** `cache` is required on every http and file entry and forbidden on an inline
entry. `JsonRequest` keeps only `cache: false` as a caller-local opt-out, which also closes
the per-call policy divergence D25 removed everywhere else.

This is D3's treatment of `at:`, for D3's reason: a default on this axis silently changes the
behaviour of every migrated source. The cost — one line per entry in both YAML files — is
paid once, in review, by someone who knows how fresh that payload has to be.

**Rejected.** Defaulting to no caching, which is never stale and never surprising but trades
a silent staleness regression for a silent performance one, and makes the cache opt-in when
it is one of the seven properties `00-brief.md` §2 counts. Also rejected: keeping `manual`
and documenting it, which leaves the failure silent, looking like a working migration, and
surfacing weeks later as stale data.

**Reversibility:** cheap. Adding a default later is additive; removing one is not.

---

## D33 — Optional `maxBytes` and a `json.tooLarge` reason code (2026-08-07)

**Context.** O14: nothing bounded response size. `meta.bytes` is counted after the body is in
hand and every declared bound was temporal. The remote payloads `00-brief.md` §2 names as the
untrusted ones are exactly the ones whose size the operator does not control.

**Chosen.** `maxBytes?: number` on http and file entries, checked against `Content-Length`
where present and against the decoded length always, yielding `json.tooLarge` — not
retryable, nothing cached. Unbounded when undeclared, so no invented number becomes a de
facto policy and nothing existing changes behaviour. D20's router mapping grows one row:
`json.tooLarge` to 502.

**Rejected.** A declared default cap, which protects an undeclared source but invents a
number here rather than deriving it from anything, and lands the failure on whoever publishes
the data rather than whoever set the cap. Also rejected: no bound in v1, which leaves a
hostile or broken upstream able to exhaust the process.

This is not `F5`. F5 defers *handling* large payloads — streaming, chunking. This is
refusing one.

**Reversibility:** cheap for the bound; a ninth reason code is moderate, since exhaustive
switches must grow.

---

## D34 — `AbortController` is the one ambient global the core may use (2026-08-07)

**Context.** D23 gives the core a way to wait. `10-design.md` §4.1 also requires a timeout to
*abort* the attempt, and abandoning a promise leaves the socket open. Constructing an
`AbortController` is an ambient reference in a core whose claim is that it has none.

**Chosen.** I1 permits `AbortController`, and only to cancel a transport attempt. It carries
no time and no randomness, so it does not threaten what the guard in `00-brief.md` §4
actually bans, and it exists in both environments.

**Rejected.** Pushing cancellation into the fetch port by passing it a budget, which moves
retry and timeout policy out of the core into every port implementation. Also rejected:
racing the fetch and abandoning the loser, which satisfies the timeout's observable timing
while leaking a connection per timed-out attempt.

**Reversibility:** cheap, but it widens I1, which is the invariant everything else's
isomorphism claim rests on. It is a named exception, not a relaxation.

---

## D35 — The cache entry holds facts; keys are namespaced per loader (2026-08-07)

**Context.** O9 and O21. `ports.cache` is injectable, so §5's "two loaders in one process
share nothing" was false whenever one `CacheStore` reached two loaders. Separately,
`invalidate()` with no argument could not bump a generation for a key holding no entry —
the cold-cache window D15 exists to close — because `CacheStore` declares no enumeration.

**Chosen.** Three changes. `CacheEntry` stores the value, the source, the location, the byte
count, a memoizable digest, `storedAt`, and the stamp — not a whole `JsonMeta`, whose
`cached`, `attempts`, and `validated` are per call (D13). A loader namespaces its cache keys
with its own instance identity, so a shared store cannot cross-serve, and it never calls
`clear()`. Generation counters live in the loader, not the store, and `invalidate()` bumps a
loader-wide epoch, which covers keys that hold no entry yet.

**Rejected.** Adding `keys()` to `CacheStore` so `invalidate()` could enumerate — it widens a
port to solve a problem the loader can hold internally, and it still misses keys nothing has
written. Also rejected: documenting that a `CacheStore` must not be shared, which defends
§5's claim by convention where namespacing defends it mechanically.

**Reversibility:** cheap. All three are internal to the loader.

---

## D36 — The `mtime` stamp is captured before the read; a null stamp is never a hit (2026-08-07)

**Context.** O22. The design never stated whether the stamp is captured before or after the
read, and §4.1's "stat fails, read anyway" path stores an entry with no stamp without saying
whether that is a permanent hit or a permanent miss.

**Chosen.** Stat before the read. A null stamp is never a hit. An `mtime` policy on a
non-file entry is `config.invalidEntry`, which the split `HttpCacheSpec`/`FileCacheSpec`
types now also make unrepresentable in configuration.

Before-the-read is the safe direction: the stamp may be older than the bytes, which costs one
redundant re-read, where after-the-read may be newer than the bytes, which serves stale
content under a fresh stamp. J2.2 says the policy never returns a stale read, and only one of
the two orderings can honour that.

**Known-and-retained.** The policy still misses a same-size edit inside the filesystem's
mtime resolution — `"a"` → `"b"` at identical size and mtime serves the stale value. That is
inherent to a `(path, mtimeMs, size)` stamp, not a defect in this choice, and the alternative
is hashing the file on every check, which is the cost the policy exists to avoid.

**Reversibility:** cheap.

---

## D37 — `location` records where the bytes came from (2026-08-07)

**Context.** O15, in part. `meta.location` and `JsonLock.location` recorded the *requested*
URL, so a redirect made the lockfile attest a digest to a location the bytes never came from,
and a redirect flip changed content with no location signal.

**Chosen.** Both record the final resolved location (I30). §1.1 already says a cache entry
records the location it was resolved from, and a lookup resolving elsewhere is a miss; this
makes the recorded value mean that.

**Rejected.** Recording the requested URL, which is what a caller asked for and is stable
across upstream changes — but the lockfile's whole job is attesting content to an origin, and
attesting it to a URL that redirected elsewhere is an attestation about the wrong thing.

**Still open.** Whether redirects are followed at all, and what happens to declared headers
across an origin change, is `20-contract.md` §12 U2.

**Reversibility:** expensive once lockfiles are committed.

---

## D38 — `preload`'s guarantee is scoped to the moment it was called (2026-08-07)

**Context.** O23: a ttl source preloaded at boot and read 400 s later against a 300 s ttl,
with the upstream now down, returned `ok: false`. D7's justification is that the process
refuses to boot rather than 500 on first request, and §3.3 never stated that `preload` writes
to the cache at all.

**Chosen.** `preload` performs a full load per id and writes the cache under each entry's
declared policy. Its guarantee is that every named id resolved once, at the moment it was
called — not that it will resolve later.

**Rejected.** Pinning preloaded entries so they never expire, which would make the boot
guarantee durable but reintroduces stale-on-error through a side door (D18) and makes an
entry's lifetime depend on how it was first read rather than on its declared policy.

D7 stands as written: a process that boots is one whose configuration and upstreams were
reachable at boot. Keeping a payload fresh afterwards is the cache policy's job, and
declaring a ttl is declaring that a later failure is acceptable.

**Reversibility:** cheap. Pinning could arrive later as a declared policy, which is the form
it should have anyway.

---

## D39 — The engine's serializer is read; ours aligns to it rather than I13 relaxing (2026-08-07)

**Context.** O16 (issue #17) recorded that I13 and `00-brief.md` §7.7 commit this package to
byte-identity with `src/engine/src/core/persistence/canonical.ts` in `SubZeroDev.GameEngine`,
which nobody who wrote the design had read. It has now been read, at `f7d8f59` (2026-07-28),
and both serializers were run side by side over the engine's own seven test vectors plus
eighteen JSON-domain edges.

The engine's `canonicalStringify` is recursive: `null` literal; numbers through
`JSON.stringify` behind a `Number.isFinite` check; booleans and strings through
`JSON.stringify`; arrays in order; objects filter `undefined`-valued keys, sort with the
default comparator, and emit `JSON.stringify(key):value`. It throws on `bigint`, on
`undefined`, and on any other type.

**Key ordering, string escaping, and number formatting are byte-identical** — verified across
negative zero, `0.1 + 0.2`, the `1e21` and `1e-7` exponent forms, `MAX_SAFE_INTEGER`,
non-ASCII keys, control characters, lone surrogates, empty containers, empty-string keys, and
the lexicographic-not-numeric ordering of `"1"`, `"10"`, `"9"`. Three of the four properties
§12 U4 listed as unverified are settled.

**The value domains diverge, in opposite directions on each case:**

| Value | This package | The engine |
|---|---|---|
| `{a: 1, b: undefined}` | throws `TypeError` | `{"a":1}` |
| `{x: NaN}`, `±Infinity` | `{"x":null}` | throws |
| `{x: 1n}` | throws | throws, different message |

So I13 as literally worded does not hold: four of seven vectors match, two diverge, one agrees
in behaviour but not in message text. `JSON.parse` produces none of these values, so on parsed
JSON the two agree completely — but the digest is taken post-unwrap (D14), and a
caller-supplied unwrap is an arbitrary function whose return value is not constrained to
parsed JSON.

**Chosen.** This package's serializer aligns to the engine's: filter `undefined`-valued keys,
throw on non-finite numbers. I13 stands as written rather than being narrowed.

The deciding argument is D9's direction of travel, not I13's letter. At J9 the engine deletes
its copy and imports this one. The engine's throws are deliberate guard rails — its own
comment says bigint "is rejected here on purpose" — and its determinism acceptance test rests
on them. If this package is the more permissive of the two, J9 stops being a swap and becomes
a silent weakening of the engine's guard, discovered later, with D14's expensive-to-reverse
digest already in the field.

**Rejected.** Narrowing I13 to claim byte-identity only within the parsed-JSON value domain
and recording the two divergences as known-and-retained. It costs nothing today and defers the
same decision to J9, at which point a consumer already depends on the answer. Also rejected:
closing O16 as answered and filing the alignment separately, which leaves J1.5 blocked on a
known defect rather than an unknown one — a weaker reason to stay blocked than the one being
retired.

**Not done here.** No code changed. Making the serializer throw means a throw reaching
`load()`, which needs a `ReasonCode`: §10.2's `json.schema` covers a caller-supplied unwrap
that *threw*, not one that *returned* a value outside the JSON domain. That is a contract
amendment and belongs to `/contract`, which is O16's own stop condition.

Reading the engine also surfaced a live defect on `main`, independent of this decision:
`digestOf` in `src/core/pipeline.ts` is called outside the `try` that wraps `applyUnwrap`, so
a caller unwrap returning an `undefined`-valued key makes `canonicalize` throw straight out of
`load()`, violating I2. Aligning the serializer makes non-finite numbers reach the same path,
so the two must land together.

**Reversibility:** cheap. A pure function and one reason code; no persisted format changes, and
the digest of every value in the parsed-JSON domain is unaffected.

---

## D40 — An out-of-domain post-unwrap value is `json.schema`, checked on every load (2026-08-07)

**Context.** D39 aligned this package's canonical serializer to the engine's — filter
`undefined`-valued keys, throw on non-finite numbers — and stopped short of implementing it,
because a throwing serializer means a throw reaching `load()`, which I2 forbids. `20-contract.md`
§10.2's `json.schema` covered a caller-supplied unwrap that *threw*, not one that *returned* a
value outside the JSON domain. D39 named `/contract` as the owner of that gap. This is it.

**Chosen.** Three things, and a type to make the first checkable.

`CanonicalValue` (§3) states the domain: `null`, booleans, strings, finite numbers, arrays, and
objects whose keys may be `undefined`. `Unwrap`'s function form keeps returning `unknown` — the
domain is enforced at runtime, not by the type. I35 makes the serializer accept exactly that
domain and rejects the rest at any depth.

A value outside it is **`json.schema`**, reusing the existing code rather than adding a tenth.
D28 rejected a distinct code for the `success: false` envelope on the cost of growing every
exhaustive switch, D20's router mapping, and J3's boundary rendering; this condition has a
weaker case than that one did, because it only ever fires on a programming error in the
consumer's own unwrap or inline entry, which is fixed in development rather than rendered at
runtime. §10.2's caller advice grows to name unwrap and inline alongside schema, and `message`
says which.

The check runs **on every load, before freeze and before the cache write, independently of
`digest`** (I36). This is the part that is forced rather than chosen. Canonicalization only
happens when a digest is requested, so checking only there would let an out-of-domain value into
the cache — and I32 then computes a digest from that cached value on a later `digest: true`
request, throwing on a cache hit, in a caller that did nothing wrong. Two callers of one id would
also disagree about `ok` based on a flag neither can see the other set. D21's deep freeze already
walks the same value, so the marginal cost is close to zero.

I13 is also tightened rather than relaxed, per D39: byte-identity on output *and* agreement on
which values are rejected, with message text explicitly not compared. Three of the seven engine
vectors agree on rejection but not on wording, and comparing strings would fail a cross-check
that is otherwise passing.

**Rejected.** A tenth reason code, `json.canonical` — the distinction is real and points a
developer at their own code rather than upstream, which is D20's own argument, but it is paid for
by every exhaustive switch in three consumer repositories for a condition that never survives
development. Reconsider it if a consumer needs the two rendered apart, which is the same standing
offer D28 left.

Also rejected: checking only where canonicalization runs, for the I32 hole above. Also rejected:
narrowing `Unwrap`'s return type to `CanonicalValue`, which moves the constraint into the type
system where it belongs but forces every caller to type an unwrap they currently write inline,
and still needs the runtime check for `inline` entries, which are typed `unknown` by
configuration.

**Not done here.** No code changed, and the live defect D39 surfaced — `digestOf` called outside
the `try` wrapping `applyUnwrap` in `src/core/pipeline.ts`, violating I2 — is `/fix`'s, not this
command's. I36 is what that fix implements against.

**Reversibility:** cheap. A type, two invariants, and one widened table row; no persisted format
changes, and the digest of every value in the parsed-JSON domain is unaffected.

---

## D41 — YAML parser: `js-yaml` ^4.1.0, matching what both converters already run (2026-08-07)

**Context.** O24 (issue #18): `/node`'s `convertYamlToJson` needs a YAML parser and none is
chosen. `10-design.md` §7 Q3 settled the *shape* — a normal dependency of `/node` only, leaving
the core at zero — but named no parser, and `AGENTS.md` requires the alternatives rejected
before J2.3 adds one.

The constraint that decides this is not a property of the parsers. J2.3 requires the CLI
"reproduces the behaviour of both existing converters", and J8.2 requires published artifact
bytes to be **unchanged** after `Data` adopts it — with J8's out-of-scope line stating that a
byte difference is a defect in J2.3, not an improvement to the content. The parser is therefore
constrained by what the two converters already emit, not chosen on general merit.

**What they already run,** read at `Docs-Template/scripts/pre-build.ts:66` and
`Data/build.ts:3`: both are `js-yaml ^4.1.0`, both `yaml.load(content)` then
`JSON.stringify(data, null, 2)`. They differ only in traversal — `Data`'s recurses and mirrors
the directory tree, `Docs-Template`'s is flat — which is J2.3's `recursive directories
included`, not a parser question.

**Chosen.** `js-yaml` `^4.1.0`, called through `load()` on its `DEFAULT_SCHEMA`, as a
`dependencies` entry resolved only by `/node`'s subpath. It is what both converters run today,
at the same major, so J8.2 is satisfiable by construction rather than by luck. It is
zero-dependency, so it does not reopen the core's claim transitively. Its types ship separately
(`@types/js-yaml`), which is the one cost accepted here.

**Measured, not assumed** (js-yaml 4.1.0, `yaml.load`):

| Input | Result |
|---|---|
| `yes` / `no` / `on` / `off` | strings — v4 already uses the YAML 1.2 core boolean set |
| `12:30` | string — no sexagesimal coercion |
| `2025-08-24 00:00:00+00:00` | **`Date`**, which `JSON.stringify` renders `"2025-08-24T00:00:00.000Z"` |

The third row is live: `Docs-Template/config/projects.yml` carries 27+ unquoted timestamps and
`data/projects.json` shows the ISO-with-milliseconds form. Any parser on the YAML 1.2 core
schema leaves those as the string as written, which is a different byte sequence in every
published artifact that has one. That is the whole decision.

**Rejected.**

- **[`yaml`](https://www.npmjs.com/package/yaml) (eemeli)** — better on the merits in isolation:
  YAML 1.2, TypeScript-native so no `@types/*` companion, zero-dependency. Rejected because
  YAML 1.2's core schema has no timestamp type, so every `lastModified` above changes from
  `"2025-08-24T00:00:00.000Z"` to `"2025-08-24 00:00:00+00:00"` — a J8.2 failure across the
  whole corpus, for a package whose entire justification is deleting duplication without
  changing what the consumers publish. Its duplicate-key handling also warns where js-yaml
  throws, which changes failure behaviour as well as output.
- **`js-yaml` pinned to `CORE_SCHEMA`** — drops the timestamp type and keeps everything else,
  which is arguably the *correct* reading of a config file: `lastModified` is content, and
  content silently becoming a `Date` and back is a coercion nobody asked for. Rejected here for
  the same J8.2 reason, and recorded as a follow-up rather than dropped, because the argument
  for it survives this decision.
- **An optional peer dependency, or a parser port** — both already rejected by `10-design.md`
  §7 Q3 (setup cost in three consumer repositories; ceremony for a build-time CLI with one
  caller). Not reopened.

**Known and retained.** `DEFAULT_SCHEMA` yields values outside `CanonicalValue` — a `Date` for
a bare timestamp, and `Buffer`, `Map`, `Set` for `!!binary`, `!!omap`, `!!set`. This is
contained inside `convertYamlToJson`, which stringifies to a file, so nothing outside it ever
holds one: the converter's output is a JSON *file*, and it is not a `CanonicalValue` producer.
It does mean the bridge recorded as contract gap 1 in `30-slices.md` — nothing yet turns
`sources.*.yml` into a `SourceMap` — cannot simply reuse this call, since a timestamp in a
source map would reach the loader as a `Date` and be rejected `json.schema` under I35/I36. That
bridge is not designed here and this note is the reason it needs its own decision.

**Reversibility:** cheap on the dependency, expensive on the output. Swapping the library
touches one module and no public surface — `convertYamlToJson`'s §9 signature names no library.
But any swap that changes type resolution rewrites every published artifact carrying a
timestamp, which is J8.2's assertion failing, by design, so it is caught rather than silent.

---

Settled 2026-08-07, in the `/reconcile` pass that compared the working tree against
`10-design.md` and `20-contract.md` after J1, J10–J12, J2, J3, and J5. D42–D46 are the five
divergences that needed a decision rather than a correction; the rest of that pass was
documentation catching up to code and carries no entry.

---

## D42 — The cache lookup compares source identity, not resolved location (2026-08-07)

**Context.** `10-design.md` §1.1 says a cache entry records the location it resolved from and
that a lookup resolving elsewhere is a miss — written to stop a request carrying its own
`source` from being served an id's cached bytes. D37 then redefined `location` to mean the
**final** location the bytes came from. The implementation compares the stored entry's
`location` against the *declared* URL, so after any redirect the two never match: a redirected
http source misses on every read, re-transports, and rewrites the entry it just wrote. Both
decisions are individually right and jointly broken. Neither the redirect tests
(`src/core/http.test.ts`, I30) nor anything else reads twice, so nothing caught it.

**Chosen.** The lookup compares **source identity** — the entry's recorded `JsonSource` against
the source the request resolves to — not `location`. `meta.location` and
`JsonLock.sources[].location` keep D37's meaning untouched, and a redirected source caches
normally under the id it was declared as. `20-contract.md` I16's "a lookup whose entry resolves
elsewhere is a miss" gains one clarifying clause in the next `/contract` pass: *elsewhere* means
a different declared source, never a different final URL.

**Rejected.** Recording the divergence as known-and-retained and deferring to §12 U2's redirect
policy — cheapest today, but U2 has no owner and no schedule, and until it lands every read of
every redirected source pays a full transport while `stats()` reports honest-looking misses.
Also rejected: storing both the requested and the resolved location on the entry and comparing
the requested one, which works but keeps two location fields where the entry already carries
the source that answers the question.

**Not done here.** No code changed. This is a live defect with an observable behaviour change,
so it goes to `/fix` on a branch with a regression test that fails when the comparison is put
back — `/reconcile` decides which side is correct, it does not land the fix.

**Reversibility:** cheap. Internal to the loader; no persisted format and no public signature
changes.

---

## D43 — `prefetch` constructs its loader over the `at: build` half of the map (2026-08-07)

**Context.** D30 states that because D24 has `/build` rewrite `at: build` entries to inline,
"`prefetch` checks only `at: build` entries", and that the I6 scoping falls out of D24 rather
than needing a mechanism. It does not: `src/build/prefetch.ts` hands the **whole** map to
`createJsonLoader`, and I6 checks exactly what it is given. A build over a map holding an
`at: runtime` http entry therefore demands `fetch` and `schedule` ports for a source I8
guarantees it will never touch. `src/build/prefetch.test.ts` supplies throwing dummy ports to
get past it, with a comment explaining the workaround — which is drift documented as a fixture.

**Chosen.** `prefetch` builds its loader over a map filtered to `at: build` entries. That is
what D30 describes, and it makes I6's "exactly the entries in the map supplied" literally
correct at the build boundary instead of approximately correct. The dummy ports go with it.

**Rejected.** Amending D30 to say `prefetch` checks the full map and that a consumer must
supply every port any entry declares — honest and zero-risk, but it reinstates precisely the
case D30 exists to close, and taxes every consumer's build with ports for sources it never
resolves. Also rejected: relaxing I6 to skip `at: runtime` entries inside `createJsonLoader`,
which pushes an `at`-shaped branch into the core that D24 was designed to keep out.

**Not done here.** `/fix`'s, with a test that fails when the filter is removed.

**Reversibility:** cheap. One function, no public surface.

---

## D44 — The canonical serializer stays unexported until §9 declares it (2026-08-07)

**Context.** `src/core/index.ts` exports `canonicalize`, `digestOf`, and `sha256Hex` from the
`.` entry point. `20-contract.md` §9 declares none of them, and `30-slices.md` J1's out-of-scope
line says in as many words not to invent that export to satisfy J9.1 — the gap is recorded as
contract gap 2. Only `canonicalize` has a caller outside `src/core/` (`src/build/prefetch.ts`),
and that caller is inside this package.

**Chosen.** Remove all three from the core index; `/build` imports `../core/canonical.js`
directly. Contract gap 2 stays open, for `/contract` to answer with J9.1's actual requirement in
view rather than by ratifying whatever a slice happened to export.

**Rejected.** Amending §9 to declare the three now, which closes gap 2 early and hands J9.1 its
import — but it sets a public compatibility promise on `sha256Hex` and `digestOf` that nobody
has asked for, decided in a reconcile rather than in `/contract`, which `AGENTS.md` routes
public-interface decisions to. The asymmetry is the argument: adding an export later is
additive, removing one after publication is not, and 0.1.0 is unpublished.

**Not done here.** `/fix`'s, alongside D42 and D43.

**Reversibility:** cheap in the additive direction, expensive in the other — which is why the
narrow side is the default.

---

## D45 — The failure envelope carries `message`, matching what the core reads (2026-08-07)

**Context.** D28 settled that the `'subzerodev'` literal stays in the core and `/node` owns the
producer, with J2.5's round-trip test keeping the two ends agreeing. The core's unwrap reads
`envelope.message`; `jsonRouter` emits `{ success: false, error }`. So a data-json client
reading a data-json server's failure gets the generic fallback text instead of the real one,
which is exactly what I34 says must not happen. J2.5 covers only the success half, which is how
"owning both ends" missed it.

**Chosen.** The router emits `{ success: false, message }`, matching what the core already
reads and what I34 already says. J2.5's round trip grows to cover the failure half — the gap
that let a shape divergence through a test written to prevent one.

**Rejected.** Making `applyUnwrap` read `message ?? error`, which changes nothing on the wire
and is more forgiving of third-party envelopes — but it puts a compatibility shim in the core
for its own sibling module and leaves two field names for one thing, which is what single
ownership exists to prevent. Also rejected: specifying `{ success: false, error }` in §9 as-is
and accepting the lost text, which is cheapest and is the warn-then-degrade shape D8 retires.

**Not done here.** `/fix`'s. The response body is observable, so this is free only while no
consumer exists — which is now.

**Reversibility:** cheap today, moderate after J6+J7 migrate a consumer onto the mount.

---

## D46 — The public/server gate's guarantee is filename-scoped, and that is stated (2026-08-07)

**Context.** I7 claims no server-map entry appears in **any** artifact reachable by a browser
bundle, and D6 rests part of the two-file split on the leak being greppable in CI.
`assertNoServerSourcesInBundle` matches files whose basename equals a server source id. That
catches a prefetched artifact written into the public output and nothing else: a server URL, or
a declared `Authorization` header, inlined into a JS chunk passes the gate clean.

**Chosen.** State what the gate proves rather than what I7 claims, and file the widening — a
content scan of the public output for each server entry's URL and header names — as its own
work. The narrow gate is not removed; it is the cheap half, and it stays.

**Rejected.** Widening the scan inside this reconcile. The widening needs a policy answer this
command has no business setting: what counts as a match once a bundler has minified, escaped,
or split the string, and what a false positive does to a build. That is a slice, not an edit.
Also rejected: narrowing I7 to match the implementation, which makes the invariant true by
construction and needs no follow-up — but it gives up the greppable-in-CI argument that is a
large part of why D6 chose two files over one.

**Reversibility:** cheap. The statement is documentation; the widening is additive.

---

## D47 — The lockfile carries no timestamp; `resolvedAt` is removed (2026-08-08)

**Context.** `/reconcile` against the implemented tree found `20-contract.md` contradicting
itself. I21 requires two builds over unchanged bytes to produce a byte-identical `json.lock`;
§7 requires a per-entry `resolvedAt` ISO 8601 stamp. `prefetch` implemented §7, so I21 has
never held since J3 merged. The J3.3 test regexed `resolvedAt` out before comparing and kept
the title "byte-identical lockfile", so the gate reported green throughout.

The lockfile is committed, and §11 says why: so builds are comparable. A field derived from a
clock makes every rebuild a diff, which defeats the only property the file is committed for —
`10-design.md` §3.2 step 4's "a real diff means real change". §7 itself called `resolvedAt`
"informational only — never an input", so nothing reads it and nothing can break.

**Chosen.** Remove `resolvedAt` from `JsonLock` in §7, §11, `types.ts`, and `prefetch.ts`. I21
is restated as byte-identity of the whole file with nothing excluded, and as a standing ban on
any clock-derived lock field. J3.3 now compares both files whole; J3.2 becomes a key-set
assertion that fails if `resolvedAt` or a successor is reintroduced.

**Rejected.** Narrowing I21 to "byte-identical apart from `resolvedAt`" and retitling the test.
Doc-and-test-only and the cheapest to apply, but it contracts the churn rather than fixing it:
every rebuild keeps dirtying a committed file, and §3.2 step 4 stays false. Also rejected:
moving the stamp to a single top-level `JsonLock.resolvedAt`, which shrinks the diff to one
line and still costs a contract amendment without buying the invariant.

**Reversibility:** cheap now, expensive later. 0.1.0 is unpublished, so removing a field costs
nothing today; after publication a lockfile shape change invalidates every committed lockfile
in every consumer.

---

## D48 — A supplied `fetch` port requires a `schedule` port, map or no map (2026-08-08)

**Context.** I2 says `load()` never throws and never rejects. It did. `20-contract.md` §3 gives
an ad-hoc `JsonRequest.source` "the default timeout", which `pipeline.ts` implements as a
hard-coded 10 000 ms, and the timeout is started by calling `ports.schedule!(timeoutMs)` outside
any `try`. I6 checks ports against the entries *in the map*, and an ad-hoc source is by
definition not one — so a loader with no http entry has no reason to hold a `schedule` port, and
an ad-hoc http read on it rejected with a bare `TypeError`. Reproduced before deciding: two
probes, one with a `fetch` port and one with no ports at all, both rejected out of `load()`.

**Chosen.** Two changes that together close it. I6 gains one deliberately map-independent
clause — a supplied `fetch` port requires a `schedule` port alongside it, whether or not any
entry declares http. And `httpAttempt` guards the call rather than asserting it: an absent
`schedule` port means no timer for that attempt. The guard is only reachable on a loader holding
neither port, where the attempt fails on the absent `fetch` a few lines later and returns
`json.transport`. I2 becomes true in every case.

The widening contradicts I6's own "covers exactly the entries in the map supplied, never a wider
set", and that is stated in I6 rather than left to be found. The clause is what the sentence did
not anticipate: a request can name a source the map never mentions.

**Rejected.** The guard alone, with I6 untouched — smallest diff and I6's scoping clause
survives intact, but it leaves an ad-hoc http read silently unbounded on any loader that happens
not to hold a schedule port, which is a worse default than the one being fixed. Also rejected:
returning `json.unresolved` for the missing port, which refuses a source the caller explicitly
handed in over a port they were never told to supply. Also rejected: requiring `schedule`
unconditionally at construction — J1.3 and I33's second half both require
`createJsonLoader(map)` with `ports` omitted entirely to work over inline entries.

**Reversibility:** cheap. One construction-time check and one guarded call; no persisted format
and no result shape changes.

---

## D49 — The canonical serializer rejects any object that is not a plain record (2026-08-08)

**Context.** I35 says the serializer "accepts exactly `CanonicalValue`", whose object arm is a
plain record. `canonicalize` treated everything `typeof === 'object'` as one, so a `Date`, `Map`,
`Set`, `RegExp`, or class instance — none of which has enumerable own keys — serialized to `{}`.
Four different values, one serialization, one digest, which is I5's "two that differ produce
different digests" broken silently. Reachable today through a hand-written `inline` entry, whose
`data` §3 explicitly binds to the same domain, and guaranteed once a YAML reader lands: D41
records that `js-yaml`'s `DEFAULT_SCHEMA` resolves a bare timestamp to a `Date`, and
`Docs-Template/config/projects.yml` has 27+ of them.

**Chosen.** Reject on prototype: accept arrays and objects whose prototype is `Object.prototype`
or `null`; throw on everything else. The pipeline already turns that throw into `json.schema`
(D40, I36), so a silent `{}` becomes a named failure before the value can be digested, frozen,
or cached.

This may make the package stricter than the engine's serializer, which I13 pins it to. D39 read
that module at `f7d8f59` and recorded no non-plain-object vector, and D39 is explicit that its
behaviour is not to be guessed at again — so whether the engine rejects a `Date` is unknown.
Stricter is the safe direction under D39's own deciding argument: J9 swaps this implementation
in beneath the engine's determinism acceptance test, and *permissive* is the failure mode that
turns a swap into a silent weakening. I13 is amended to allow rejecting strictly more, never
less, with the unknown named rather than assumed.

**Rejected.** Rewording I35 to promise rejection only for its enumerated cases and dropping
"exactly" — doc-only and no behaviour change, but it makes a `Date` reaching a digest as `{}`
contracted behaviour and leaves I5 quietly false. Also rejected: deferring to the U8 YAML
reader, which leaves I35 literally false in the meantime and lands the fix in the slice least
able to argue about the core's value domain.

**Reversibility:** cheap. A pure function and one prototype check; every value in the
parsed-JSON domain is unaffected, so no digest in that domain changes.

---

## D50 — The determinism guard bans bare specifiers, not just Node builtins (2026-08-08)

**Context.** I1 says the core imports no module and that this is "enforced by the determinism
guard in CI, not by review". The guard, copied from the engine at J1.8, restricted only `fs`,
`node:fs*`, and `node:*`. `import { load } from 'js-yaml'` inside `src/core/` passed lint clean,
so the zero-import claim rested on review after all — the one thing the sentence says it does
not. Nothing violated it; the enforcement claim was what was false.

**Chosen.** Ban every non-relative specifier in `src/core/**`, across static imports, dynamic
`import()`, and re-exports. Implemented with `no-restricted-syntax` and an esquery regex on the
source string rather than `no-restricted-imports`: that rule's gitignore-style matcher
normalizes `./` away, so a negation written to spare the core's own siblings spares `js-yaml`
too — attempted first, and it rejected all seven of `pipeline.ts`'s relative imports. Verified
by probe rather than asserted: all three specifier shapes rejected, clean tree passes.

**Rejected.** Softening I1's enforcement clause to "guard covers globals; zero-dependency rests
on `package.json` review" — doc-only, but I1 is the invariant the GameEngine consumer is being
sold, and downgrading it to partly-by-review is the opposite of what J9 needs. Also rejected:
leaving it, on the grounds that nothing violates it — a guard with a hole nobody has walked
through is still a guard that reports green on the first core dependency added.

**Reversibility:** cheap. Lint configuration only.

---

## Deferred

| | Item | Gated on |
|---|---|---|
| **F1** | GameEngine adoption (J9) | Content packs existing and needing JSON loading |
| **F2** | Write support in `/node` | A second consumer needing it; D5 is not a permanent judgement |
| **F3** | Environment-only credential resolution | A source that actually needs a credential; D6 alternative three |
| **F4** | `SubZeroDev.Data.Yaml` or `.Sql` siblings | A consumer. The namespace exists for them; nothing is designed |
| **F5** | Streaming and large-payload handling | A payload large enough to matter. Everything here assumes a payload that fits in memory |

## Open

A staging area, not a home: an item stays here only until `/track` files it as a GitHub issue,
then it is removed. New items go here as bullets, each starting with a **bolded lead sentence**
— that sentence becomes the issue title when `/track` files it (see
`.claude/commands/track.md`, "Open items → issues").

O1, O3, O4, O5, O15, O16, O24 and O25 were filed by `/track` on 2026-08-07
(`The-Running-Dev/SubZeroDev.Data.Json` issues #12–#19) and removed from this section. O26 and
O27 were filed by the same command later the same day, as `The-Running-Dev/SubZeroDev.Data.Json`
issues #29 and #30, and removed likewise. O28 was filed the same day, as issue #34, and removed
likewise. The public/server gate content-scan item (D46) was filed on 2026-08-08 as issue #37
and removed likewise. Track them all there. O24 is answered by D41 above.

O16 (issue #17) is answered by D39: the engine's serializer has been read and cross-checked,
and the resolution it calls for is a `/contract` amendment, not a change to I13. That
amendment is D40, and it closes `20-contract.md` §12 U4. What remains of O16 is code, not
design: `/fix` implements I35 and I36.

O6–O23 were the 2026-08-07 red-team pass against `00-brief.md` and `10-design.md`.
Fifteen of them — O6–O14 and O18–O23 — were adjudicated in the `/contract` pass of the same
day and are now D22–D38, which also close the older O2. O17 was absorbed into O5, and O15 was
split: its `location` half is settled as D37 and its redirect half is issue #16.

`harness/` still reproduces the findings as originally reported — `node harness/run.mjs`, no
install — and is now a regression corpus rather than a review: a probe that keeps passing
after J1 means the amendment did not land. `harness/README.md` states what it is not.
