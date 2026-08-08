// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createJsonLoader, JsonError } from '../core/index.js';
import type { JsonLoader, JsonMeta, JsonResult, SourceMap } from '../core/index.js';
import { JsonBoundary } from './json-boundary.js';
import { JsonProvider } from './context.js';
import { useJson } from './use-json.js';

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

/**
 * A loader whose `loadById` stays pending until `resolveNext` releases it — the same
 * controlled-interleaving technique `src/core/http.test.ts`'s `controllableFetch` uses, applied
 * at the loader boundary this leaf actually depends on.
 */
function controllableLoader() {
  const pending: Array<{ id: string; resolve: (r: JsonResult<unknown>) => void }> = [];
  let disposeCalls = 0;
  let calls = 0;

  const loadById = ((id: string) => {
    calls++;
    return new Promise((resolve) => {
      pending.push({ id, resolve: resolve as (r: JsonResult<unknown>) => void });
    });
  }) as JsonLoader['loadById'];

  const loader: JsonLoader = {
    load: vi.fn(),
    loadById,
    loadMany: vi.fn(),
    preload: vi.fn(),
    invalidate: vi.fn(),
    stats: vi.fn(() => ({ entries: 0, hits: 0, misses: 0 })),
    dispose: () => {
      disposeCalls++;
    },
    [Symbol.dispose]: () => {
      disposeCalls++;
    },
  };

  return {
    loader,
    get calls() {
      return calls;
    },
    get disposeCalls() {
      return disposeCalls;
    },
    get pendingCount() {
      return pending.length;
    },
    resolveNext(result: JsonResult<unknown>) {
      const next = pending.shift();
      if (!next) throw new Error('resolveNext: no pending loadById call');
      next.resolve(result);
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useJson (J4.1)', () => {
  it('returns the loader result plus loading and refetch, not a reshaped type', async () => {
    const c = controllableLoader();
    const wrapper = ({ children }: { children: ReactNode }) => <JsonProvider loader={c.loader}>{children}</JsonProvider>;
    const { result } = renderHook(() => useJson<{ x: number }>('a'), { wrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.ok).toBe(false);
    expect(typeof result.current.refetch).toBe('function');

    const ok: JsonResult<{ x: number }> = { ok: true, reason: 'json.ok', data: { x: 1 }, meta: meta() };
    await act(async () => c.resolveNext(ok));

    expect(result.current.loading).toBe(false);
    expect(result.current).toMatchObject(ok);
  });

  it('refetch calls the loader again and reports the new result', async () => {
    const c = controllableLoader();
    const wrapper = ({ children }: { children: ReactNode }) => <JsonProvider loader={c.loader}>{children}</JsonProvider>;
    const { result } = renderHook(() => useJson<number>('a'), { wrapper });

    await act(async () => c.resolveNext({ ok: true, reason: 'json.ok', data: 1, meta: meta() }));
    expect(c.calls).toBe(1);

    act(() => {
      void result.current.refetch();
    });
    expect(result.current.loading).toBe(true);
    expect(c.calls).toBe(2);

    await act(async () => c.resolveNext({ ok: true, reason: 'json.ok', data: 2, meta: meta() }));
    expect(result.current.loading).toBe(false);
    expect(result.current.ok && result.current.data).toBe(2);
  });
});

describe('useJson / JsonBoundary — no JsonProvider (J4.6)', () => {
  it('useJson throws config.missingProvider, not json.unresolved or a bare Error', () => {
    let caught: unknown;
    try {
      renderHook(() => useJson('a'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(JsonError);
    expect((caught as JsonError).code).toBe('config.missingProvider');
  });

  it('JsonBoundary throws config.missingProvider when rendered with no provider above it', () => {
    let caught: unknown;
    try {
      render(
        <JsonBoundary id="a">
          <div>ok</div>
        </JsonBoundary>,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(JsonError);
    expect((caught as JsonError).code).toBe('config.missingProvider');
  });
});

describe('nested JsonProvider (J4.6)', () => {
  it('resolves to the nearest provider, and two loaders serve their own caches', async () => {
    const outerFetch = vi.fn(async () => new Response(JSON.stringify('outer-value'), { status: 200 }));
    const innerFetch = vi.fn(async () => new Response(JSON.stringify('inner-value'), { status: 200 }));
    const mapFor = (): SourceMap => ({
      version: 1,
      sources: { a: { at: 'runtime', url: 'https://example.test/a', cache: 'manual' } },
    });
    const schedule = (ms: number) => ({ promise: new Promise<void>((r) => setTimeout(r, ms)), cancel: () => {} });
    const outer = createJsonLoader(mapFor(), { fetch: outerFetch, schedule });
    const inner = createJsonLoader(mapFor(), { fetch: innerFetch, schedule });

    function Reader() {
      const r = useJson<string>('a');
      return <div>{r.ok ? r.data : 'loading'}</div>;
    }

    render(
      <JsonProvider loader={outer}>
        <JsonProvider loader={inner}>
          <Reader />
        </JsonProvider>
      </JsonProvider>,
    );

    await screen.findByText('inner-value');
    expect(outerFetch).not.toHaveBeenCalled();
    expect(innerFetch).toHaveBeenCalledTimes(1);
    expect(inner.stats().misses).toBe(1);
    expect(outer.stats().hits + outer.stats().misses).toBe(0);
  });
});

describe('JsonProvider unmount does not dispose the loader (J4.7)', () => {
  it('the loader still reads and was never disposed after JsonProvider unmounts', async () => {
    const c = controllableLoader();
    const { unmount } = render(
      <JsonProvider loader={c.loader}>
        <div>child</div>
      </JsonProvider>,
    );

    unmount();

    expect(c.disposeCalls).toBe(0);
    const pending = c.loader.loadById('a');
    c.resolveNext({ ok: true, reason: 'json.ok', data: null, meta: meta() });
    await expect(pending).resolves.toMatchObject({ ok: true, data: null });
  });
});

describe('useJson unmount discards the in-flight result (J4.4)', () => {
  it('does not commit a result that settles after unmount', async () => {
    const c = controllableLoader();
    const wrapper = ({ children }: { children: ReactNode }) => <JsonProvider loader={c.loader}>{children}</JsonProvider>;
    const { result, unmount } = renderHook(() => useJson<number>('a'), { wrapper });

    unmount();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => c.resolveNext({ ok: true, reason: 'json.ok', data: 1, meta: meta() }));

    // React logs "state update on unmounted component" if the hook committed anyway.
    expect(consoleError).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true); // the hook's last committed state, frozen at unmount
  });

  it("a stale in-flight call from a previous id never overwrites the current id's result", async () => {
    const c = controllableLoader();
    const wrapper = ({ children }: { children: ReactNode }) => <JsonProvider loader={c.loader}>{children}</JsonProvider>;
    const { result, rerender } = renderHook(({ id }: { id: string }) => useJson<string>(id), {
      wrapper,
      initialProps: { id: 'a' },
    });

    rerender({ id: 'b' }); // 'a' call is now stale
    expect(c.pendingCount).toBe(2);

    await act(async () => c.resolveNext({ ok: true, reason: 'json.ok', data: 'stale-a', meta: meta({ id: 'a' }) }));
    expect(result.current.loading).toBe(true); // the stale resolution for 'a' must not land

    await act(async () => c.resolveNext({ ok: true, reason: 'json.ok', data: 'fresh-b', meta: meta({ id: 'b' }) }));
    expect(result.current.loading).toBe(false);
    expect(result.current.ok && result.current.data).toBe('fresh-b');
  });
});

describe('JsonBoundary (J4.2)', () => {
  it('renders fallback while loading, never the raw message string', async () => {
    const c = controllableLoader();
    render(
      <JsonProvider loader={c.loader}>
        <JsonBoundary id="a" fallback="LOADING">
          <div>CHILD</div>
        </JsonBoundary>
      </JsonProvider>,
    );

    expect(screen.getByText('LOADING')).toBeTruthy();
    expect(screen.queryByText('CHILD')).toBeNull();

    await act(async () => c.resolveNext({ ok: true, reason: 'json.ok', data: null, meta: meta() }));
    expect(screen.getByText('CHILD')).toBeTruthy();
  });

  it('renders fallback on a failed result, driven by reason rather than message text', async () => {
    const c = controllableLoader();
    render(
      <JsonProvider loader={c.loader}>
        <JsonBoundary id="a" fallback="FALLBACK">
          <div>CHILD</div>
        </JsonBoundary>
      </JsonProvider>,
    );

    await act(async () =>
      c.resolveNext({
        ok: false,
        reason: 'json.notFound',
        message: 'this string must never be read by JsonBoundary',
        data: null,
        meta: meta(),
      }),
    );

    expect(screen.getByText('FALLBACK')).toBeTruthy();
    expect(screen.queryByText('CHILD')).toBeNull();
    expect(screen.queryByText(/must never be read/)).toBeNull();
  });

  it('renders nothing when no fallback is given and the load fails', async () => {
    const c = controllableLoader();
    const { container } = render(
      <JsonProvider loader={c.loader}>
        <JsonBoundary id="a">
          <div>CHILD</div>
        </JsonBoundary>
      </JsonProvider>,
    );

    await act(async () => c.resolveNext({ ok: false, reason: 'json.parse', message: 'x', data: null, meta: meta() }));

    expect((container as HTMLElement).textContent).toBe('');
  });
});

describe('useJson behaves the same under at: build (inline) and at: runtime (http) (J4.5)', () => {
  it('inline (build-resolved) source', async () => {
    const map: SourceMap = { version: 1, sources: { a: { at: 'build', inline: 'inline-value' } } };
    const loader = createJsonLoader(map);
    const wrapper = ({ children }: { children: ReactNode }) => <JsonProvider loader={loader}>{children}</JsonProvider>;
    const { result } = renderHook(() => useJson<string>('a'), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.ok && result.current.data).toBe('inline-value');
  });

  it('runtime http source, same call site', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify('runtime-value'), { status: 200, headers: { 'content-length': '15' } }),
    );
    const map: SourceMap = {
      version: 1,
      sources: { a: { at: 'runtime', url: 'https://example.test/a', cache: 'manual' } },
    };
    const loader = createJsonLoader(map, {
      fetch: fetchImpl,
      schedule: (ms) => ({ promise: new Promise<void>((r) => setTimeout(r, ms)), cancel: () => {} }),
    });
    const wrapper = ({ children }: { children: ReactNode }) => <JsonProvider loader={loader}>{children}</JsonProvider>;
    const { result } = renderHook(() => useJson<string>('a'), { wrapper });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.ok && result.current.data).toBe('runtime-value');
  });
});
