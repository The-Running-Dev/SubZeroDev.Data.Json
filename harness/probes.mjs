// One probe per red-team finding. A probe states what the design implies, exercises the
// reference implementation in core.mjs, and reports what actually happened.
//
// `observed: true` means the finding reproduced. `observed: false` means it did not, and
// the finding is weakened or wrong.

import { createJsonLoader, makeMemoryStore } from './core.mjs';
import { fakeFetch, fakeFs, fakeClock, fakeRng, realSchedule, recordingLog } from './fakes.mjs';

const URL_A = 'https://data.example/portfolio/projects.json';
const URL_B = 'https://data.example/status.json';

const probes = [];
const probe = (id, severity, title, fn) => probes.push({ id, severity, title, fn });

// ---------------------------------------------------------------- F1

probe('F1', 'BLOCKING', 'No path reads a prefetched at:build artifact at runtime', async () => {
  const fetchPort = fakeFetch({ [URL_A]: { body: { projects: ['a'] } } });
  const loader = createJsonLoader(
    { version: 1, sources: { projects: { at: 'build', url: URL_A } } },
    { fetch: fetchPort, schedule: realSchedule },
  );
  const r = await loader.loadById('projects');
  return {
    expected: 'an at:build source is never fetched at runtime (I8), and resolves from the prefetched artifact',
    observed: fetchPort.calls.length > 0,
    detail:
      `loadById('projects') on an at:build entry -> ok=${r.ok}, provider=${r.meta.provider}, ` +
      `transport attempts=${r.meta.attempts}, fetch calls=${fetchPort.calls.length}. ` +
      'The map carries only a url. SourceMap has no artifact path, JsonPorts has no artifact reader, ' +
      'and §3.1 defines no branch on `at`. Fetching it is the only behaviour the documents make ' +
      'implementable, and it is the one I8 forbids.',
  };
});

// ---------------------------------------------------------------- F2

probe('F2a', 'BLOCKING', 'Cache key ignores unwrap: a caller declaring none receives an unwrapped value', async () => {
  const envelope = { success: true, data: { v: 1 } };
  const fetchPort = fakeFetch({ [URL_B]: { body: envelope } });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realSchedule });
  const src = { kind: 'http', url: URL_B };

  const a = await loader.load({ id: 'status', source: src, at: 'runtime', unwrap: 'subzerodev' });
  const b = await loader.load({ id: 'status', source: src, at: 'runtime', unwrap: 'none' });

  return {
    expected: 'I4: unwrap none means the parsed body is returned exactly as parsed',
    observed: b.meta.cached === true && !('success' in (b.data ?? {})),
    detail:
      `A (unwrap subzerodev) -> ${JSON.stringify(a.data)}; ` +
      `B (unwrap none) -> ok=${b.ok}, cached=${b.meta.cached}, data=${JSON.stringify(b.data)}. ` +
      'B declared it wanted the envelope and received the unwrapped body, with no reason code.',
  };
});

probe('F2b', 'BLOCKING', 'Cache key ignores headers: a caller with no credential receives a credentialed response', async () => {
  const fetchPort = fakeFetch({
    [URL_B]: (init) => ({
      body: init?.headers?.['X-Api-Key'] === 'secret-A'
        ? { scope: 'privileged', salary: 120000 }
        : { scope: 'public' },
    }),
  });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realSchedule });

  const a = await loader.load({
    id: 'employees', at: 'runtime',
    source: { kind: 'http', url: URL_B, headers: { 'X-Api-Key': 'secret-A' } },
  });
  const b = await loader.load({
    id: 'employees', at: 'runtime',
    source: { kind: 'http', url: URL_B },
  });

  return {
    expected: 'a caller supplying no credential cannot receive a response fetched with someone else\'s',
    observed: b.meta.cached === true && b.data?.scope === 'privileged',
    detail:
      `A (X-Api-Key: secret-A) -> ${JSON.stringify(a.data)}; ` +
      `B (no headers) -> cached=${b.meta.cached}, data=${JSON.stringify(b.data)}; ` +
      `fetch calls=${fetchPort.calls.length}. Same id, same url, same location, so the location ` +
      'check in §1.1 passes and the entry is served.',
  };
});

