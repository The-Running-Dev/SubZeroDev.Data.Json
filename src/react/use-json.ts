import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonMeta, JsonResult, SourceId } from '../core/index.js';
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

/**
 * §9 `/react`. Reads `id` from the nearest `JsonProvider` (I39). J4.4: unmounting — or `id`
 * changing before the in-flight call settles — discards that call's result instead of
 * committing it; `JsonRequest` (§3) carries no cancellation token, so nothing is sent to abort,
 * only the update is suppressed.
 */
export function useJson<T>(id: SourceId): JsonResult<T> & { readonly loading: boolean; refetch(): Promise<void> } {
  const loader = useJsonLoaderContext();
  const [state, setState] = useState<{ result: JsonResult<T>; loading: boolean }>(() => ({
    result: pendingResult<T>(id),
    loading: true,
  }));
  const generation = useRef(0);

  const run = useCallback(
    (keepStale: boolean) => {
      const thisGeneration = ++generation.current;
      setState((prev) => ({ result: keepStale ? prev.result : pendingResult<T>(id), loading: true }));
      return loader.loadById<T>(id).then((result) => {
        if (thisGeneration !== generation.current) return; // unmounted, or superseded by a newer call
        setState({ result, loading: false });
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

  return { ...state.result, loading: state.loading, refetch };
}
