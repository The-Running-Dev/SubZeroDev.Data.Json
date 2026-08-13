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

## D51 — The leaf half of the star graph becomes I37, guarded and tested (2026-08-08)

**Context.** `10-design.md` §2 draws the module graph as a star and then names its own failure
mode: "the only way to break it is a leaf importing a leaf. That is the thing to guard against,
and it has a cheap guard: the core's out-degree is zero and each leaf's in-degree from siblings
is zero, both checkable mechanically." Only the first half was ever written into the contract.
I1 covers the core; the leaf half had no invariant and no rule, and `eslint.config.js` scoped
every rule to `src/core/**`. `/build` importing `/node` — the edge D19 forbids because it is
how `FileSystemPort` would acquire a write member — was review-enforced. The tree was clean, so
nothing was broken; as with D50, the enforcement claim was what was false.

**Chosen.** I37, and a second lint block over `src/{node,build,zod,react}/**` banning a
relative reach into a sibling leaf across static imports, dynamic `import()`, and re-exports.
`../core/` is deliberately outside the alternation: that edge is what the star graph is made
of. Test files are outside the guard — a fixture is not a shipped edge, and a `/build` test
composing `nodePorts` is legitimate.

Also chosen, and new relative to I1: **the guard has a test.** `src/boundaries.test.ts` runs
ESLint over violating fixtures for all three specifier shapes and over two legal imports.
Verified by reverting: with the alternation neutered, three of five fail. I1 has no equivalent
and never has, which is the mechanism by which the hole D50 closed went unnoticed for as long
as it did — a rule nothing exercises reports green whether or not it works.

**Rejected.** Leaving it uncontracted, on the grounds the tree is clean — that is the argument
D50 rejected two entries ago, and it ages badly the first time `/react` lands and wants
something `/node` already has. Also rejected: routing it to `/design` as a question about
whether the star graph binds — D2 and D19 already settled that it does, so there was no
question, only a missing transcription. Also rejected: `no-restricted-imports` patterns, for
D50's reason.

**Reversibility:** cheap. One invariant row, one lint block, one test file.

---

## D52 — One event per `load`, and `phase` is the last phase that ran (2026-08-08)

**Context.** `10-design.md` §1.2 gives the Event entity a lifecycle — "fire-and-forget; nothing
may depend on delivery" — and §3.1 step 9 sends one to the log port. `20-contract.md` §4 typed
`JsonEvent` and `JsonPorts.log` and then obliged nothing: no invariant named either, so under
`00-brief.md` §7.1 no test was owed, and `ports.log` is called nowhere in `src/`. A typed port
that no invariant governs is surface the implementation is free to skip, and it did.

The design determines that an event is emitted and that delivery is not load-bearing. It does
**not** determine which of `phase`'s six values a given outcome carries, and `/contract` may
not invent that. Raised as a fork; the choice taken was to settle it here rather than defer it
to a `/design` pass, this session already being at that tier.

**Chosen.** I38 for what the design settles: exactly one event per completed `load`, emitted
after assembly and before `load` resolves, carrying that call's own `id`, `reason`, and `meta`,
and a throwing `log` port changing neither the result nor the cache (I2 admits no exception).
Every id resolved through `loadById`, `loadMany`, `preload`, and `prefetch` emits, and so does
a caller that joined rather than started a load — the event describes a call, not a transport.

For `phase`, **the last phase that ran**, tabulated in §4. One mechanical rule covers all nine
outcomes, success and failure alike, and it is the only reading under which `json.schema` does
not need a per-case judgement: unwrap failures, the I36 domain check, and validator failures
each terminate at a different phase, so `phase` is what discriminates the three origins the
reason code deliberately collapses. `fetch` covers a file read as well as an http one; the
union has no separate read phase and inventing one would be a contract change the design does
not ask for.

**Rejected.** Deferring the mapping to §12 as a U-item — honest, and the smaller move, but it
leaves I38 half-testable and the mapping would be decided by whoever implemented it first,
which is how a contract acquires a rule nobody chose. Also rejected: "the phase that caused the
outcome", which reads better and is a judgement call on every `json.schema`. Also rejected:
deleting `log` and `JsonEvent` as unbuilt surface — cheap today at 0.1.0 unpublished, but
`10-design.md` §4.2 rests browser and server diagnostics on reason-code observability, and the
event is the only path by which a consumer sees an outcome it did not itself await.

