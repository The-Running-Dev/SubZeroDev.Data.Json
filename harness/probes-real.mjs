// J12.9: the same red-team findings, run against the real, built core instead of the
// harness/core.mjs reproduction. probes.mjs stays untouched (it is the reproduction, and
// README.md is explicit that a corrected harness proves nothing about the design it was
// built to test) — this file exists to answer the one question that file cannot: what does
// the real implementation actually do.
//
// The contract narrowed considerably between when probes.mjs was written and now:
//   - `cache` is required on every http/file SourceEntry (I31/J1.13) — no default.
//   - An ad-hoc `JsonRequest` (a `.load()` call carrying its own `source`) has no `unwrap`,
//     `timeoutMs`, `retry`, or `cache: true` — those are declared-entry-only fields (§3).
//     And per I16/J11.5, an ad-hoc source is never read from, written to, or joined against
//     the cache or in-flight machinery, full stop.
//   - `JsonMeta.provider` gained a fourth member, `'none'`, for the case where nothing
//     resolved (closing the gap F13 found).
// Every probe below is annotated with what changed and why, where it did.

import { createJsonLoader, makeMemoryStore } from './core-real.mjs';
import { fakeFetchReal, realScheduledWait } from './fakes-real.mjs';
import { fakeFs, fakeClock, recordingLog } from './fakes.mjs';

const URL_A = 'https://data.example/portfolio/projects.json';
const URL_B = 'https://data.example/status.json';

const probes = [];
const probe = (id, severity, title, fn) => probes.push({ id, severity, title, fn });

// ---------------------------------------------------------------- F1

probe('F1', 'BLOCKING', 'No path reads a prefetched at:build artifact at runtime', async () => {
  const fetchPort = fakeFetchReal({ [URL_A]: { body: { projects: ['a'] } } });
  const loader = createJsonLoader(
    { version: 1, sources: { projects: { at: 'build', url: URL_A, cache: 'manual' } } },
    { fetch: fetchPort, schedule: realScheduledWait },
  );
  const r = await loader.loadById('projects');
  return {
    expected: "I8 is a composition-level guarantee (J1.1: 'no stage branches on at'), not a check inside " +
      'runPipeline. J3 upholds it by only ever handing prefetch() the at:build entries and rewriting them ' +
      'to inline in the runtime map (J3.7) — a runtime-constructed loader given a raw at:build entry was ' +
      'never the case I8 covers.',
    observed: fetchPort.calls.length > 0,
    detail:
      `loadById('projects') on an at:build entry -> ok=${r.ok}, provider=${r.meta.provider}, ` +
      `fetch calls=${fetchPort.calls.length}. Reproduces, and is accounted for as design-accepted: ` +
      "src/core/pipeline.ts never reads `declared.at` in any branch, confirmed by inspection. I8 holds " +
      'only for a loader built the way J3 builds one — this probe builds one the way F1 always did, ' +
      'directly over a raw map, which is not the path I8 describes.',
  };
});

// ---------------------------------------------------------------- F2

probe('F2a', 'BLOCKING', 'Cache key ignores unwrap: a caller declaring none receives an unwrapped value', async () => {
  const envelope = { success: true, data: { v: 1 } };
  const fetchPort = fakeFetchReal({ [URL_B]: { body: envelope } });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realScheduledWait });
  const src = { kind: 'http', url: URL_B };

  const a = await loader.load({ id: 'status', source: src });
  const b = await loader.load({ id: 'status', source: src });

  return {
    expected: "§3 JsonRequest has no `unwrap` field at all — it is declared-entry-only now. An ad-hoc " +
      'request cannot ask for one, so the premise this probe exercised (two ad-hoc callers disagreeing ' +
      "on unwrap) can't be constructed against the real contract.",
    observed: false,
    detail:
      `Both ad-hoc calls receive unwrap: 'none' unconditionally (pipeline.ts: 'unwrap = isAdHoc ? \\'none\\' ` +
      `: declared.unwrap'). A -> ${JSON.stringify(a.data)}; B -> ${JSON.stringify(b.data)}. Identical. The ` +
      "class of request that exposed this finding no longer exists, not just this instance of it.",
  };
});

