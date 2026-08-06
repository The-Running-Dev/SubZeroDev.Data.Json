# Design — SubZeroDev.Data.Json

Architecture and rationale. Exact types live in `20-contract.md`; this file explains why
they have the shape they do. Decisions and their reversal costs are in `90-decisions.md`.

## 1. Shape

One package, subpath exports. React, zod, and zustand are optional peer dependencies, so a
Node consumer that imports only `@subzerodev/data-json` and `/node` pulls in nothing else.

```
@subzerodev/data-json
  .          core     load · sources · result · reasons · cache · canonical · digest
  /node      Node     file source · yaml→json CLI · GET-only express mount
  /react     React    useJson · JsonBoundary · store binding
  /zod       zod      zodValidator
  /build     build    prefetch · json.lock · public/server gate
```

A workspace of separate packages was considered and rejected: four release processes and
cross-package version skew, to solve a dependency problem that optional peer dependencies
and tree-shaking already solve (`90-decisions.md` D2).

## 2. The Layered Core

```
                    ┌─────────────────────────────────────────┐
  call site ───────▶│  load(request) ──▶ JsonResult<T>         │
                    │                                          │
                    │   resolve ─ fetch ─ parse ─ unwrap ─      │
                    │   validate ─ digest ─ cache ─ meta        │
                    └───────┬──────────┬──────────┬────────────┘
                            │          │          │
                       ports: fetch   fs      clock · rng · cache · log
                            │          │
                     browser: global  ✗    Node: undici    fs/promises
```

The pipeline is one path. Every property that today is scattered across four
implementations — timeout, abort, retry, cache, validation, unwrap, fallback — is a stage
in it, and every stage is skippable by declaration rather than by being absent.

**Nothing in the core reaches for its environment.** No `fs`, no `fetch`, no `window`, no
`process`, no `Date.now`, no `Math.random`. Those arrive as ports, which is what makes the
core testable without a network and importable by the GameEngine without tripping its
determinism guard. The same guard runs against this package's `src/core/` in CI, because
a constraint that isn't enforced regresses on the first convenient `Date.now()`.

Two consequences worth stating plainly, since they look like limitations and are not:

- **TTL caching requires a `clock` port.** Declaring `ttlMs` without supplying one is a
  construction-time error, not a silent fallback to no-cache. A cache that quietly stops
  caching is worse than one that refuses to be built.
- **Retry backoff has no jitter** unless an `rng` port is supplied. Fixed and exponential
  backoff are pure functions of the attempt number.

## 3. Sources

The declared form is a discriminated union — `http`, `file`, `inline`.

A bare string is sugar over it: `https://…` resolves to `http`, anything else to `file`.
The sugar exists because the existing configuration is written that way and the migration
should not require rewriting every entry. But the union is the real thing, and the sugar
is a normalizer that runs once at construction, not a branch evaluated at every read. The
current code has the branch inline in two verbatim copies:

```ts
function getProviderType(source: string): 'json' | 'http' {
  if (source?.startsWith('http://') || source?.startsWith('https://')) return 'http';
  return 'json';
}
```

`inline` is the honest name for what that function's `'json'` branch actually does today —
it does not read the configured path; it hands back data that was `import`ed at build time
and ignores the path entirely. Naming it `inline` makes the difference between "bundled
payload" and "file on disk" expressible, which it currently is not.

## 4. `at:` — Build or Runtime

Every source declares `at: build` or `at: runtime`. There is no default; an entry missing
`at:` is a configuration error.

| | `at: build` | `at: runtime` |
|---|---|---|
| Browser | Resolved during the build, written to `data/`, shipped in the static HTML | Fetched on mount |
| Server | Resolved into the image or artifact | Fetched per request, or preloaded at boot |
| Failure surfaces | At build | At read |
| Content updates | Need a rebuild | Live |

**The call site is identical under either value.** `useJson('projects')` does not know or
care. That is the whole reason `at:` is a property of the *source* and not an argument to
the read: it can be changed for a payload without touching any code that consumes it.

`at: build` writes an entry to `json.lock` recording the URL, the byte count, and a digest
over canonical bytes. This is the piece the GameEngine needs and the reason it was worth
designing for now rather than later: two builds that resolved different remote bytes are
different builds, and today nothing in the pipeline can say so. It is the same
digest-of-resolution idea as the engine's `campaignVersion`, one layer down.

**A third value was considered and rejected.** Servers want fail-fast-at-boot, which looks
like `at: start`. But that is a composition-root concern, not a property of the payload —
`await loader.preload(['projects', 'cv'])` in the server's startup gives the same guarantee
with no environment-specific config axis, and keeps `at:` meaning the same thing on both
sides (`90-decisions.md` D7).

## 5. Caching

Three policies, chosen per source, never inferred:

| Policy | Where | Invalidation |
|---|---|---|
| `manual` (default) | Everywhere | `invalidate(id)` only |
| `{ ttlMs }` | Anywhere with a `clock` port | Elapsed time |
| `{ mtime: true }` | `file` sources only | `stat()` — `(path, mtimeMs, size)` |

