// A reference implementation of 20-contract.md §1-§5 and 10-design.md §3.1, written to
// the documents AS THEY STAND.
//
// It is deliberately NOT fixed. Where the design is silent the most charitable reading is
// implemented and the choice is marked `// AMBIGUOUS:`. Where the design is explicit the
// consequence is implemented even when it is obviously wrong, because the consequence is
// what the probes exist to show. Do not "improve" this file — a corrected harness proves
// nothing about the design it was supposed to test.

import { canonical, digestOf } from './canonical.mjs';

export const REASONS = [
  'json.ok', 'json.transport', 'json.status', 'json.timeout',
  'json.parse', 'json.schema', 'json.notFound', 'json.unresolved',
];

// ---------------------------------------------------------------- normalizeSource

export function normalizeSource(spec) {
  if (typeof spec === 'string') {
    return /^https?:\/\//.test(spec) ? { kind: 'http', url: spec } : { kind: 'file', path: spec };
  }
  return spec;
}

const locationOf = (src) =>
  src == null ? '' : src.kind === 'http' ? src.url : src.kind === 'file' ? src.path : '<inline>';

// ---------------------------------------------------------------- helpers

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const k of Object.keys(value)) deepFreeze(value[k]);
  return value;
}

function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    if (cp > 0xffff) i++;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

const RETRYABLE_STATUS = (s) => s === 408 || s === 429 || (s >= 500 && s < 600);

function withTimeout(promise, ms, ports) {
  // 10-design.md §7 Q1: the contract has no scheduling port. The harness supplies one so
  // that timeout and retry-delay are expressible at all. This is the harness standing in
  // for an unresolved open question, not an answer to it.
  if (!ms || !ports.schedule) return promise;
  return Promise.race([
    promise,
    ports.schedule(ms).then(() => {
      const e = new Error(`no response inside ${ms}ms`);
      e.__timeout = true;
      throw e;
    }),
  ]);
}

// ---------------------------------------------------------------- loader