probe('F2c', 'BLOCKING', 'In-flight join ignores the joiner\'s timeout and misreports its attempts', async () => {
  let n = 0;
  const fetchPort = fakeFetch({
    [URL_A]: () => (++n < 3 ? { throws: 'ECONNREFUSED' } : { body: { v: 'ok' } }),
  });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realSchedule });
  const src = { kind: 'http', url: URL_A };

  const t0 = Date.now();
  const pa = loader.load({ id: 'projects', source: src, at: 'runtime', timeoutMs: 5000, retry: { attempts: 3, delayMs: 80 } });
  const pb = loader.load({ id: 'projects', source: src, at: 'runtime', timeoutMs: 5 });
  const [a, b] = await Promise.all([pa, pb]);
  const elapsed = Date.now() - t0;

  return {
    expected: 'B declared timeoutMs 5 and retry defaults (1 attempt); meta.attempts counts attempts made by this call',
    observed: b.ok === true && elapsed > 100 && b.meta.attempts === 3,
    detail:
      `B declared timeoutMs=5, no retry. B resolved ok=${b.ok} after ${elapsed}ms with ` +
      `meta.attempts=${b.meta.attempts} (A declared attempts=3, delayMs=80). ` +
      'B made no transport attempt of its own and reports three.',
  };
});

// ---------------------------------------------------------------- F3

probe('F3', 'STRUCTURAL', 'A shared CacheStore breaks "two loaders in one process share nothing"', async () => {
  const store = makeMemoryStore();
  const fetchPort = fakeFetch({ [URL_A]: { body: { v: 'from-A' } } });
  const map = { version: 1, sources: { config: { at: 'runtime', url: URL_A } } };
  const a = createJsonLoader(map, { fetch: fetchPort, cache: store, schedule: realSchedule });
  const b = createJsonLoader(map, { fetch: fetchPort, cache: store, schedule: realSchedule });

  await a.loadById('config');
  const viaB = await b.loadById('config');
  const fetchesBeforeInvalidate = fetchPort.calls.length;

  a.invalidate('config');
  const afterEvict = await b.loadById('config');

  return {
    expected: '§5: "Two loaders in one process share nothing." Loader B\'s cache is loader B\'s',
    observed: viaB.meta.cached === true && afterEvict.meta.cached === false,
    detail:
      `B's first read: cached=${viaB.meta.cached} after ${fetchesBeforeInvalidate} total fetch call(s) — ` +
      "B served A's entry without transporting. " +
      `A.invalidate('config') then evicted B's entry: B's next read cached=${afterEvict.meta.cached}. ` +
      "A's generation counter and B's are separate; the store they act on is not.",
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
    l.__registerWatch('config', '/data/config.json');
    loaders.push(l);
  }
  const disposers = ['dispose', 'close', 'destroy', 'unwatch', Symbol.dispose, Symbol.asyncDispose]
    .filter((k) => typeof loaders[0][k] === 'function');

  return {
    expected: 'a loader that registers watchers exposes a way to release them',
    observed: disposers.length === 0 && fs.__watchers.filter((w) => w.active).length === 3,
    detail:
      `3 loaders registered 3 watchers; ${fs.__watchers.filter((w) => w.active).length} still active. ` +
      `JsonLoader members matching a teardown name: ${disposers.length === 0 ? 'none' : disposers.join(', ')}. ` +
      'FileSystemPort.watch returns an unsubscribe that no member of JsonLoader can call.',
  };
});

// ---------------------------------------------------------------- F5

probe('F5', 'STRUCTURAL', 'A cache hit cannot produce a digest the first caller did not request', async () => {
  const fetchPort = fakeFetch({ [URL_A]: { body: { v: 1 } } });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realSchedule });
  const src = { kind: 'http', url: URL_A };

  const a = await loader.load({ id: 'projects', source: src, at: 'runtime' });               // digest defaults false
  const b = await loader.load({ id: 'projects', source: src, at: 'runtime', digest: true }); // hit

  return {
    expected: 'a caller declaring digest: true receives a digest, or a failure explaining why not',
    observed: b.ok === true && b.meta.cached === true && b.meta.digest === null,
    detail:
      `A (digest default false) -> digest=${a.meta.digest}. ` +
      `B (digest: true) -> ok=${b.ok}, cached=${b.meta.cached}, digest=${JSON.stringify(b.meta.digest)}. ` +
      'JsonLock.sources[].digest is typed `string`; this result has nothing to put in it.',
  };
});