**Not implemented here.** The core still calls no log port. I38 is what makes that a defect
with a reproduction rather than an omission with no name, and it routes to `/fix`.

**Reversibility:** cheap for I38 and the emission. Expensive for the `phase` mapping once a
consumer logs against it, since the values become load-bearing in someone's dashboard.

---

## D53 — `useJson` reaches its loader through a `JsonProvider` context (2026-08-08)

**Context.** `20-contract.md` §12 U1, and issue #19 (O25). The 2026-08-06 draft gave `/react`
two signatures — `useJson<T>(id)` and `JsonBoundary({ id, fallback, children })` — and neither
carries a loader, so neither is implementable. J4 was blocked on this, and J6+J7 transitively
through it, which is `00-brief.md` §7.3's definition-of-done gate.

**Chosen.** A `JsonProvider({ loader, children })` context component, `/react`'s third export.
`useJson` and `JsonBoundary` read the nearest provider above them; both draft signatures stand
unchanged. The provider **accepts** a loader and never constructs one, keeping
`createJsonLoader`, the source map, and the ports in the composition root — where
`config.missingPort`'s own remedy already points. It never calls `dispose()` on unmount, since
a component does not dispose what it did not create (D31). Rendering either member with no
provider above it throws `JsonError('config.missingProvider')`, a new member of §10's closed
code union; I24 already forbids a bare `Error`, so a throw here needs a code. Constrained by
I39.

**Rejected.** A **loader parameter** — `useJson(loader, id)`, `JsonBoundary({ loader, ... })` —
which adds no public interface at all and is the more explicit of the two. It loses on the
boundary rather than the hook: nested boundaries prop-drill the loader, and every consumer that
adopts it builds its own context to avoid threading a loader through every call site. That is
five consumers with five solutions, which is `00-brief.md` §2's complaint verbatim, and it
collides with J6.3, which has `DataProvider` survive as a feature gate rather than as a
component that also plumbs data access.

Also rejected: a **module-level singleton** (`setDefaultLoader()`), which needs no provider
mounted and no signature change. It is module-level mutable state that leaks across requests
under SSR — and Docusaurus server-renders — it makes the process the cache unit where
`10-design.md` §5 makes the loader the unit, and it is the ambient wiring `00-brief.md` §4
rules out. Not offered as a live option.

Also rejected, **for now rather than on the merits**: `useJsonLoader(): JsonLoader`, an escape
hatch to `invalidate`, `preload`, and `loadMany` from a component. J4 states no need for it and
`refetch()` covers the common case. D44's reasoning applies unchanged — adding an export later
is additive, removing one after publication is not — so it waits for a slice that states the
requirement. Recorded here as known-and-retained, not dropped: without it, a consumer that
needs those members re-adds its own context to reach the loader, which is the duplication this
package exists to delete, and that is the signal that the requirement has arrived.

Also rejected: returning `json.unresolved` when no provider is mounted, which needs no new
error code and keeps `/react` throw-free. `20-contract.md` §10.2 defines that code as an absent
id or a malformed request; a missing provider is neither, and `JsonBoundary` would render a
developer a wrong-id state when the fault is wiring.

**Not implemented here.** No `src/react/` exists. This unblocks J4; it does not perform it.

**Reversibility:** cheap today — 0.1.0 is unpublished, and I37's guard already covers
`src/react/`. Expensive once published: removing `JsonProvider` or changing where the loader
comes from is a breaking change at every call site in every consumer.

---

## D54 — `@testing-library/react`, `jsdom`, and the React DOM test runtime for `/react`'s tests (2026-08-08)

**Context.** D2 records React as an optional peer dependency but says nothing about how
`/react` gets tested; J4's test suite (`src/react/react.test.tsx`, `src/boundaries.test.ts`)
needs a DOM and a way to render and interact with components, neither of which vitest supplies
on its own.

**Chosen.** `@testing-library/react` (rendering, `screen`, `renderHook`), `jsdom` (vitest's DOM
environment for `src/react/**`), and `react`/`react-dom` themselves as devDependencies in
addition to the existing peer-dependency declaration — the peer entry covers what a consumer
installs, the devDependency covers what this repository's own test run needs.