export function createJsonLoader(sourceMap, ports = {}) {
  const entries = sourceMap?.sources ?? {};
  const normalized = new Map();
  for (const [id, entry] of Object.entries(entries)) {
    normalized.set(id, {
      at: entry.at,
      source: normalizeSource(
        entry.url != null ? { kind: 'http', url: entry.url, headers: entry.headers }
        : entry.path != null ? { kind: 'file', path: entry.path }
        : { kind: 'inline', data: entry.inline },
      ),
      unwrap: entry.unwrap,
      cache: entry.cache === 'manual' || entry.cache == null ? { kind: 'manual' }
        : entry.cache.mtime ? { kind: 'mtime' }
        : { kind: 'ttl', ttlMs: entry.cache.ttlMs },
      timeoutMs: entry.timeoutMs,
      retry: entry.retry,
    });
  }

  // I6, enumerated exactly as the contract enumerates it: ttl/clock and jitter/rng only.
  for (const [id, n] of normalized) {
    if (n.cache.kind === 'ttl' && !ports.clock) {
      throw new Error(`createJsonLoader: source '${id}' declares a ttl cache policy and no clock port was supplied`);
    }
    if (n.retry?.jitter && !ports.rng) {
      throw new Error(`createJsonLoader: source '${id}' declares retry jitter and no rng port was supplied`);
    }
  }

  const cache = ports.cache ?? makeMemoryStore();
  const inflight = new Map();      // 10-design.md §5: keyed by cache key
  const generations = new Map();   // 10-design.md §5: "each cache key carries a generation counter"
  const written = new Set();       // charitable shadow of the keys this loader has stored
  const watchers = [];             // registered; nothing ever unsubscribes them (see probes)
  let hits = 0, misses = 0;

  const genOf = (key) => generations.get(key) ?? 0;

  function bump(key) {
    generations.set(key, genOf(key) + 1);
  }

  function invalidate(id) {
    if (id === undefined) {
      // CacheStore declares get/set/delete/clear/size and no way to enumerate keys, so the
      // most an implementation can bump is what it knows it wrote itself.
      for (const key of written) bump(key);
      written.clear();
      cache.clear();
      return;
    }
    bump(id);
    written.delete(id);
    cache.delete(id);
  }

  async function load(request) {
    const id = request?.id;
    const key = id; // D12: the source id is the only identity, and the only cache key.

    // 1. Resolve.
    const declared = normalized.get(id);
    const source = request?.source != null ? normalizeSource(request.source) : declared?.source;
    if (!id || !source || !source.kind) {
      return fail(request, 'json.unresolved', `no source declared for id '${id}'`, {
        // AMBIGUOUS: JsonMeta.provider is 'http' | 'file' | 'inline'. Nothing resolved, so
        // there is no member to use. Emitted as undefined so the probe can see it.
        provider: undefined, location: '',
      });
    }
    const location = locationOf(source);
    const policy = request.cache === false ? false : request.cache ?? declared?.cache ?? { kind: 'manual' };
    const unwrap = request.unwrap ?? declared?.unwrap ?? 'none';

    // 2. Cache lookup.
    if (policy !== false) {
      const entry = cache.get(key);
      if (entry && entry.meta.location === location && policyHits(entry, policy, source, ports)) {
        hits++;
        const meta = {
          ...entry.meta,
          id,
          cached: true,
          attempts: 0,        // 10-design.md §1.3: a cache hit reports attempts: 0
          validated: false,
        };
        return finishValidate(request, entry.data, meta);
      }
    }
    misses++;

    // 3. Join or start.
    if (inflight.has(key)) {
      const shared = await inflight.get(key);
      // The joiner gets the starter's transport outcome wholesale, including its meta.
      return finishValidate(request, shared.data, { ...shared.meta, id, cached: false });
    }

    const startedGeneration = genOf(key);
    const run = (async () => {
      const state = { attempts: 0 };
      let body, inlineValue;

      // 4. Transport.
      if (source.kind === 'inline') {
        inlineValue = source.data;
      } else if (source.kind === 'http') {
        if (!ports.fetch) return { fail: 'json.transport', message: 'no fetch port', state };
        const out = await transportHttp(source, request, declared, ports, state);
        if (out.fail) return { ...out, state };
        body = out.body;
      } else {
        if (!ports.fs) return { fail: 'json.transport', message: 'no fs port', state };
        state.attempts = 1;
        try {
          body = await ports.fs.read(source.path);
        } catch (e) {
          const notFound = e && (e.code === 'ENOENT' || /not exist|ENOENT/i.test(String(e.message)));
          return { fail: notFound ? 'json.notFound' : 'json.transport', message: String(e.message ?? e), state };
        }
      }

      // 5. Decode and parse.
      let parsed;
      if (source.kind === 'inline') {
        parsed = inlineValue;
        state.bytes = 0;
      } else {
        state.bytes = utf8Length(body);
        // NOTE: nothing anywhere bounds state.bytes. See probe F8.
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          return { fail: 'json.parse', message: String(e.message ?? e), state };
        }
      }

      // 6. Unwrap.
      let value;
      try {
        value = applyUnwrap(parsed, unwrap);
      } catch (e) {
        return { fail: 'json.schema', message: String(e.message ?? e), state };
      }

      // 7. Digest, freeze, store.
      const digest = request.digest ? digestOf(value) : null;
      const frozen = deepFreeze(value);
      const meta = {
        id, provider: source.kind, location,
        bytes: state.bytes ?? 0, digest,
        cached: false, attempts: state.attempts, validated: false,
      };
      if (policy !== false && genOf(key) === startedGeneration) {
        cache.set(key, {
          data: frozen, meta,
          storedAt: ports.clock ? ports.clock() : null,
          stamp: policy.kind === 'mtime' ? await stampOf(source, ports) : null,
        });
        written.add(key);
      }
      return { data: frozen, meta, state };
    })();

    inflight.set(key, run);
    let outcome;
    try {
      outcome = await run;
    } finally {
      inflight.delete(key);
    }

    if (outcome.fail) {
      return fail(request, outcome.fail, outcome.message, {
        provider: source.kind, location, attempts: outcome.state.attempts, bytes: outcome.state.bytes ?? 0,
      });
    }
    return finishValidate(request, outcome.data, { ...outcome.meta });
  }

  // 8. Validate, per call, against the shared value.
  function finishValidate(request, data, meta) {
    if (!request.validate) {
      const result = { ok: true, reason: 'json.ok', data, meta: { ...meta, validated: false } };
      emit(request, result);
      return result;
    }
    let verdict;
    try {
      verdict = request.validate(data);
    } catch (e) {
      return fail(request, 'json.schema', `validator threw: ${String(e.message ?? e)}`, meta);
    }
    if (!verdict?.ok) {
      return fail(request, 'json.schema', verdict?.message ?? 'validator returned not-ok', meta);
    }
    const result = {
      ok: true, reason: 'json.ok',
      data: deepFreeze(verdict.value),
      meta: { ...meta, validated: true },
    };
    emit(request, result);
    return result;
  }

  function fail(request, reason, message, metaParts) {
    const result = {
      ok: false, reason, message,
      data: request && 'fallback' in request ? request.fallback : null,
      meta: {
        id: request?.id, provider: undefined, location: '',
        bytes: 0, digest: null, cached: false, attempts: 0, validated: false,
        ...metaParts,
      },
    };
    emit(request, result);
    return result;
  }

  function emit(request, result) {
    ports.log?.({ id: result.meta.id, phase: 'resolve', reason: result.reason, meta: result.meta });
  }

  async function transportHttp(source, request, declared, ports, state) {
    const retry = request.retry ?? declared?.retry ?? { attempts: 1, delayMs: 0 };
    const timeoutMs = request.timeoutMs ?? declared?.timeoutMs ?? 10_000;
    let last = null;
    for (let n = 1; n <= Math.max(1, retry.attempts); n++) {
      state.attempts = n;
      try {
        // No `redirect:` mode is specified anywhere in the contract or design. See probe F9.
        const res = await withTimeout(
          ports.fetch(source.url, { headers: source.headers }),
          timeoutMs, ports,
        );
        if (!res.ok) {
          last = { fail: 'json.status', message: `upstream responded ${res.status}` };
          if (RETRYABLE_STATUS(res.status) && n < retry.attempts) { await backoff(retry, n, ports); continue; }
          return last;
        }
        return { body: await res.text() };
      } catch (e) {
        last = { fail: e?.__timeout ? 'json.timeout' : 'json.transport', message: String(e?.message ?? e) };
        if (n < retry.attempts) { await backoff(retry, n, ports); continue; }
        return last;
      }
    }
    return last ?? { fail: 'json.transport', message: 'no attempt was made' };
  }

  async function backoff(retry, attemptJustMade, ports) {
    let ms = retry.backoff === 'exponential' ? retry.delayMs * 2 ** (attemptJustMade - 1) : retry.delayMs;
    if (retry.jitter && ports.rng) ms = ms * (0.5 + ports.rng() / 2);
    if (ms > 0 && ports.schedule) await ports.schedule(ms);
  }

  return {
    load,
    loadById: (id) => load({ id, ...synthesize(normalized.get(id)) }),
    loadMany: async (ids) => {
      // 10-design.md §5 bounds only preload and prefetch. This fan-out is caller-sized.
      const results = await Promise.all(ids.map((id) => load({ id, ...synthesize(normalized.get(id)) })));
      return Object.fromEntries(ids.map((id, i) => [id, results[i]]));
    },
    preload: async (ids) => {
      const results = await Promise.all(ids.map((id) => load({ id, ...synthesize(normalized.get(id)) })));
      const failed = ids.filter((_, i) => !results[i].ok);
      if (failed.length) {
        // The only rejecting member, and it rejects with a formatted string. See probe F6.
        throw new Error(
          `preload failed for ${failed.length} source(s): ` +
          failed.map((id, i) => `${id} (${results[ids.indexOf(id)].reason})`).join(', '),
        );
      }
    },
    invalidate,
    stats: () => ({ entries: cache.size, hits, misses }),

    // Harness-only introspection. Not part of the contract.
    __watchers: watchers,
    __registerWatch(id, path) {
      if (!ports.fs?.watch) return;
      // Nothing in JsonLoader can ever call the returned unsubscribe. See probe F4.
      watchers.push({ id, path, unsubscribe: ports.fs.watch(path, () => invalidate(id)) });
    },
    __cache: cache,
  };
}