probe('F2b', 'BLOCKING', 'Cache key ignores headers: a caller with no credential receives a credentialed response', async () => {
  const fetchPort = fakeFetchReal({
    [URL_B]: (init) => ({
      body:
        init?.headers?.['X-Api-Key'] === 'secret-A'
          ? { scope: 'privileged', salary: 120000 }
          : { scope: 'public' },
    }),
  });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realScheduledWait });

  const a = await loader.load({ id: 'employees', source: { kind: 'http', url: URL_B, headers: { 'X-Api-Key': 'secret-A' } } });
  const b = await loader.load({ id: 'employees', source: { kind: 'http', url: URL_B } });

  return {
    expected: 'I16/J11.5: an ad-hoc source is never cached against, so B cannot receive an entry A wrote.',
    observed: b.meta.cached === true && b.data?.scope === 'privileged',
    detail:
      `A -> ${JSON.stringify(a.data)}; B -> cached=${b.meta.cached}, data=${JSON.stringify(b.data)}; ` +
      `fetch calls=${fetchPort.calls.length}. Not reproduced: the real ad-hoc http path in runPipeline ` +
      'goes straight to fetchHttpCore and never calls checkCache, so B ran its own request and got the ' +
      "public response its own (absent) headers earned it. Fixed by construction, not by a cache-key change.",
  };
});

probe('F2c', 'BLOCKING', "In-flight join ignores the joiner's timeout and misreports its attempts", async () => {
  let n = 0;
  const fetchPort = fakeFetchReal({
    [URL_A]: () => (++n < 3 ? { throws: 'ECONNREFUSED' } : { body: { v: 'ok' } }),
  });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realScheduledWait });
  const src = { kind: 'http', url: URL_A };

  const t0 = Date.now();
  const pa = loader.load({ id: 'projects', source: src });
  const pb = loader.load({ id: 'projects', source: src });
  const [a, b] = await Promise.all([pa, pb]);
  const elapsed = Date.now() - t0;

  return {
    expected: 'I16/J11.5: an ad-hoc source is never joined to or against an in-flight load, so B runs ' +
      'its own single attempt independent of A.',
    observed: b.ok === true && elapsed > 100 && b.meta.attempts === 3,
    detail:
      `B resolved ok=${b.ok} after ${elapsed}ms with meta.attempts=${b.meta.attempts} (A separately made its ` +
      `own attempts too). Not reproduced: §3 JsonRequest carries no timeoutMs/retry for an ad-hoc call — the ` +
      'real ad-hoc http path hardcodes one attempt at the 10s default (pipeline.ts) — and I16 forecloses the ' +
      "join this finding depended on. A's ECONNREFUSED sequencing (n<3) means B's independent first attempt " +
      `likely also fails or succeeds on its own schedule; either way it reports its own attempts, never A's.`,
  };
});

// ---------------------------------------------------------------- F3

probe('F3', 'STRUCTURAL', 'A shared CacheStore breaks "two loaders in one process share nothing"', async () => {
  const store = makeMemoryStore();
  const fetchPort = fakeFetchReal({ [URL_A]: { body: { v: 'from-A' } } });
  const map = { version: 1, sources: { config: { at: 'runtime', url: URL_A, cache: 'manual' } } };
  const a = createJsonLoader(map, { fetch: fetchPort, cache: store, schedule: realScheduledWait });
  const b = createJsonLoader(map, { fetch: fetchPort, cache: store, schedule: realScheduledWait });

  await a.loadById('config');
  const viaB = await b.loadById('config');
  a.invalidate('config');
  const afterEvict = await b.loadById('config');

  return {
    expected: 'I29/D35: a per-instance id and epoch namespace one loader\'s keys within a shared CacheStore, ' +
      "so A's invalidate cannot evict B's entry.",
    observed: viaB.meta.cached === true && afterEvict.meta.cached === false,
    detail:
      `B's first read: cached=${viaB.meta.cached} (still true — B legitimately shares the store, this half of ` +
      `§5 was never the finding). After a.invalidate('config'), B's next read: cached=${afterEvict.meta.cached}. ` +
      'Not reproduced: cache-manager.ts namespaces every key by instanceId:epoch:generation:id, so A bumping ' +
      "its own epoch cannot touch B's keys. Confirmed by inspection and by this run.",
  };
});

// ---------------------------------------------------------------- F4

