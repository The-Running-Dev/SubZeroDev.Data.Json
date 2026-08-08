# Brief — SubZeroDev.Data.Json

## 1. What This Is

A source-agnostic JSON loader for TypeScript, published as `subzerodev-data-json`.

One call site reads a named JSON payload. Where that payload comes from — a bundled
import, a file on disk, an HTTP endpoint — and *when* it is resolved — at build time or
at runtime — are declared in configuration, not at the call site.

The package is **read-only**. It loads, validates, caches, and reports. It does not write.

## 2. Why It Exists

The pattern already exists, five times over, across `Docs-Template` (the base image
`Portfolio` overlays) and `Portfolio/api`. Counted at the point this brief was written:

| Implementation | timeout | abort | retry | cache | validate | unwrap | fallback |
|---|---|---|---|---|---|---|---|
| `src/services/dataLoader.ts` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | store default |
| `src/context/HttpDataProvider.tsx` | ✗ | ✗ | ✗ | ✓ TTL 5 min | ✗ | ✓ | ✗ |
| `src/hooks/useApi.ts` | ✗ | ✓ | ✓ 3×1s | ✗ | ✗ | ✗ | ✗ |
| `src/hooks/useAuthenticatedFetch.ts` | ✗ | ✗ | 401 only | ✗ | ✗ | ✗ | ✗ |
| `api/src/utils/helpers.ts` (`FileUtils`) | — | — | — | ✗ | ✗ | — | ✗ |

Four HTTP paths, no two alike, none carrying more than two of the seven properties. Three
independent cache policies. One validator, applied only to local data — the untrusted
remote payloads are the ones that are never checked. Two verbatim copies of
`getProviderType`. Two near-identical YAML→JSON converters (`Data/build.ts`,
`Portfolio/api/scripts/pre-build.ts`).

JSON is about to be read in more places, not fewer. The cost of the fifth divergent copy
is higher than the cost of one package.

## 3. Consumers

Browser and server are **co-equal**. Neither is the reference implementation.

| Consumer | Role | Reads |
|---|---|---|
| `Docs-Template` / `Portfolio` | Browser, static Docusaurus site | Bundled config, remote portfolio/CV/projects JSON |
| `Portfolio/api` | Node, Express | JSON files on disk, served as REST |
| `Data` | Node, build step | YAML sources it converts and publishes |
| `SubZeroDev.GameEngine` | Node + browser, deterministic | Content packs — **deferred**, see §5 |

The GameEngine is in scope for v1's *design* and out of scope for v1's *adoption*. Its
constraints shape the core (§4); its migration is gated on content packs existing.

## 4. Binding Constraints

**Determinism.** The GameEngine's eslint guard bans `Math.random`, the non-bit-stable
`Math.*` functions, and `Date.now` in `src/`. A package the engine imports must survive
that guard. Therefore the **core has no ambient access to time or randomness** — both are
injected ports, and the same guard runs against this package's own `src/core/`.

**Isomorphism is proven, not asserted.** The core carries no `fs`, no `fetch`, no `window`,
no `process`. Environment reaches it only through ports. A design proven against one
environment first will accrete that environment's assumptions, so the browser and server
migrations land as a single gate (J6+J7).

**Secrets never reach a bundle.** Browser-visible and server-only sources live in separate
configuration files. Only the public file is ever compiled into browser-importable data.

**Nothing is inferred that can be declared.** No response-envelope guessing, no default
`at:`, no provider sniffing that isn't backed by an explicit union underneath.

## 5. Non-Goals

Binding. Out of scope even when it looks like a small addition:

1. **Writing JSON.** No create, update, delete, atomic write, or file locking. The
   read-modify-write races in `Portfolio/api`'s `JsonFileRepository` are real and stay
   that repository's own problem — see `90-decisions.md` D5.
2. **A document store.** No query, filter, sort, or paginate layer. `JsonFileRepository`
   keeps its own.
3. **Non-JSON formats at runtime.** YAML appears only in the build-time CLI, never in the
   runtime loader.
4. **A caching server, CDN, or persistence tier.** Caches are in-process and per-loader.
5. **Auth flows.** No token acquisition, refresh, or session handling. A header may be
   supplied; obtaining its value is the host's job.
6. **Schema authoring.** Validation is a seam. Schemas belong to consumers.
7. **Content-pack resolution.** The GameEngine's `campaignVersion` digest semantics are
   the engine's; this package supplies the digest primitive and nothing above it.

## 6. MVP

`subzerodev-data-json` at 0.1.0, with:

- `src/core` — `load()`, the source union, `JsonResult`, reason codes, ports, cache,
  canonical serialization, digest. Zero dependencies, clock-free, guard-clean.
- `src/node` — file source with mtime-keyed invalidation, the YAML→JSON CLI, a GET-only
  Express mount.
- `src/react` — `useJson`, `JsonBoundary`, optional store binding.
- `src/zod` — `zodValidator`, keeping zod out of the core.
- `src/build` — `at: build` prefetch, `json.lock`, and the public/server separation gate.

Types and invariants are in `20-contract.md`; the ordered work units are in `30-slices.md`.

## 7. Definition of Done

MVP is done when all of the following hold:

1. Every invariant in `20-contract.md` §7 has a test that fails when the invariant is
   removed.
2. The determinism guard runs against `src/core/` in CI and passes.
3. `Docs-Template` and `Portfolio/api` are both migrated, in one gate, and **the migration
   deletes more lines than it adds**. If it does not, the design is wrong and this is where
   that surfaces.
4. All four HTTP paths in §2 are gone, along with both copies of `getProviderType` and both
   YAML→JSON converters.
5. Every remote payload consumed by `Portfolio` passes a declared schema.
6. No entry from `sources.server.yml` appears in any browser-reachable artifact, asserted
   in CI rather than by convention.
7. The package's canonical serializer produces byte-identical output to the GameEngine's
   `src/engine/src/core/persistence/canonical.ts` on that module's existing test vectors.
