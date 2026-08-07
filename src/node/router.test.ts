import { describe, expect, it, vi } from 'vitest';
import type { JsonLoader, JsonMeta, JsonResult, ReasonCode } from '../core/index.js';

type Failure = Extract<JsonResult<unknown>, { readonly ok: false }>;
import { jsonRouter } from './router.js';

function meta(overrides: Partial<JsonMeta> = {}): JsonMeta {
  return {
    id: 'a',
    provider: 'inline',
    location: '',
    bytes: 0,
    digest: null,
    cached: false,
    attempts: 0,
    validated: false,
    ...overrides,
  };
}

function fakeLoader(byId: Record<string, JsonResult<unknown>>): JsonLoader {
  return {
    load: vi.fn(),
    loadById: (async <T>(id: string) => byId[id] as JsonResult<T>) as JsonLoader['loadById'],
    loadMany: vi.fn(),
    preload: vi.fn(),
    invalidate: vi.fn(),
    stats: vi.fn(() => ({ entries: 0, hits: 0, misses: 0 })),
    dispose: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  };
}

function fakeRes() {
  const calls: { status?: number; body?: unknown } = {};
  return {
    res: {
      status(code: number) {
        calls.status = code;
        return {
          json(body: unknown) {
            calls.body = body;
          },
        };
      },
    },
    calls,
  };
}

describe('jsonRouter (J2.4, J2.7)', () => {
  it('serves a known id with the envelope shape on 200', async () => {
    const loader = fakeLoader({ a: { ok: true, reason: 'json.ok', data: { x: 1 }, meta: meta() } });
    const router = jsonRouter(loader, ['a']);
    const { res, calls } = fakeRes();
    const next = vi.fn();

    router({ method: 'GET', params: { id: 'a' } }, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.status).toBe(200);
    expect(calls.body).toEqual({ success: true, data: { x: 1 } });
    expect(next).not.toHaveBeenCalled();
  });

  it('never mounts a write verb — a non-GET request falls through to next()', async () => {
    const loader = fakeLoader({});
    const router = jsonRouter(loader, ['a']);
    const { res, calls } = fakeRes();
    const next = vi.fn();

    router({ method: 'POST', params: { id: 'a' } }, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(calls.status).toBeUndefined();
  });

  it('falls through to next() for an id outside the mounted set', async () => {
    const loader = fakeLoader({});
    const router = jsonRouter(loader, ['a']);
    const { res, calls } = fakeRes();
    const next = vi.fn();

    router({ method: 'GET', params: { id: 'z' } }, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(calls.status).toBeUndefined();
  });

  it.each<[ReasonCode, number]>([
    ['json.unresolved', 404],
    ['json.notFound', 404],
    ['json.timeout', 504],
    ['json.transport', 504],
    ['json.status', 502],
    ['json.parse', 502],
    ['json.schema', 502],
    ['json.tooLarge', 502],
  ])('maps %s to %d, never the upstream status (I28, D20)', async (reason, status) => {
    const loader = fakeLoader({
      a: { ok: false, reason, message: 'boom', data: null, meta: meta() } as Failure,
    });
    const router = jsonRouter(loader, ['a']);
    const { res, calls } = fakeRes();
    const next = vi.fn();

    router({ method: 'GET', params: { id: 'a' } }, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.status).toBe(status);
    expect(next).not.toHaveBeenCalled();
  });
});