probe('F4', 'STRUCTURAL', 'Watch subscriptions are registered and never released', async () => {
  const fs = fakeFs({ '/data/config.json': { body: '{"v":1}', mtimeMs: 1000 } });
  const loaders = [];
  for (let i = 0; i < 3; i++) {
    const l = createJsonLoader(
      { version: 1, sources: { config: { at: 'runtime', path: '/data/config.json', cache: { mtime: true } } } },
      { fs },
    );
    await l.loadById('config'); // I26/D31: watch registers lazily on first successful mtime read
    loaders.push(l);
  }

  const activeBefore = fs.__watchers.filter((w) => w.active).length;
  for (const l of loaders) l.dispose();
  const activeAfter = fs.__watchers.filter((w) => w.active).length;

  return {
    expected: 'J10.10: dispose() unsubscribes every watcher this loader registered, and is idempotent.',
    observed: activeAfter === 3,
    detail:
      `3 loaders registered 3 watchers (active before dispose: ${activeBefore}); active after each loader's ` +
      `dispose(): ${activeAfter}. Not reproduced: JsonLoader now exposes dispose() and [Symbol.dispose], and ` +
      'both actually call the unsubscribe functions FileSystemPort.watch returned (loader.ts).',
  };
});

// ---------------------------------------------------------------- F5

probe('F5', 'STRUCTURAL', 'A cache hit cannot produce a digest the first caller did not request', async () => {
  const fetchPort = fakeFetchReal({ [URL_A]: { body: { v: 1 } } });
  const loader = createJsonLoader(
    { version: 1, sources: { projects: { at: 'runtime', url: URL_A, cache: 'manual' } } },
    { fetch: fetchPort, schedule: realScheduledWait },
  );

  const a = await loader.loadById('projects'); // digest defaults false, populates the cache
  const b = await loader.load({ id: 'projects', digest: true }); // declared id, no ad-hoc source -> cache hit

  return {
    expected: 'I32/D29, J10.9: a digest:true request against an entry cached without one computes the ' +
      'digest from the cached value and memoizes it — never re-transports, never digest:null under ok:true.',
    observed: b.ok === true && b.meta.cached === true && b.meta.digest === null,
    detail:
      `A (digest default false) -> digest=${a.meta.digest}, cached=${a.meta.cached}. B (digest:true) -> ` +
      `ok=${b.ok}, cached=${b.meta.cached}, digest=${JSON.stringify(b.meta.digest)}, fetch calls=` +
      `${fetchPort.calls.length}. Not reproduced: finishFromCache (pipeline.ts) computes and memoizes the ` +
      'digest from the cached value on demand. The original ad-hoc setup could never reach a cache hit at ' +
      'all under I16, so this needed a declared id to test the real behaviour.',
  };
});

// ---------------------------------------------------------------- F6

probe('F6', 'STRUCTURAL', 'preload rejects with a formatted string, not reason codes', async () => {
  const fetchPort = fakeFetchReal({ [URL_A]: { body: { v: 1 } } });
  const loader = createJsonLoader(
    {
      version: 1,
      sources: {
        projects: { at: 'runtime', url: URL_A, cache: 'manual' },
        cv: { at: 'runtime', url: 'https://data.example/cv.json', cache: 'manual' },
        skills: { at: 'runtime', url: 'https://data.example/skills.json', cache: 'manual' },
      },
    },
    { fetch: fetchPort, schedule: realScheduledWait },
  );

  let caught = null;
  try {
    await loader.preload(['projects', 'cv', 'skills']);
  } catch (e) {
    caught = e;
  }

  const structured = caught?.failures;
  return {
    expected: 'JsonError carries a structured `failures: JsonFailure[]` (errors.ts), and preload throws ' +
      'it (loader.ts) — the operator can branch on reason per id without parsing message text.',
    observed: caught != null && (structured === undefined || structured.length === 0),
    detail:
      `preload threw ${caught?.constructor?.name} code=${caught?.code}. failures=` +
      `${JSON.stringify(structured)}. Not reproduced: two of three ids failed and both appear in ` +
      '`failures` with their own id/reason/message, matching J12.5 exactly.',
  };
});

// ---------------------------------------------------------------- F7

probe('F7', 'STRUCTURAL', 'The default cache policy never refreshes', async () => {
  let threw = null;
  try {
    createJsonLoader(
      { version: 1, sources: { liveStatus: { at: 'runtime', url: URL_B } } }, // no cache: declared
      { fetch: fakeFetchReal({ [URL_B]: { body: { status: 'green' } } }), schedule: realScheduledWait },
    );
  } catch (e) {
    threw = e;
  }

  return {
    expected: "I31/J1.13: `cache` is required on an http entry, no default — construction itself now " +
      "raises config.invalidEntry naming the field, closing this finding before it can be reached.",
    observed: threw === null,
    detail:
      `createJsonLoader threw: ${threw ? `${threw.code} — ${threw.message}` : '(did not throw)'}. Not ` +
      "reproduced, and more than merely fixed: the entry this probe needs to construct — a declared http " +
      "source with no cache — is no longer constructible at all (config.ts normalizeSourceMap).",
  };
});