**Rejected.** `@testing-library/preact` or a hand-rolled shallow renderer — neither exercises
real DOM commit/effect timing, which is exactly what J4.4's unmount-and-id-change tests need to
be trustworthy. Also rejected: `happy-dom` in place of `jsdom` — no functional difference for
this suite's needs, but `jsdom` is the environment the ecosystem's own examples and Testing
Library's documentation assume, and there is no reason to diverge.

**Reversibility:** cheap. Test-only dependencies, no published surface; swapping the DOM
environment or the rendering library touches test files only.

---

## D55 — J4.4 amended: unmounting suppresses the update, it does not abort the request (2026-08-08)

**Context.** PR #53 review: J4.4 read "unmounting aborts an in-flight request," but
`JsonLoader.loadById` (§9) carries no cancellation token — `JsonRequest` (§3) was never given
one, and D34 restricts `AbortController` to the core's own transport attempt, not to a signal a
caller can hand in. `useJson` therefore cannot abort the underlying fetch or file read; it can
only discard the result once it arrives, which is what the shipped `generation` counter in
`src/react/use-json.ts` does.

**Chosen.** Reword J4.4 to state what is actually guaranteed: unmounting, or `id` or the
provider's loader changing, discards an in-flight call's result — no state update after
unmount, and no stale `(id, loader)` pair's result rendered under a new one — without claiming
the request itself is aborted.

**Rejected.** Threading a cancellation signal through `JsonLoader.loadById` into the fetch port
so the request is genuinely aborted. That is a new public interface not in `20-contract.md`
(`AGENTS.md`, *Hard rules*) — it changes §9's signature and touches the core pipeline's fetch
port, which is `/contract`'s call, not a fix folded into this slice.

**Reversibility:** cheap. A wording correction; adding real cancellation later is additive to
`JsonLoader`, not a breaking change to what J4 ships now.

---

## D56 — J12.9 names `harness/run-real.mjs`, not `harness/run.mjs` (2026-08-08)

**Context.** PR #55's review (`copilot-pull-request-reviewer`) flagged that J12.9 as written
named `node harness/run.mjs` as the command that runs the probes against the real, built
core — but the PR left `run.mjs` untouched as the reproduction runner and added
`run-real.mjs` as a new, additive command for that check, contradicting the criterion's own
wording. The conflict was internal to this document: the *Regression corpus* section two
screens below J12.9, `harness/README.md`, and this file's own `## Open` closing note all
already say `harness/run.mjs` stays the reproduction, so J12.9's wording was the one entry
out of step with the rest of the design's stated intent.

**Chosen.** J12.9 now names `harness/run-real.mjs`. `harness/run.mjs` keeps meaning what
`harness/README.md` says it means — the reproduction, unmoved, evidence about the
reproduction and not about the shipped core.

**Rejected.** Rewriting `harness/run.mjs` in place to point at the real core, which would
satisfy J12.9's literal text but break the regression corpus: a green `run.mjs` would stop
being evidence that a red-team finding still reproduces against the *documents as written*,
which is the property `## Regression corpus` and `harness/README.md` exist to preserve, and
the one a later probe addition depends on staying stable.

**Reversibility:** cheap. A naming correction with no behavioural change; PR #55's own
implementation was already built the other way.

---

## D57 — Publish `@subzerodev/data-json` to the npm registry, tag-triggered (2026-08-08)

**Superseded by D58** — the scope named here never had working publish access; see D58.

**Context.** Issue #34 (O28), filed while selecting J8: the package has never been published
— `npm view @subzerodev/data-json` 404s — and had no installable form for another
repository. `dist/` was gitignored with no `files` allowlist and no `prepublishOnly`/`prepare`
lifecycle script, so a `file:` or git dependency would have installed an empty package. J8
(and transitively J9) assume "the published CLI" already exists to depend on; it did not.

**Chosen.** Registry publish. A `files: ["dist"]` allowlist and a `prepublishOnly: "npm run
build"` script make `npm publish` ship built output. A new workflow,
`.github/workflows/publish.yml`, runs on a pushed `v*.*.*` tag: install, typecheck, lint,
test, build, then `npm publish --provenance --access public` using an `NPM_TOKEN` repository
secret. Versioning is manual — `npm version <major|minor|patch>` committed and tagged by
hand — matching this repository's preference for an explicit, logged decision over
automation-by-convenience (no changesets, no auto-bump on merge).

