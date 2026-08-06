// The two-phase walkthrough behind finding F1: a build that resolves `at: build` sources
// and writes artifacts and a lockfile, then a runtime that has to read them.
//
// Phase 1 works. Phase 2 is the finding.
//
// `node harness/sample-app.mjs`

import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonLoader } from './core.mjs';
import { canonical, digestOf } from './canonical.mjs';
import { fakeFetch, realSchedule } from './fakes.mjs';

const h = (s) => console.log(`\n${s}\n${'-'.repeat(s.length)}`);

// config/sources.public.yml, as the object a YAML parser would produce.
const publicMap = {
  version: 1,
  sources: {
    projects: { at: 'build', url: 'https://data.example/portfolio/projects.json', schema: 'project' },
    cv: { at: 'build', url: 'https://data.example/portfolio/cv.json', schema: 'cv' },
    liveStatus: { at: 'runtime', url: 'https://api.example/v1/status', cache: { ttlMs: 300_000 } },
  },
};

const upstream = fakeFetch({
  'https://data.example/portfolio/projects.json': { body: { items: [{ id: 'p1', name: 'Portfolio' }] } },
  'https://data.example/portfolio/cv.json': { body: { name: 'B. Richards', roles: ['engineer'] } },
  'https://api.example/v1/status': { body: { status: 'green' } },
});

// ---------------------------------------------------------------- phase 1: the build

h('Phase 1 — build (10-design.md §3.2)');

const outDir = await mkdtemp(join(tmpdir(), 'data-json-sample-'));

// I6 is checked against every entry in the map, not against the entries this environment
// will resolve. The build touches only `at: build` sources (I8) and none of them is ttl,
// but `liveStatus` is, so the build cannot construct a loader without a clock it has no
// use for — and a build that holds a clock is a build whose output can depend on one.
try {
  createJsonLoader(publicMap, { fetch: upstream, schedule: realSchedule });
  console.log('  I6 did not fire on an unreachable ttl source.');
} catch (e) {
  console.log(`  I6 fired at construction: ${e.message}`);
  console.log('  ...for liveStatus, an at:runtime source this build will never resolve (I8).');
  console.log('  §7 Q2 proposes scoping the check to "the sources that environment will actually');
  console.log('  resolve", but Q2 is about fetch and fs ports; I6 as written is unconditional.\n');
}

const buildClock = () => 0;   // supplied only to get past I6
const buildLoader = createJsonLoader(publicMap, { fetch: upstream, schedule: realSchedule, clock: buildClock });

const buildIds = Object.entries(publicMap.sources).filter(([, e]) => e.at === 'build').map(([id]) => id);
const runtimeIds = Object.entries(publicMap.sources).filter(([, e]) => e.at === 'runtime').map(([id]) => id);

const resolved = await Promise.all(
  buildIds.map(async (id) => [id, await buildLoader.load({ id, ...srcOf(id), at: 'build', digest: true })]),
);

const failures = resolved.filter(([, r]) => !r.ok);
if (failures.length) {
  console.log(`  build failed: ${failures.map(([id, r]) => `${id} (${r.reason})`).join(', ')}`);
  process.exit(1);
}

// Nothing is written until everything resolves (§3.2 step 3).
for (const [id, r] of resolved) {
  await writeFile(join(outDir, `${id}.json`), canonical(r.data), 'utf8');
}
const lock = {
  version: 1,
  sources: Object.fromEntries(
    resolved
      .map(([id, r]) => [id, {
        location: r.meta.location, digest: r.meta.digest, bytes: r.meta.bytes,
        resolvedAt: '1970-01-01T00:00:00.000Z',   // informational only; pinned so builds compare
      }])
      .sort(([a], [b]) => (a < b ? -1 : 1)),   // §5: sorted-id order, so resolution order cannot move bytes
  ),
};
await writeFile(join(outDir, 'json.lock'), canonical(lock), 'utf8');

console.log(`  out dir: ${outDir}`);
console.log(`  wrote:   ${(await readdir(outDir)).join(', ')}`);
console.log(`  at:runtime entries untouched (I8): ${runtimeIds.join(', ')} — fetches so far: ` +
  `${upstream.calls.filter((c) => c.url.includes('/v1/status')).length}`);
console.log(`  lockfile digest for projects: ${lock.sources.projects.digest}`);
console.log(`  re-serialising the lockfile is byte-identical: ${canonical(lock) === canonical(lock)}`);
console.log('  This half of the design does what it says.');

// ---------------------------------------------------------------- phase 2: the runtime

h('Phase 2 — runtime, browser bundle (10-design.md §3.1)');

console.log('  The bundle ships with the artifacts above. A component calls loadById("projects").');
console.log('  The loader is constructed from the same source map, because §1.2 says the map is the');
console.log('  only persisted thing a human writes and the artifacts are build output.\n');

const browserLoader = createJsonLoader(publicMap, { clock: buildClock /* no fetch port: a browser must not refetch a build source */ });
const browser = await browserLoader.loadById('projects');
console.log(`  no fetch port -> ok=${browser.ok}, reason=${browser.reason}, message=${JSON.stringify(browser.message)}`);
console.log('  The artifact on disk is never consulted. Nothing in SourceMap, JsonRequest or JsonPorts names it.\n');

const refetchLoader = createJsonLoader(publicMap, { fetch: upstream, schedule: realSchedule, clock: buildClock });
const before = upstream.calls.length;
const refetched = await refetchLoader.loadById('projects');
console.log(`  with a fetch port -> ok=${refetched.ok}, provider=${refetched.meta.provider}, ` +
  `attempts=${refetched.meta.attempts}, new fetch calls=${upstream.calls.length - before}`);
console.log('  It went back to the network for a source declared at: build. That is what I8 forbids.');

console.log(`\n  Artifact sitting unread at ${join(outDir, 'projects.json')}:`);
console.log(`    ${await readFile(join(outDir, 'projects.json'), 'utf8')}`);

h('What phase 2 shows');
console.log('  §3.1 has nine steps and none of them branches on `at`. The two behaviours available to an');
console.log('  implementer are a failure whose reason is about transport rather than about the artifact');
console.log('  (json.transport, "no fetch port" — there is no reason code for "the build never ran"),');
console.log('  and a runtime fetch, which is what I8 forbids.');
console.log('  The design asserts "the call site is identical whether the source is at: build or at: runtime".');
console.log('  Both halves of that sentence are implemented above; they do not meet.\n');

function srcOf(id) {
  const e = publicMap.sources[id];
  return { source: e.url != null ? { kind: 'http', url: e.url } : { kind: 'file', path: e.path } };
}