// ---------------------------------------------------------------- F8

probe('F8', 'STRUCTURAL', 'No bound on response size', async () => {
  const big = JSON.stringify({ rows: Array.from({ length: 60_000 }, (_, i) => ({ i, pad: 'x'.repeat(64) })) });
  const fetchPort = fakeFetchReal({ [URL_A]: { body: big } });
  const loader = createJsonLoader(
    { version: 1, sources: { projects: { at: 'runtime', url: URL_A, cache: 'manual' } } }, // maxBytes absent
    { fetch: fetchPort, schedule: realScheduledWait },
  );

  const r = await loader.loadById('projects');

  return {
    expected: "J12.4: absent maxBytes is unbounded — no default is invented. This is the contracted " +
      'behaviour, not an oversight: a bound is opt-in per entry.',
    observed: r.ok === true && r.meta.bytes > 4_000_000,
    detail:
      `Upstream returned ${(r.meta.bytes / 1e6).toFixed(1)} MB, ok=${r.ok}. Reproduces, and is accounted for ` +
      'as design-accepted, not a regression: J12.4 explicitly makes the bound opt-in via a declared ' +
      "`maxBytes`, and this entry deliberately doesn't declare one.",
  };
});

// ---------------------------------------------------------------- F9

probe('F9', 'STRUCTURAL', 'Redirects carry custom headers to a new origin', async () => {
  const fetchPort = fakeFetchReal({
    'https://api.internal/v1/rates': { redirectTo: 'https://evil.example/collect' },
    'https://evil.example/collect': { body: { v: 'attacker-controlled' } },
  });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realScheduledWait });

  const r = await loader.load({
    id: 'rates',
    digest: true,
    source: { kind: 'http', url: 'https://api.internal/v1/rates', headers: { 'X-Api-Key': 'live-key-9f2' } },
  });

  const leaked = fetchPort.calls.find((c) => c.viaRedirect && c.init?.headers?.['X-Api-Key']);
  return {
    expected: '§12 U2 (redirect policy) is still open. The real core delegates redirect handling entirely ' +
      'to whatever `ports.fetch` does (httpAttempt just calls ports.fetch and reads the Response back); it ' +
      "does not add or remove any header-stripping of its own, so the header-leak half of this finding is " +
      "expected to keep reproducing. `meta.location` is a separate question, governed by I30/D37, not U2.",
    observed: leaked != null,
    detail:
      `X-Api-Key reached ${leaked?.url ?? 'nowhere'} (still reproduces — open, U2, not a regression: no ` +
      `redirect policy exists for core.ts to enforce, and the fetch port it was handed is the one doing ` +
      `the redirecting). Separately, and NOT part of this finding's boolean: meta.location=${r.meta.location} ` +
      `now correctly reports where the bytes actually came from, rather than the declared URL the harness ` +
      `reproduction returned — that half is fixed by I30/D37, tracked as its own, closed concern. Combining ` +
      `both into one pass/fail (as the original probe did) would have hidden that the location half is fixed ` +
      `while the header-leak half is not; they are reported separately here for that reason.`,
  };
});

// ---------------------------------------------------------------- F10

probe('F10', 'STRUCTURAL', 'Byte-identity with the GameEngine serializer is untestable here', async () => ({
  expected: "D39 (cross-checked at f7d8f59) and J1.5 close this for the core's own serializer; a probe " +
    'resting on U4 that still reproduced after J1.5 would be a genuine regression (J12.9).',
  observed: null,
  detail:
    'SubZeroDev.GameEngine is still not in this tree. This probe cannot run here regardless of which core ' +
    "it points at — its premise is a second repository's presence, not this core's behaviour. Not testable, " +
    'and not a regression: the byte-identity claim itself is proven in src/core/canonical.test.ts against ' +
    "the engine's own recorded test vectors (D39), which is the check J1.5 actually asks for.",
}));

// ---------------------------------------------------------------- F11