**Rejected.** A `file:`/git dependency via a `prepare` script. Cheaper to stand up (no
registry account, no secret), but every consumer install re-clones and rebuilds the package,
version pinning is a commit SHA rather than semver, and it does not satisfy what J8's
criteria already assume ("the published CLI"). Left as the fallback if npm registry access
turns out to be unavailable.

**Known cost, accepted.** `NPM_TOKEN` must be created on npmjs.org and added as a GitHub
repository secret by hand — an agent session cannot obtain npm credentials or add a repo
secret itself. The workflow is wired and inert until that secret exists; no tag has been
pushed and no publish has run.

**Reversibility:** cheap to keep publishing. **Expensive to unpublish** — npm blocks
unpublishing a version once other packages may depend on it (a 72-hour grace window only), so
a first publish, once it happens, is effectively permanent; the workflow is reviewed before
the first tag is pushed rather than trusted on the first run.

---

## D58 — Drop the `@subzerodev` scope; publish unscoped as `subzerodev-data-json` (2026-08-08)

**Context.** D57's `NPM_TOKEN` was added and a `v0.1.0` tag pushed to exercise
`publish.yml`. The run authenticated and built provenance successfully, then failed: `npm
publish` returned `404 Not Found — PUT .../@subzerodev%2fdata-json`. The `subzerodev` npm
org does exist (`registry.npmjs.org/-/org/subzerodev/user` returns an owner), but the
account behind `NPM_TOKEN` is not a member of it — npm returns 404 rather than 403 for a
non-member to avoid confirming the scope's existence. The same scope, on the same org, has
never successfully published anywhere: `@subzerodev/plugins-github`
(`SubZeroDev.Plugins.GitHub`) has an equivalent workflow that has never run, and
`@subzerodev/container-manager-common` (`Container-Manager-Common`) is unpublished too. The
one package in this account's repositories that is actually live —
`subzerodev-platform-ui-landing-page` (`SubZeroDev.Platform.UI.LandingPage`, versions
0.1.0–0.3.0 on the public registry) — is unscoped.

**Chosen.** Drop the scope. `@subzerodev/data-json` becomes `subzerodev-data-json`,
following the same kebab-cased-repo-name pattern the landing-page package already uses. The
registry, the `NPM_TOKEN` secret, and `publish.yml`'s mechanics are otherwise unchanged from
D57 — an unscoped first publish needs no org membership, only that the name be unclaimed
(`npm view subzerodev-data-json` 404s, confirmed unclaimed).

**Rejected.** GitHub Packages under `@the-running-dev/data-json`, matching
`SubZeroDev.GameEngine`'s `@the-running-dev/game-engine`, authenticated with the repo's own
`GITHUB_TOKEN` instead of a separate npm credential. This is a proven working pattern in a
sibling repository and was the first fix proposed, but was set aside once the unscoped
npmjs.com route — matching an already-*live* package rather than a wired-but-never-run
workflow — was raised as the closer precedent. Also rejected: fixing `subzerodev` org
membership for the `NPM_TOKEN` account on npmjs.org directly, which would have kept D57's
scoped name but requires an npmjs.com account-level change (adding a member to the org)
that, like D57's original token creation, an agent session cannot perform.

**Amends.** D1's published name (`@subzerodev/data-json`) and D57's publish mechanics
description, wherever both name the scoped form. Neither entry is rewritten; this record is
the reason the name in the tree now reads `subzerodev-data-json`.

**Reversibility:** cheap now — the `v0.1.0` tag pushed under D57 never successfully
published anything, so no consumer depends on the old scoped name. Re-tagging under the new
name costs one tag delete and one re-push.

---

## D59 — What makes a cache lookup a hit becomes I40 (2026-08-08)

