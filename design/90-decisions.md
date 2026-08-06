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

## Deferred

| | Item | Gated on |
|---|---|---|
| **F1** | GameEngine adoption (J9) | Content packs existing and needing JSON loading |
| **F2** | Write support in `/node` | A second consumer needing it; D5 is not a permanent judgement |
| **F3** | Environment-only credential resolution | A source that actually needs a credential; D6 alternative three |
| **F4** | `SubZeroDev.Data.Yaml` or `.Sql` siblings | A consumer. The namespace exists for them; nothing is designed |
| **F5** | Streaming and large-payload handling | A payload large enough to matter. Everything here assumes a payload that fits in memory |

## Open register

Items to revisit, in the shape `/track` can turn into issues.

| | Question |
|---|---|
| **O1** | `useAuthenticatedFetch` owns 401-refresh, which `00-brief.md` §5.5 puts out of scope. J6.2 allows retaining it, but a second consumer needing authed loads makes "auth is the host's job" worth re-examining. |
| **O2** | The `inline` source kind exists because bundlers `import` JSON at build. If `at: build` covers every real case after J6, `inline` may be redundant and removable before 1.0. |
| **O3** | `stats()` returns hits and misses but nothing about eviction or size pressure. Adequate until a consumer caches enough to care. |
| **O4** | Cross-checking the canonical serializer against the engine (I13) is a manual CI wiring problem across two repositories. It has no automation and will rot silently if J9 is far out. |