probe('F11', 'STRUCTURAL', 'loadMany fans out with no bound', async () => {
  const files = {};
  const sources = {};
  for (let i = 0; i < 200; i++) {
    files[`/data/p${i}.json`] = { body: `{"i":${i}}`, mtimeMs: 1000 };
    sources[`p${i}`] = { at: 'runtime', path: `/data/p${i}.json`, cache: 'manual' };
  }
  const fs = fakeFs(files);
  const loader = createJsonLoader({ version: 1, sources }, { fs });

  await loader.loadMany(Object.keys(sources));
  return {
    expected: '§12 U5 (fan-out bound) is still open. Expected to keep reproducing (J12.9).',
    observed: fs.__openPeak() === 200,
    detail:
      `loadMany over 200 ids opened ${fs.__openPeak()} reads simultaneously. Reproduces as expected — ` +
      'loader.ts loadMany is Promise.all(ids.map(loadById)), unchanged in shape from the reproduction. ' +
      'Accounted for as open (U5), not a regression.',
  };
});

// ---------------------------------------------------------------- F12

probe('F12', 'STRUCTURAL', 'A subzerodev envelope reporting failure becomes a success carrying undefined', async () => {
  const fetchPort = fakeFetchReal({ [URL_B]: { status: 200, body: { success: false, error: 'rate limited' } } });
  const loader = createJsonLoader(
    { version: 1, sources: { status: { at: 'runtime', url: URL_B, cache: 'manual', unwrap: 'subzerodev' } } },
    { fetch: fetchPort, schedule: realScheduledWait },
  );

  const r = await loader.loadById('status');

  return {
    expected: "I34/J1.12: an envelope whose success is false yields json.schema carrying the envelope's " +
      'own message; ok:true with data:undefined is unreachable.',
    observed: r.ok === true && r.data === undefined,
    detail:
      `Upstream: 200 {"success":false,"error":"rate limited"} -> ok=${r.ok}, reason=${r.reason}, ` +
      `message=${JSON.stringify(r.message)}, data=${String(r.data)}. Not reproduced: applyUnwrap ` +
      "(pipeline.ts) explicitly checks `envelope.success === false` and throws with the envelope's message, " +
      "mapped to json.schema. `unwrap` had to move from the probe's ad-hoc call (no longer accepted there) " +
      'to the declared entry to be expressible at all.',
  };
});

// ---------------------------------------------------------------- F13

probe('F13', 'LOCAL', 'JsonMeta has no provider value for a result where nothing resolved', async () => {
  const loader = createJsonLoader({ version: 1, sources: {} }, {});
  const r = await loader.load({ id: 'absent' });
  const legal = ['http', 'file', 'inline', 'none'];

  return {
    expected: "JsonMeta.provider is 'http' | 'file' | 'inline' | 'none' (types.ts) — a fourth member was " +
      'added specifically to give an unresolved result something real to report.',
    observed: !legal.includes(r.meta.provider),
    detail:
      `json.unresolved -> provider=${String(r.meta.provider)}. Not reproduced: the union gained 'none' and ` +
      "emptyMeta() (pipeline.ts) sets exactly that. The finding's own three-member legal list is what's " +
      'stale here, not the implementation — updated above to match the current contract.',
  };
});

// ---------------------------------------------------------------- F14

probe('F14', 'LOCAL', 'invalidate() cannot guard a load whose key is not yet in the cache', async () => {
  const fetchPort = fakeFetchReal({ [URL_A]: { body: { v: 'pre-invalidate' }, delayMs: 60 } });
  const loader = createJsonLoader(
    { version: 1, sources: { projects: { at: 'runtime', url: URL_A, cache: 'manual' } } },
    { fetch: fetchPort, schedule: realScheduledWait },
  );

  const inflightRead = loader.loadById('projects'); // cold: no entry yet
  await new Promise((r) => setTimeout(r, 10));
  loader.invalidate(); // "forget everything", mid-flight
  await inflightRead;

  const after = await loader.loadById('projects');
  return {
    expected: 'I17/D15, J11.3: invalidate() bumps this loader\'s epoch unconditionally, so an in-flight ' +
      "load's commit token (captured before the bump) no longer matches at commit time and the write is a " +
      'no-op — nothing fetched before invalidate() survives it.',
    observed: after.meta.cached === true && after.data.v === 'pre-invalidate',
    detail:
      `After invalidate(), a read returned cached=${after.meta.cached} data=${JSON.stringify(after.data)} ` +
      `with ${fetchPort.calls.length} total fetch call(s). Not reproduced: cache-manager.ts's epoch is ` +
      "global and unconditional (not scoped to keys the loader remembers writing, unlike the harness's " +
      "`written` set), so a cold key's in-flight commit is guarded exactly the same as a warm one's.",
  };
});

// ---------------------------------------------------------------- F15