**Context.** `10-design.md` §3.1 step 2 states the hit condition for all three cache policies:
`manual` "always hits until invalidated", `ttl` "hits while the clock says the entry is inside
its window", `mtime` "hits while `(path, mtimeMs, size)` is unchanged". `20-contract.md` typed
`CachePolicy`, `HttpCacheSpec`, `FileCacheSpec`, and `CacheEntry.storedAt` and then said what
none of them *do*: I25 covers the mtime stamp's capture order and that a null stamp is never a
hit, I16 covers the source comparison, and no invariant anywhere states when an entry is
served. The behaviour is implemented in `checkCache` and tested — `src/core/cache.test.ts`
carries "'manual' hits until invalidate" and "'ttl' hits inside the window and misses outside
it" — so this is a transcription gap, not a defect. Under `00-brief.md` §7.1 an invariant owes
a test; the inverse case, a tested behaviour no invariant owns, is a test that can be deleted
with no document objecting, which is the same hole D52 named for `ports.log`.

**Chosen.** I40 states all three conditions, each as a conjunct with I16's source comparison
rather than instead of it. I12 gains a second sentence for the other thing §1.3 determines and
the contract never carried: a hit's `meta.bytes` and `meta.location` are the entry's stored
values, not values re-derived on this call.

One point in I40 is finer than the design's own words. "Inside its window" does not settle the
boundary; I40 makes it half-open — `clock() - storedAt < ttlMs`, so an entry exactly at
`ttlMs` has expired. That is what `checkCache` implements and what the J10 test asserts, so
the choice ratifies shipped, tested behaviour rather than setting new policy, but it is named
here because it is the one clause a reader could not have derived from `10-design.md` alone.

**Rejected.** Leaving the policies uncontracted on the grounds that the code is correct and
tested — which is exactly the argument D50 and D51 rejected twice. A behaviour with a test but
no invariant is enforced by whoever remembers the test's title, and the ttl boundary in
particular is a one-character change no document would have caught. Also rejected: writing the
conditions into `10-design.md` §3.1 instead, which is where they already are — the gap is that
the contract, the artifact an implementation is checked against, never restated them.

**Reversibility:** cheap for the transcription. Moderate for the ttl boundary once a consumer
depends on the expiry edge, though no consumer can today.

---

## D60 — The source map is normalized once, at construction (I41) (2026-08-08)

**Context.** `10-design.md` §1.2 gives two entities an explicit lifecycle the contract never
carried. The source map is "read once, at build or at loader construction. Never reloaded — a
changed file means a new loader." The normalized source is "derived once at construction from
the entry or a bare string; never re-derived per read." `createJsonLoader` implements both —
`normalizeSourceMap` builds a separate `Map` of normalized entries and `runPipeline` reads only
from it — but no invariant said so, so nothing stopped a later change from re-reading the
caller's `SourceMap` per load and nothing would have failed if it had.

**Chosen.** I41, scoped to exactly what the design determines and what the implementation
actually guarantees: the set of resolvable ids, and each entry's normalized source, `unwrap`,
cache policy, timeout, retry, and `maxBytes`, are fixed at construction.

**Deliberately not claimed:** that the `SourceMap` is deep-copied. An inline entry's `data` is
held by reference, so mutating the contents of that value before its first load is observable.
The design determines normalization-once, not a defensive copy, and I41 is worded so that it
is true rather than aspirational — a broader "mutating the map after construction changes
nothing" would have been false on that one path and would have failed the `00-brief.md` §7.1
test-must-fail-when-removed standard by being untestable as stated.

**Rejected.** Stating the invariant over the whole `SourceMap` including inline payloads, which
reads better and covers the case a caller is most likely to get wrong, but would contract a
deep copy nobody implements and D21's freeze already covers once the value has been loaded
once. Also rejected: leaving it uncontracted because the implementation is correct — D50's
argument again.

**Reversibility:** cheap. One invariant row over behaviour that already holds.

---

## D61 — A cache opt-out neither joins nor is joined; I17 narrows to cache-eligible misses (2026-08-08)

**Context.** `20-contract.md` §12 U9. `JsonRequest.cache?: false` is declared in §3 as a
caller-local opt-out and implemented in `src/core/pipeline.ts`, where both the http and the
file path take the opt-out branch before ever reaching the in-flight map. I17 says "concurrent
misses for one key issue one transport" and admits no exception, so an opt-out read concurrent
with a normal read of one id issues two transports where the contract says one. One of the two
is wrong. `10-design.md` §5 keyed the in-flight map on the cache key and never said whether a
caller outside the cache has one, so the design settled neither side. The flag is exercised by
no test anywhere in `src/`, which is how the divergence survived J11 and every pass since.