function synthesize(n) {
  if (!n) return {};
  return { source: n.source, at: n.at, unwrap: n.unwrap, cache: n.cache, timeoutMs: n.timeoutMs, retry: n.retry };
}

function applyUnwrap(parsed, unwrap) {
  if (unwrap === 'none' || unwrap == null) return parsed;
  if (typeof unwrap === 'function') return unwrap(parsed);
  if (unwrap === 'subzerodev') {
    // AMBIGUOUS: 10-design.md §4.1 defines only "declared envelope absent -> json.schema".
    // An envelope that is PRESENT and reports failure is undefined. This is the shape check
    // an implementer writes from the design as it stands. See probe F12.
    if (parsed === null || typeof parsed !== 'object' || !('success' in parsed)) {
      throw new Error('declared envelope absent');
    }
    return parsed.data;
  }
  throw new Error(`unknown unwrap mode ${String(unwrap)}`);
}

function policyHits(entry, policy, source, ports) {
  if (policy.kind === 'manual') return true;                 // always, until invalidated
  if (policy.kind === 'ttl') {
    if (!ports.clock || entry.storedAt == null) return false;
    return ports.clock() - entry.storedAt < policy.ttlMs;
  }
  if (policy.kind === 'mtime') {
    if (!entry.stamp) return false;                          // AMBIGUOUS: see probe F15(c)
    const now = ports.fs?.__statSync?.(source.path);
    if (!now) return false;
    return now.mtimeMs === entry.stamp.mtimeMs && now.size === entry.stamp.size;
  }
  return false;
}

async function stampOf(source, ports) {
  if (source.kind !== 'file' || !ports.fs?.stat) return null;
  try {
    // AMBIGUOUS: the design never says whether the stamp is taken before or after the read.
    // Taken after, as the more charitable of the two. See probe F15(b).
    return await ports.fs.stat(source.path);
  } catch {
    return null;
  }
}

export function makeMemoryStore() {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => void m.set(k, v),
    delete: (k) => void m.delete(k),
    clear: () => m.clear(),
    get size() { return m.size; },
  };
}