// ---------------------------------------------------------------- F6

probe('F6', 'STRUCTURAL', 'preload rejects with a formatted string, not reason codes', async () => {
  const fetchPort = fakeFetch({ [URL_A]: { body: { v: 1 } } });
  const loader = createJsonLoader(
    {
      version: 1,
      sources: {
        projects: { at: 'runtime', url: URL_A },
        cv: { at: 'runtime', url: 'https://data.example/cv.json' },       // refused
        skills: { at: 'runtime', url: 'https://data.example/skills.json' }, // refused
      },
    },
    { fetch: fetchPort, schedule: realSchedule },
  );

  let caught = null;
  try { await loader.preload(['projects', 'cv', 'skills']); } catch (e) { caught = e; }

  const structured = caught && (caught.failures ?? caught.reasons ?? caught.results);
  return {
    expected: 'the composition root can branch on why boot failed, per id, the way D8 built the result type to allow',
    observed: caught != null && structured === undefined,
    detail:
      `preload threw ${caught?.constructor?.name}. Structured per-id detail: ${structured === undefined ? 'none' : 'present'}. ` +
      `The reason codes exist only inside message: ${JSON.stringify(caught?.message)}. ` +
      'To decide "retry the deploy" vs "stop, a schema moved", the operator must parse that string.',
  };
});

// ---------------------------------------------------------------- F7

probe('F7', 'STRUCTURAL', 'The default cache policy never refreshes', async () => {
  let body = { status: 'green' };
  const fetchPort = fakeFetch({ [URL_B]: () => ({ body }) });
  const loader = createJsonLoader(
    { version: 1, sources: { liveStatus: { at: 'runtime', url: URL_B } } }, // no cache: declared
    { fetch: fetchPort, schedule: realSchedule },
  );

  const first = await loader.loadById('liveStatus');
  body = { status: 'red' };
  const later = await loader.loadById('liveStatus');
  const muchLater = await loader.loadById('liveStatus');

  return {
    expected: 'a source named liveStatus, migrated from a 5-minute TTL, keeps refreshing',
    observed: later.data.status === 'green' && fetchPort.calls.length === 1,
    detail:
      `Upstream moved green -> red. Reads returned ${first.data.status}, ${later.data.status}, ${muchLater.data.status} ` +
      `after ${fetchPort.calls.length} fetch call(s). Default is { kind: 'manual' }, and §3.1 says manual ` +
      'always hits until invalidated. The entry is read once per process lifetime.',
  };
});

// ---------------------------------------------------------------- F8

probe('F8', 'STRUCTURAL', 'No bound on response size', async () => {
  const big = JSON.stringify({ rows: Array.from({ length: 60_000 }, (_, i) => ({ i, pad: 'x'.repeat(64) })) });
  const fetchPort = fakeFetch({ [URL_A]: { body: big } });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realSchedule });

  const r = await loader.load({ id: 'projects', source: { kind: 'http', url: URL_A }, at: 'runtime' });

  return {
    expected: 'an untrusted upstream cannot make the loader materialise an arbitrary body',
    observed: r.ok === true && r.meta.bytes > 4_000_000,
    detail:
      `Upstream returned ${(r.meta.bytes / 1e6).toFixed(1)} MB. Result ok=${r.ok}, reason=${r.reason}. ` +
      'bytes is counted after the body is in hand (§1.3). No maxBytes exists in JsonRequest, ' +
      'SourceEntry, or JsonPorts; every declared bound is temporal.',
  };
});

// ---------------------------------------------------------------- F9

probe('F9', 'STRUCTURAL', 'Redirects carry custom headers to a new origin, and location does not follow', async () => {
  const fetchPort = fakeFetch({
    'https://api.internal/v1/rates': { redirectTo: 'https://evil.example/collect' },
    'https://evil.example/collect': { body: { v: 'attacker-controlled' } },
  });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realSchedule });

  const r = await loader.load({
    id: 'rates', at: 'runtime', digest: true,
    source: { kind: 'http', url: 'https://api.internal/v1/rates', headers: { 'X-Api-Key': 'live-key-9f2' } },
  });

  const leaked = fetchPort.calls.find((c) => c.viaRedirect && c.init?.headers?.['X-Api-Key']);
  return {
    expected: 'no redirect mode is specified, so the default follows; custom headers are not stripped cross-origin',
    observed: leaked != null && r.meta.location === 'https://api.internal/v1/rates',
    detail:
      `X-Api-Key reached ${leaked?.url ?? 'nowhere'}. ` +
      `meta.location = ${r.meta.location}, meta.digest = ${r.meta.digest}. ` +
      'The lockfile would attest that digest to a location the bytes did not come from. ' +
      'Only Authorization, Cookie and Proxy-Authorization are stripped on a cross-origin redirect.',
  };
});