**Chosen.** Participation in the in-flight join is exactly participation in the cache. A
`cache: false` request, like an ad-hoc `JsonRequest.source` under I16, has no cache key and
therefore neither joins a load in flight nor may be joined by one. `10-design.md` §3.1 step 2
and §5 now state this; the code already does it, so the implementation is ratified rather than
changed.

Two arguments carry it. The in-flight map **is** a cache with a lifetime of one load — a joiner
receives a value fetched in response to an earlier call, which is the one thing a caller opting
out of the cache is asking not to receive, and "fresh unless something beat you to it by a few
milliseconds" is not a property a call site can reason about. And tying participation to
cache-eligibility keeps one caller's flag out of another caller's behaviour: were an opt-out
read allowed to initiate a load a normal read joined, whether that entry is committed would
depend on which of the two arrived first, which is the coupling `10-design.md` §1.4 and D21
already refuse for cache policy.

**Requires a contract amendment, not made here.** I17 is over concurrent **cache-eligible**
misses. `/contract`'s.

**Rejected.** Letting an opt-out read join and be joined while never reading or writing an
entry — the reading that keeps I17 unqualified and saves a round trip, and the more natural
one if you read `cache: false` as "do not persist" rather than "do not share". It loses on the
commit question above: it forces a second decision the chosen reading never has to make, and
every answer to it is order-dependent. Also rejected: deleting `cache: false` from v1, which
removes the contradiction instead of deciding it and is by some way the smallest edit — but
0.1.0 is published, so the removal is a breaking change rather than the free one D44's
asymmetry argument assumed when it was not, and `useJson`'s `refetch` is the consumer that will
want the flag (see `## Open`).

**Reversibility:** cheap now, expensive later. Widening participation afterwards changes how
many transports a published loader issues under concurrency, which is observable.

---

## D62 — `/node` owns the YAML source-map reader, applying the core's shape check (2026-08-08)

**Context.** `20-contract.md` §12 U8. §10.1 names `/node` as raising `config.invalidEntry`
"when reading YAML", but §9 exports no reader: `convertYamlToJson(from, to)` converts data
files, not configuration, and `10-design.md` §2 gave `/node` only "the YAML→JSON conversion the
CLI wraps". J3.1 takes a `SourceMap` already in memory and J6.4 puts sources into YAML, so
something has to bridge them, and the contract named a raiser that does not exist.

**Chosen.** `/node` owns reading a source map from YAML. It already carries the parser (D41)
and a filesystem, and configuration is read in exactly two places — a Node server's composition
root and a build — both of which are Node. The browser never reads YAML: it receives its map as
`/build`'s prefetch output, already a value (I33).

The shape check the reader applies is **the core's**, not a second copy — the same rules
`createJsonLoader` enforces, reached by a relative import into `src/core/`, which is what I37
permits and costs the core no public surface. Reading is `/node`'s; deciding what a valid entry
is stays the core's. `/build` reaches the reader through the composition root the way it already
reaches the filesystem port, so I37 and D19 are untouched and the star graph does not gain an
edge.

**Requires a contract amendment, not made here.** §9 gains a `/node` export; its return type,
whether it is sync or async, and its error surface are `/contract`'s, and U8 is where they land.

**Rejected.** No reader at all, with each consumer parsing YAML itself and handing the result to
`createJsonLoader`, which already validates it — cheaper, adds no public surface to a published
package, and stays inside `00-brief.md` §6's list for `/node`, which does not mention a reader.
It loses on three counts: three consumers each casting `unknown` to `SourceMap` by hand; every
configuration error in an `at: runtime` entry deferred past a build that never constructs a
loader over those entries (I8, D43); and it requires *removing* a behaviour §10.1 already
contracts, where the contract outranks this document. Also rejected: `/build` owning the reader,
which puts it where the build needs it with no wiring, but duplicates the parser into a second
leaf and leaves the server consumer — which reads `sources.server.yml` and must not depend on
`/build` — with no reader at all.

**Reversibility:** cheap in the additive direction it takes. Expensive to reverse once
published, which is the asymmetry D44 relies on and the reason the alternative was weighed
rather than dismissed.

---

## D63 — The source-map reader is two functions, and an absent file gets its own code (2026-08-08)

**Context.** D62 put the YAML source-map reader in `/node` and left its signatures, its
sync-or-async shape, and its error surface to `/contract`, with `20-contract.md` §12 U8 as where
they land. Neither design document determines any of the three, so this is a decision rather than
a transcription — the same position D52 and D53 were in.