`mtime` is the interesting one, and it exists because the server is a co-equal consumer.
It is exact rather than approximate: never stale, never a needless re-read. The browser
cannot do it; the current TTL-everywhere design was written for a browser and inherited by
nothing else because nothing else used it.

It also retires a moving part. `Docs-Template` runs an external `chokidar` watch to re-run
pre-build when a config file is edited. The filesystem port's optional `watch` capability
does that in-process, tied to the same cache that would otherwise go stale.

Today there are three cache implementations with three unrelated policies, one of which
(`getData`) uses `JSON.stringify(rawData)` as its cache key — it stringifies the entire
payload in order to look up a cache whose purpose is to avoid work. That one is not ported.

## 6. Errors: A Result, Not A Throw

`load()` never throws. Every outcome is a `JsonResult`, and every failure carries a reason
code from a closed vocabulary — `json.transport`, `json.status`, `json.timeout`,
`json.parse`, `json.schema`, `json.notFound`, `json.unresolved`.

This replaces three conventions coexisting in one codebase today: throw
(`JsonFileRepository`), write to a store and continue (`DataLoader`), and `console.warn`
then silently substitute defaults (`DataProvider`). A consumer currently cannot distinguish
"the Data site is unreachable" from "the payload changed shape", because both arrive as an
`Error` with a formatted string. Those two want different handling — the first falls back
quietly, the second should be loud — and a closed vocabulary is what makes that
expressible.

When `fallback` is supplied, `data` is populated on failure as well as success. The
distinction between "worked" and "degraded" lives in `ok` and `reason`, not in whether the
caller got something usable.

## 7. Validation

Validation is a seam: a function from `unknown` to a tagged result. The core takes no
schema-library dependency; `/zod` supplies an adapter.

The gap this closes is specific. Zod is already a dependency of `Portfolio` and is used to
validate exactly one payload — `gitHub.json`, which is local, generated by the repository's
own build, and the least likely thing to be malformed. The remote payloads fetched from a
Pages site over the network are typed `any` all the way into the UI. The untrusted input is
the unchecked one.

## 8. The Envelope, From Both Ends

`Portfolio/api` serves `{ success, data }`. The browser guesses at it:

```ts
if (jsonData.success && jsonData.data) return jsonData.data;
```

A payload that legitimately carries a `success` field gets silently unwrapped into
something else. The heuristic exists because the producer and the consumer were written
separately, with no shared type between them.

One package on both ends makes it declared instead. `/node` exports the envelope type and
a helper to produce it; a consumer sets `unwrap: 'subzerodev'` to strip it. Absent an
explicit `unwrap`, nothing is stripped. The guess is not preserved behind a flag — it is
deleted.

## 9. Configuration, And Why It Is Two Files

```
config/sources.public.yml     compiled into browser-importable data
config/sources.server.yml     never compiled into anything a browser can reach
```

The risk being designed against is concrete. `Docs-Template`'s `config/globalConfig.yml` is
compiled by pre-build into `data/globalConfig.json`, which is `import`ed into the client
bundle. Add `headers: { Authorization: … }` to a source in that file and the credential
ships to every visitor, with nothing in the pipeline objecting.

Two files rather than one file with a `scope:` field, because a credential then leaks only
by being written into the wrong file — visible in review, greppable in CI — rather than by
a field being forgotten (`90-decisions.md` D6). `/build` reads exactly one file per target
and CI asserts that nothing from the server file reaches `data/` or a bundle.

This also retires an existing overload. Today the source lookup is keyed through
`FeatureToConfigMap`, so one identifier addresses two namespaces: `featuresConfig.projectsPage`
is a boolean under `features:`, while `globalConfig.projectsPage.source` is a top-level
block. It works only because the names coincide. A source that is not a feature flag, or
two sources for one feature, cannot be expressed. A `sources:` map keyed by id removes the
coupling; feature gating stays a separate concern that composes with it.

## 10. React

`/react` is a thin binding, not a second implementation. `useJson(id)` returns the same
`JsonResult` the core returns, plus a `loading` flag and a `refetch`. `JsonBoundary`
handles the loading and error rendering that is currently repeated per call site.

`DataProvider` in `Docs-Template` survives the migration as a composition — feature gate
composed with `useJson` — rather than as a component that also knows how to pick a
provider, fetch, cache, and unwrap.

## 11. Canonical Serialization And Digest

A digest must be computed over canonical bytes. `JSON.stringify` of a parsed object is not
stable — key insertion order changes the output — so a digest built on it would report two
identical payloads as different.

The GameEngine already owns exactly this, in `src/engine/src/core/persistence/canonical.ts`.
This package carries its own copy, verified byte-identical against that module's existing
test vectors. The duplication is deliberate and time-boxed: the engine deletes its copy and
imports this one at J9, when it adopts the package. Moving engine code into a new package
before that package has a single consumer is the expensive-to-reverse direction
(`90-decisions.md` D9). Until J9 this is a known-and-retained duplication with a
cross-check test, not an unnoticed one.

## 12. Distribution

Published to npm as `@subzerodev/data-json`, following the route already established by
`subzerodev-platform-ui-landing-page`. Consumers take a normal version range; no
submodules, no vendoring.