// ---------------------------------------------------------------- F10

probe('F10', 'STRUCTURAL', 'Byte-identity with the GameEngine serializer is untestable here', async () => ({
  expected: 'I13 and 00-brief §7.7 are checkable against the engine\'s canonical.ts and its test vectors',
  observed: null,
  detail:
    'SubZeroDev.GameEngine is not in this tree (§7 Q4 states this). The target file, its value ' +
    'domain, and its test vectors have not been read by anyone who wrote this design. ' +
    'The harness can confirm its own serializer is self-consistent and nothing more.',
}));

// ---------------------------------------------------------------- F11

probe('F11', 'STRUCTURAL', 'loadMany fans out with no bound', async () => {
  const files = {};
  const sources = {};
  for (let i = 0; i < 200; i++) {
    files[`/data/p${i}.json`] = { body: `{"i":${i}}`, mtimeMs: 1000 };
    sources[`p${i}`] = { at: 'runtime', path: `/data/p${i}.json` };
  }
  const fs = fakeFs(files);
  const loader = createJsonLoader({ version: 1, sources }, { fs });

  await loader.loadMany(Object.keys(sources));
  return {
    expected: '§5 defends unbounded fan-out with "a source map is hand-written and small"; loadMany takes a caller-sized array',
    observed: fs.__openPeak() === 200,
    detail:
      `loadMany over 200 ids opened ${fs.__openPeak()} reads simultaneously. ` +
      'O5 names preload and prefetch only. On a real filesystem port this is the EMFILE path, ' +
      'and every id then returns json.transport, which reads as an outage.',
  };
});

// ---------------------------------------------------------------- F12

probe('F12', 'STRUCTURAL', 'A subzerodev envelope reporting failure becomes a success carrying undefined', async () => {
  const fetchPort = fakeFetch({ [URL_B]: { status: 200, body: { success: false, error: 'rate limited' } } });
  const loader = createJsonLoader({ version: 1, sources: {} }, { fetch: fetchPort, schedule: realSchedule });

  const r = await loader.load({ id: 'status', source: { kind: 'http', url: URL_B }, at: 'runtime', unwrap: 'subzerodev' });

  return {
    expected: 'the one unwrap mode built to read an envelope handles the envelope reporting failure',
    observed: r.ok === true && r.data === undefined,
    detail:
      `Upstream: 200 {"success":false,"error":"rate limited"} -> ok=${r.ok}, reason=${r.reason}, ` +
      `data=${String(r.data)}, validated=${r.meta.validated}. ` +
      '§4.1 defines only "declared envelope absent -> json.schema"; this envelope is present. ' +
      'An implementer reading the same sentence could equally reject it, which is the finding.',
  };
});

// ---------------------------------------------------------------- F13

probe('F13', 'LOCAL', 'JsonMeta has no provider value for a result where nothing resolved', async () => {
  const loader = createJsonLoader({ version: 1, sources: {} }, {});
  const r = await loader.load({ id: 'absent', at: 'runtime' });
  const legal = ['http', 'file', 'inline'];

  return {
    expected: "meta.provider is one of 'http' | 'file' | 'inline' on every result",
    observed: !legal.includes(r.meta.provider),
    detail:
      `json.unresolved -> provider=${String(r.meta.provider)}, location=${JSON.stringify(r.meta.location)}. ` +
      'The union has three members and no unresolved member. §1.3 covers location and is silent on provider. ' +
      'Whatever the implementer picks, a consumer switching exhaustively on provider is told something false.',
  };
});

// ---------------------------------------------------------------- F14

