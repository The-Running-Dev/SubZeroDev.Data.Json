# SubZeroDev.Data.Json

A source-agnostic JSON loader for TypeScript, published as `@subzerodev/data-json`.

One call site reads a named JSON payload. Where it comes from — a bundled import, a file on
disk, an HTTP endpoint — and *when* it resolves — at build time or at runtime — are
declared in configuration, not at the call site.

Browser and server are co-equal consumers. The package is **read-only**.

```
@subzerodev/data-json
  .          core     load · sources · result · reasons · cache · canonical · digest
  /node      Node     file source (mtime-cached) · yaml→json CLI · GET-only express mount
  /react     React    useJson · JsonBoundary
  /zod       zod      zodValidator
  /build     build    prefetch · json.lock · public/server gate
```

## Status

**Design only. No code yet.**

## The specs

Read in order.

| File | Owns |
|---|---|
| [`design/00-brief.md`](design/00-brief.md) | What this is, why it exists, consumers, binding constraints, non-goals, MVP, definition of done |
| [`design/10-design.md`](design/10-design.md) | Architecture with rationale — the layered core, sources, `at:`, caching, errors, validation, config split, digest |
| [`design/20-contract.md`](design/20-contract.md) | Exact types, configuration and lockfile shapes, subpath exports, and the thirteen invariants |
| [`design/30-slices.md`](design/30-slices.md) | Ordered work units J1–J9 with acceptance criteria |
| [`design/90-decisions.md`](design/90-decisions.md) | Ten decisions with rationale and reversal cost; deferred items; open register |

## In one paragraph

The pattern already exists five times across `Docs-Template`, `Portfolio/api`, and `Data` —
four HTTP paths with no two alike, three unrelated cache policies, one validator applied
only to the local data that needs it least, and two verbatim copies of the same
provider-selection function. JSON is about to be read in more places, not fewer. This
package is one implementation of the pipeline every one of those was reaching for, with the
environment behind ports so the same core runs in a browser, in Express, and eventually
inside a deterministic game engine that bans `Date.now`.
