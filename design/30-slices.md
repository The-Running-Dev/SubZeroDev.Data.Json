# Slices — SubZeroDev.Data.Json

Ordered work units. `J` is this repository's slice prefix (`90-decisions.md` D10).

Per-criterion ids (`J1.1`, `J1.2`) are stable: never reused, never renumbered.

**J1–J5 build it. J6+J7 prove it. J8–J9 are adoption.**

---

## J1 — Core

The loader, its ports, and the guard that keeps it honest. No environment, no dependencies.

**Contract:** `20-contract.md` §1–§5, §8 I1–I6, I10–I13
**Depends on:** nothing

### Done when

- [ ] **J1.1** `load()` implements the full pipeline: resolve → fetch → parse → unwrap → validate → digest → cache → meta, each stage skippable by declaration.
- [ ] **J1.2** `JsonResult`, `ReasonCode`, and `JsonMeta` match §1 exactly. `load()` never throws (I2).
- [ ] **J1.3** All six ports are honoured, and all six are optional (§4).
- [ ] **J1.4** `createJsonLoader` throws for `ttl` without `clock` and `jitter` without `rng` (I6).
- [ ] **J1.5** Canonical serialization and `sha256` digest, byte-identical to the GameEngine's vectors (I5, I13).
- [ ] **J1.6** Three cache policies — `manual`, `ttl`, `mtime` — with frozen entries (I12).
- [ ] **J1.7** Retry with fixed and exponential backoff; jitter only via `rng`.
- [ ] **J1.8** The determinism guard, copied from `src/engine/eslint.config.js`, runs against `src/core/` in CI and passes (I1).
- [ ] **J1.9** Every invariant in §8 that applies to the core has a test that fails when the invariant is removed.

---

## J2 — Node

**Contract:** `20-contract.md` §9 (`/node`)
**Depends on:** J1

### Done when

- [ ] **J2.1** `nodeFileSystem()` supplies `read`, `stat`, and `watch`.
- [ ] **J2.2** `mtime` cache policy invalidates on `(path, mtimeMs, size)` and never returns a stale read.
- [ ] **J2.3** `convertYamlToJson` reproduces the behaviour of both existing converters, recursive directories included, exposed as a CLI.
- [ ] **J2.4** `jsonRouter` mounts GET routes only; no write verb is reachable.
- [ ] **J2.5** `envelope()` produces the shape `unwrap: 'subzerodev'` consumes — verified by a round-trip test, which is the point of owning both ends.
- [ ] **J2.6** `preload()` rejects on any failure and resolves otherwise.

---

## J3 — Build

**Contract:** `20-contract.md` §6, §7, §8 I7–I9
**Depends on:** J2

### Done when

- [ ] **J3.1** `prefetch` resolves every `at: build` source, writes it to `outDir`, and returns a `JsonLock`.
- [ ] **J3.2** The lockfile matches §7. `resolvedAt` is written and read by nothing (I8 depends on this).
- [ ] **J3.3** Two builds over unchanged remote bytes produce identical digests; changed bytes produce a changed digest.
- [ ] **J3.4** `assertNoServerSourcesInBundle` fails the build when any `sources.server.yml` entry reaches the public output (I7).
- [ ] **J3.5** A source missing `at:` is a configuration error naming the offending id.
- [ ] **J3.6** `at: build` is never fetched at runtime and `at: runtime` never resolved at build (I8).

---

## J4 — React

**Contract:** `20-contract.md` §9 (`/react`)
**Depends on:** J1

### Done when

- [ ] **J4.1** `useJson(id)` returns the core's `JsonResult` plus `loading` and `refetch` — not a reshaped parallel type.
- [ ] **J4.2** `JsonBoundary` renders loading and error states from `reason`, not from message strings.
- [ ] **J4.3** No `Date.now` or `Math.random` in a render path or a hook dependency array — the existing `HttpDataProvider` calls `Date.now()` inside a `useMemo` dependency and that is not reproduced.
- [ ] **J4.4** Unmounting aborts an in-flight request; no state update after unmount.
- [ ] **J4.5** The same call site compiles and behaves identically under either `at:` value (I9).

---

## J5 — Zod

**Contract:** `20-contract.md` §9 (`/zod`)
**Depends on:** J1

### Done when

- [ ] **J5.1** `zodValidator(schema)` returns a `Validator<T>`; a failure yields `reason: 'json.schema'` with the zod message in `message`.
- [ ] **J5.2** zod is a peer dependency. A consumer importing only the core or `/node` does not resolve it.

---

## J6+J7 — Migrate Docs-Template and Portfolio/api

**One gate, both consumers.** Landing the browser first lets the core accrete browser
assumptions, and the isomorphism claim then becomes retroactive (`10-design.md` §2).

**Contract:** all of `20-contract.md`
**Depends on:** J2, J3, J4, J5

### Done when

- [ ] **J6.1** These are deleted: `src/services/dataLoader.ts`, `src/context/HttpDataProvider.tsx`, `src/hooks/useApi.ts`, both copies of `getProviderType`, and the `getData` content-keyed cache.
- [ ] **J6.2** `useAuthenticatedFetch` either composes with the loader or is retained deliberately, with its retention recorded — it owns 401-refresh, which is out of scope here (`00-brief.md` §5.5).
- [ ] **J6.3** `DataProvider` survives as feature-gate composed with `useJson`, not as a component that also picks a provider, fetches, caches, and unwraps.
- [ ] **J6.4** `projectsPage.source`, `portfolioPage.source`, and `cvPage.source` move to `config/sources.public.yml`; the `FeatureToConfigMap` source lookup is gone.
- [ ] **J6.5** Every remote payload has a declared schema and passes it.
- [ ] **J6.6** Every existing HTTP source has an explicit `at:` — a migration decision per source, not a default.
- [ ] **J6.7** The `{ success, data }` heuristic is gone; call sites that need it declare `unwrap: 'subzerodev'`.
- [ ] **J7.1** `FileUtils.readJsonFile` and `fileExists` are replaced by the loader. `JsonFileRepository` keeps its filter, sort, paginate, and write logic.
- [ ] **J7.2** Per-request full-file reads are replaced by `mtime`-cached reads.
- [ ] **J7.3** `JsonFileRepository`'s lost-update race and mid-write truncation are **recorded in that repository** as known-and-retained, with the reasoning. They are out of scope here (`90-decisions.md` D5) and must not simply disappear from the record.
- [ ] **J7.4** Both YAML→JSON converters are replaced by the J2 CLI.
- [ ] **J7.5** **The migration deletes more lines than it adds.** If it does not, stop: the design is wrong and this is where that surfaces (`00-brief.md` §7.3).

---

## J8 — Data repository adopts the CLI

**Depends on:** J2

### Done when

- [ ] **J8.1** `Data/build.ts` uses the published CLI; its bespoke `processYamlToJson` is deleted.
- [ ] **J8.2** Published artifact bytes are unchanged from before the migration — asserted, not assumed.

---

## J9 — GameEngine adoption *(deferred)*

**Gated on content packs existing.** v1 makes this possible; it does not schedule it.
Nothing in J1–J8 may depend on J9.

**Depends on:** J1, and a GameEngine consumer that actually loads JSON

### Done when

- [ ] **J9.1** The engine imports the package's canonical serializer and deletes `src/engine/src/core/persistence/canonical.ts`, retiring the I13 duplication.
- [ ] **J9.2** The engine's determinism harness passes with the package in the graph.
- [ ] **J9.3** `json.lock` digests feed content-pack identity. The engine owns `campaignVersion` semantics; this package supplies the digest primitive and nothing above it (`00-brief.md` §5.7).