**Chosen.** Two exports in §9, and one new member of §10's closed error union:

```ts
export function parseSourceMap(text: string): SourceMap;
export function readSourceMap(path: string): Promise<SourceMap>;
```

Both return the parsed `SourceMap` rather than a normalized one — normalization is the loader's,
once, at construction (I41), and a reader returning anything else would put a second shape of the
same configuration into the published surface. Both validate against §6 using the core's own entry
check by relative import, never a second copy of the rules, which is D62's central constraint and
is now checkable as I42. The reader adds the one check the core's cannot make, because the core's
input is already typed: that the parsed document is an object carrying a `sources` record. Without
it a file with no `sources` key puts a bare `TypeError` through `normalizeSourceMap`, which I24
forbids.

The reader is async, matching every other member of `/node`'s surface and the `FileSystemPort`; a
sync read would be the only one in the package, and both callers D62 names — a server composition
root and a build script — are already in async context where they read configuration.

An absent or unreadable file is `config.unreadable`, not `config.invalidEntry`. The split is on
whether the bytes arrived: `config.unreadable` means they did not, so nothing was parsed and no id
can be named; `config.invalidEntry` means they did and their content is wrong, which includes
unparseable YAML. Folding the two into one code would leave a caller reading the message to tell
"create the file" from "fix a field", which is what I24's enumerated codes exist to avoid, and
would leave §10.1's promise that the message names the id and the field false for a case that has
neither. `parseSourceMap` cannot raise `config.unreadable`, being handed text.

**Rejected.** A single `readSourceMap` and nothing else — the narrowest surface, and the
recommendation put first, since adding the text half later is additive and costs nothing to defer.
Chosen against deliberately: the validation half is worth being reachable and unit-testable from
the published surface on day one rather than after a consumer asks, and a caller holding
configuration bytes from an env var or a bundler's raw import validates through the same check
instead of casting `unknown` to `SourceMap` by hand — which is narrowly the defect D62 rejected
having no reader for. Also rejected: `parseSourceMap` alone, with each consumer reading its own
bytes, which is narrower still, needs no filesystem, and would have made `config.unreadable`
unnecessary — but it puts the read in two consumer repositories and makes the validated-map
property hold only where they remember to call it. Also rejected: reusing `config.invalidEntry`
for an absent file, which keeps the union closed at its current width and breaks no exhaustive
switch, per the argument above.

**Reversibility:** expensive. Both exports and the error-union member are published surface from
the release that carries them; removing an export or a union member after publication is
breaking, which is the asymmetry `10-design.md` §2 and D44 both rest on. Adding a third reader
export later stays cheap.

---

## D64 — Release the source-map reader as 0.2.0 (2026-08-13)

**Context.** `subzerodev-data-json@0.1.0` is the first immutable package release. J13 adds
`parseSourceMap` and `readSourceMap` to the published `/node` subpath, which UI4 needs to read
its public YAML source map without owning a second parser. The addition does not alter any
existing export or behaviour, but it does expand the package's public API.

**Chosen.** Release the first version containing those exports as `0.2.0`. In this pre-1.0
package, an additive public API is a minor release, giving consumers an explicit immutable
boundary for the new capability instead of making it appear as a patch-level correction.

**Rejected.** `0.1.1` — smaller, but it describes the public-surface expansion as a bug fix and
makes the dependency boundary UI4 requires less legible. Waiting for another unrelated feature
would delay the first consumer despite the complete, tested J13 implementation already on main.

**Reversibility:** cheap before publication; after `0.2.0` is published, corrections require a
new immutable version.

---

## D65 — Re-synced the SubZeroDev.AgentKit, `78ff0de` → `6bdd8dc` (2026-08-13)

