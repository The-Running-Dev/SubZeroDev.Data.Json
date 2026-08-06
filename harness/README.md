# Red-team harness

An executable copy of the red-team findings against `design/00-brief.md` and
`design/10-design.md`. Each finding is a probe that either reproduces or does not.

```bash
node harness/run.mjs
```

```bash
node harness/sample-app.mjs
```

No install, no network, no toolchain, no clock. Node 25 was used; anything with ESM and
`Array.prototype.at` will do.

## What this is not

**It is not the package, and it is not J1.** It is a measuring instrument that happens to
be made of the same material as the thing it measures. Nothing here should be moved into
`src/` when that directory exists — it was written to a contract with known holes, and it
implements several of them on purpose.

It sets no toolchain policy. There is no `package.json`, no TypeScript config, no test
runner and no dependency, because choosing any of those is a real decision that belongs to
a slice and to the person who owns the repository. Plain ESM was the option that decides
nothing.

## Layout

| File | What it is |
|---|---|
| `core.mjs` | `createJsonLoader` and the §3.1 pipeline, implemented from the documents as they stand |
| `canonical.mjs` | Canonical serializer and a pure-JS SHA-256, with published test vectors |
| `fakes.mjs` | Fake fetch, filesystem, clock, rng, scheduler, log. The only file allowed an ambient call |
| `probes.mjs` | One probe per finding |
| `run.mjs` | Runner |
| `sample-app.mjs` | The build-then-runtime walkthrough behind F1 |

## The rule this harness runs on

`core.mjs` implements the design **as written**, including where that is obviously wrong.
Where the documents are silent it takes the most charitable reading available and marks the
spot `// AMBIGUOUS:`. A corrected harness would prove nothing about the design it was built
to test, so corrections belong in `design/`, not here.

Two things the harness had to invent, because the contract has no member for them, and both
are findings in their own right:

- **A scheduling port** (`ports.schedule`). `timeoutMs` and `retry.delayMs` cannot be
  expressed without one. This is `10-design.md` §7 Q1, unresolved.
- **A hash function with no port and no ambient call.** `20-contract.md` declares a
  `sha256-<hex>` digest and no way to compute it: `node:crypto` is a module the core may not
  import under I1, and `globalThis.crypto.subtle` is both ambient and async. A pure-JS
  implementation is the only option the contract leaves open. `canonical.mjs` is roughly 90
  lines of what that costs, and it is 90 lines the design never mentions.

## Reading a probe

`observed: true` means the finding reproduced. `observed: false` means it did not, and the
finding is weakened or wrong — that outcome is as useful as the other one and the runner
prints it separately. `observed: null` means the harness cannot settle it, which is its own
answer: F10 is `null` because the repository it depends on is not in this tree.