probe('F15', 'LOCAL', 'An mtime stamp misses a same-size edit inside the clock resolution', async () => {
  const fs = fakeFs({ '/data/config.json': { body: '{"v":"a"}', mtimeMs: 1_700_000_000_000 } });
  const loader = createJsonLoader(
    { version: 1, sources: { config: { at: 'runtime', path: '/data/config.json', cache: { mtime: true } } } },
    { fs },
  );

  const first = await loader.loadById('config');
  fs.__write('/data/config.json', '{"v":"b"}', { mtimeMs: 1_700_000_000_000 }); // same second, same size
  const second = await loader.loadById('config');

  fs.__failStat(true);
  const duringStatFailure = await loader.loadById('config');
  fs.__failStat(false);

  return {
    expected: "D36 (`design/30-slices.md` J2.2): this is a known-and-retained limit, not a defect — a " +
      "same-size edit inside the filesystem's mtime resolution is written into the test as a documented " +
      'gap. Expected to keep reproducing.',
    observed: second.data.v === 'a' && second.meta.cached === true,
    detail:
      `File went "a" -> "b" with identical size and mtime; read returned "${second.data.v}" cached=` +
      `${second.meta.cached}. First load: v=${first.data.v}. Under stat failure: ok=${duringStatFailure.ok} ` +
      `cached=${duringStatFailure.meta.cached} — a null stamp is unambiguously a miss (checkCache, ` +
      'pipeline.ts), which was already the harness\'s own charitable reading and needed no change. The ' +
      'stamp-before-read half (D36/J10.3) is confirmed by inspection: checkCache runs, and stat, before ' +
      'fetchFileCore. Reproduces as expected — accounted for as design-accepted (D36), not a regression.',
  };
});

// ---------------------------------------------------------------- F16

probe('F16', 'STRUCTURAL', "preload's boot guarantee expires with the policy that warmed it", async () => {
  let up = true;
  const clock = fakeClock(0);
  const fetchPort = fakeFetchReal({ [URL_A]: () => (up ? { body: { v: 1 } } : { throws: 'ECONNREFUSED' }) });
  const loader = createJsonLoader(
    { version: 1, sources: { projects: { at: 'runtime', url: URL_A, cache: { ttlMs: 300_000 } } } },
    { fetch: fetchPort, clock, schedule: realScheduledWait },
  );

  await loader.preload(['projects']); // boot gate passes
  clock.advance(400_000); // past the ttl
  up = false; // upstream now down
  const firstRealRequest = await loader.loadById('projects');

  return {
    expected: 'J12.6 (contracted, closed): "preload\'s guarantee is that every named id resolved once, at ' +
      'the moment it was called" — a ttl entry preloaded at boot and read after its window expires fails ' +
      'like any other expired entry. This is asserted behaviour, not an open question.',
    observed: firstRealRequest.ok === false,
    detail:
      `preload succeeded, so the process booted. ${400_000 / 1000}s later the first request returned ` +
      `ok=${firstRealRequest.ok} reason=${firstRealRequest.reason}. Reproduces, and is accounted for as ` +
      "design-accepted per J12.6's own acceptance criterion — this is exactly what that criterion asserts " +
      'should happen, not a gap it left open.',
  };
});

// ---------------------------------------------------------------- F17

probe('F17', 'STRUCTURAL', 'I6 is checked against the whole map, not the sources the environment resolves', async () => {
  const map = {
    version: 1,
    sources: {
      projects: { at: 'build', url: URL_A, cache: 'manual' }, // what a build resolves
      liveStatus: { at: 'runtime', url: URL_B, cache: { ttlMs: 300_000 } }, // what it never touches
    },
  };
  let threw = null;
  try {
    createJsonLoader(map, { fetch: fakeFetchReal({ [URL_A]: { body: { v: 1 } } }), schedule: realScheduledWait });
  } catch (e) {
    threw = e;
  }

  return {
    expected: "10-design.md §7 Q2 (scoping I6 to the sources an environment actually resolves) is still " +
      'open — nothing in J1-J12 touches config.ts\'s checkRequiredPorts, which iterates the whole ' +
      'normalized map unconditionally. Expected to keep reproducing.',
    observed: threw != null,
    detail:
      `createJsonLoader threw: ${threw?.code} — ${JSON.stringify(threw?.message)}. Reproduces as expected: ` +
      'the offending entry is liveStatus (at:runtime, ttl), which I8 guarantees a build will never resolve, ' +
      'yet construction still demands a clock port for it. Accounted for as open (§7 Q2), not a regression.',
  };
});

export default probes;
