import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonLoader, JsonMeta, JsonResult, SourceId } from '../core/index.js';
import { useJsonLoaderContext } from './context.js';

function pendingMeta(id: SourceId): JsonMeta {
  return {
    id,
    provider: 'none',
    location: '',
    bytes: 0,
    digest: null,
    cached: false,
    attempts: 0,
    validated: false,
  };
}

/** The `loading`-only placeholder shown before the first `loadById` for `id` has settled. */
function pendingResult<T>(id: SourceId): JsonResult<T> {
  return {
    ok: false,
    reason: 'json.unresolved',
    message: 'loading',
    data: null,
    meta: pendingMeta(id),
  };
}

interface JsonState<T> {
  readonly id: SourceId;
  readonly loader: JsonLoader;
  readonly result: JsonResult<T>;
  readonly loading: boolean;
}

function initialState<T>(id: SourceId, loader: JsonLoader): JsonState<T> {
  return { id, loader, result: pendingResult<T>(id), loading: true };
}

/**
 * §9 `/react`. Reads `id` from the nearest `JsonProvider` (I39). J4.4: unmounting — or `id`
 * or the provider's loader changing before the in-flight call settles — discards that call's
 * result instead of committing it; `JsonLoader.loadById` (§9) exposes no cancellation token,
 * so the underlying request is not aborted, only the update is suppressed (D55).
 */
export function useJson<T>(id: SourceId): JsonResult<T> & { readonly loading: boolean; refetch(): Promise<void> } {
  const loader = useJsonLoaderContext();
  const [state, setState] = useState<JsonState<T>>(() => initialState<T>(id, loader));
  const generation = useRef(0);

  const run = useCallback(
    (keepStale: boolean) => {
      const thisGeneration = ++generation.current;
      setState((prev) => ({
        id,
        loader,
        result: keepStale && prev.id === id && prev.loader === loader ? prev.result : pendingResult<T>(id),
        loading: true,
      }));
      return loader.loadById<T>(id).then((result) => {
        if (thisGeneration !== generation.current) return; // unmounted, or superseded by a newer call
        setState({ id, loader, result, loading: false });
      });
    },
    [loader, id],
  );

  useEffect(() => {
    void run(false);
    return () => {
      generation.current++; // J4.4: discard whatever this effect's call resolves with
    };
  }, [run]);

  const refetch = useCallback(() => run(true), [run]);

  // `id` or `loader` can change between this render and the effect above committing its
  // reset — derive the pending placeholder here too so that render never shows a prior
  // (id, loader) pair's result under the new one (the one-commit staleness a review caught).
  const current = state.id === id && state.loader === loader ? state : initialState<T>(id, loader);

  return { ...current.result, loading: current.loading, refetch };
}