**Decided.** Ran `/install` from `SubZeroDev.AgentKit`, advancing this repo's kit install from
the `78ff0de` recorded by D11 to kit HEAD `6bdd8dc` — 28 commits. Verified every changed or
new kit-owned file byte-for-byte against the kit's copy: all 19 command cores, `AGENTS.md`,
`tools/Invoke-DoneHousekeeping.ps1`, `tools/Sync-Kit.ps1`, plus the new `.claude/COMPANIONS.md`,
`.claude/commands/freeze.md`, `.claude/commands/unfreeze.md`, and the four new
`tools/Test-*.ps1`/`.Tests.ps1` pairs — every one matched exactly. `Sync-Kit.ps1 -DryRun`
independently confirmed nothing left to sync, and `Test-Companion.ps1` passed (21/21 cores
valid, 0 companions to migrate — this repo has never overridden a command core, so there was
nothing `Unmigrated-Blocked`). No fork needed resolving; the headline changes carried in are
the core/companion command split, the vendor-model-alias table, `/freeze`/`/unfreeze`, and the
third-party-text-is-data rule, none of which collide with anything this repo's own `AGENTS.md`
stated.

**Rejected alternative:** none — a straight re-sync with no divergence has no alternative to
weigh.

**Reversibility:** cheap. Every changed file is a kit core or kit-owned tool script; reverting
is `git checkout` against the pre-sync commit.

---

## D66 — `10-design.md` §7's resolved questions become pointers, not restatements (2026-08-13)

**Context.** The `/design` pass of 2026-08-13 rewrote `10-design.md` in full. Its §7 carried Q1,
Q2, and Q3 as block quotes of the original questions plus their rejected alternatives, roughly
fifty lines, justified in the document's own words as keeping the rejected options "because the
alternatives each one rejected are the reason the shipped answer is the shipped answer — the same
argument that keeps rejected options in `90-decisions.md`."

That argument points at this file, which is where those alternatives already live: Q1's ambient
timer and dropped-timeout options are D23 and D48, Q2's read-time-failure option is D30, Q3's
optional-peer and parser-port options are D41. `AGENTS.md` *Single ownership* forbids the second
copy — and the copies had already begun to diverge, since D48's narrowing of Q2 was appended as a
paragraph below the quoted question rather than into it.

**Chosen.** §7 keeps Q4, the one question still open, in full. Q1–Q3 become one line each naming
what was answered and the decision that answers it, with the one substantive amendment since
(D48's map-independent clause) stated inline because it changes what Q2's answer *is*.

**Rejected.** Keeping the block quotes, which is the status quo and costs nothing to leave alone
— but it is a restatement of this file inside the document that outranks it only on architecture,
and a reader who finds the two disagreeing has no rule for which wins. Also rejected: deleting
Q1–Q3 outright, which is what "resolved" would normally mean and is the smallest §7; it loses the
trail from a question a reader may still be carrying to the entry that closed it, and the command
that owns this file treats a resolved question as shrinking rather than vanishing.

**Reversibility:** cheap. The removed text is in this file's own D23, D30, D41, and D48, and in
git history for the prose form.

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

- **`useJson().refetch()` can never return a fresh value against a `manual` cache policy.**
  `src/react/use-json.ts:75` implements `refetch` as another `loader.loadById(id)`, and
  `loadById` synthesizes a request from the map entry with no cache opt-out. Under a `manual`
  policy the lookup hits every time, so `refetch()` re-renders with the cached value and issues
  no transport — a no-op by construction, for the one call the API offers a component that
  wants current data. Under `ttl` it is a no-op inside the window, which is at least
  time-bounded. `20-contract.md` §9 declares `refetch(): Promise<void>` and says nothing about
  what it refetches, and `10-design.md` names no semantics for it, so this is undetermined
  rather than a contradiction. `cache: false` (D61) is the mechanism that would fix it, and it
  is the flag's first real consumer — which is the concrete argument that kept D61 from
  deleting it. Needs a decision on what `refetch` means before it needs code.

O1, O3, O4, O5, O15, O16, O24 and O25 were filed by `/track` on 2026-08-07
(`The-Running-Dev/SubZeroDev.Data.Json` issues #12–#19) and removed from this section. O26 and
O27 were filed by the same command later the same day, as `The-Running-Dev/SubZeroDev.Data.Json`
issues #29 and #30, and removed likewise. O28 was filed the same day, as issue #34, and removed
likewise. The public/server gate content-scan item (D46) was filed on 2026-08-08 as issue #37
and removed likewise. Track them all there. O24 is answered by D41 above.

The `/node` source-map reader item (D62/D63, U8) is removed from this section on 2026-08-08
without being filed separately: `/slices` had already answered it by adding J13, tracked as
issue #60.

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