probe('F14', 'LOCAL', 'invalidate() cannot guard a load whose key is not yet in the cache', async () => {
  const fetchPort = fakeFetch({ [URL_A]: { body: { v: 'pre-invalidate' }, delayMs: 60 } });
  const loader = createJsonLoader(
    { version: 1, sources: { projects: { at: 'runtime', url: URL_A } } },
    { fetch: fetchPort, schedule: realSchedule },
  );

  const inflightRead = loader.loadById('projects');   // cold: no entry, so no counter to carry
  await new Promise((r) => setTimeout(r, 10));
  loader.invalidate();                                 // "forget everything"
  await inflightRead;

  const after = await loader.loadById('projects');
  return {
    expected: 'after invalidate() the loader holds nothing fetched before it',
    observed: after.meta.cached === true && after.data.v === 'pre-invalidate',
    detail:
      `After invalidate(), a read returned cached=${after.meta.cached} data=${JSON.stringify(after.data)} ` +
      `with ${fetchPort.calls.length} total fetch call(s). The generation counter lives with the cache key, ` +
      'and a cold key has no entry to carry one. CacheStore also declares no way to enumerate keys, ' +
      'so an implementation can only bump what it separately remembers writing.',
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
    expected: 'the policy whose promise is "notices when the file changed" notices',
    observed: second.data.v === 'a' && second.meta.cached === true,
    detail:
      `File went "a" -> "b" with identical size and mtime; read returned "${second.data.v}" ` +
      `cached=${second.meta.cached}. With stat failing the read returned ok=${duringStatFailure.ok} ` +
      `cached=${duringStatFailure.meta.cached} and stored an entry with no stamp — after which nothing ` +
      'in the design says whether a null stamp is a permanent miss or a permanent hit. ' +
      'Nor does anything say whether the stamp is taken before or after the read.',
  };
});

// ---------------------------------------------------------------- F16

probe('F16', 'LOCAL', 'preload\'s boot guarantee expires with the policy that warmed it', async () => {
  let up = true;
  const clock = fakeClock(0);
  const fetchPort = fakeFetch({ [URL_A]: () => (up ? { body: { v: 1 } } : { throws: 'ECONNREFUSED' }) });
  const loader = createJsonLoader(
    { version: 1, sources: { projects: { at: 'runtime', url: URL_A, cache: { ttlMs: 300_000 } } } },
    { fetch: fetchPort, clock, schedule: realSchedule },
  );

  await loader.preload(['projects']);   // boot gate passes
  clock.advance(400_000);               // past the ttl
  up = false;                           // upstream now down
  const firstRealRequest = await loader.loadById('projects');

  return {
    expected: 'D7: the process refuses to boot rather than 500 on a request it was preloaded for',
    observed: firstRealRequest.ok === false,
    detail:
      `preload succeeded, so the process booted. ${400_000 / 1000}s later the first request returned ` +
      `ok=${firstRealRequest.ok} reason=${firstRealRequest.reason} -> the router maps that to 504. ` +
      'The gate held at boot and nowhere after it. §3.3 also never states that preload writes to the cache at all.',
  };
});

// ---------------------------------------------------------------- F17

probe('F17', 'STRUCTURAL', 'I6 is checked against the whole map, not the sources the environment resolves', async () => {
  const map = {
    version: 1,
    sources: {
      projects: { at: 'build', url: URL_A },                                 // what a build resolves
      liveStatus: { at: 'runtime', url: URL_B, cache: { ttlMs: 300_000 } },  // what it never touches
    },
  };
  let threw = null;
  try {
    createJsonLoader(map, { fetch: fakeFetch({ [URL_A]: { body: { v: 1 } } }), schedule: realSchedule });
  } catch (e) { threw = e; }

  return {
    expected: 'a build that resolves only at:build sources (I8) can construct a loader without a clock',
    observed: threw != null,
    detail:
      `createJsonLoader threw: ${JSON.stringify(threw?.message)}. ` +
      'The offending entry is at:runtime, which I8 guarantees the build will never resolve. ' +
      'To proceed the build must hold a clock port it has no use for, in a pass whose output ' +
      'is supposed to be byte-comparable across builds. §7 Q2 proposes scoping this check to ' +
      'the sources an environment actually resolves, but Q2 is about the fetch and fs ports; ' +
      'I6 is written unconditionally and covers clock and rng.',
  };
});

export default probes;
