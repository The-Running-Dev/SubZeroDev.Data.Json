import type { ReactElement, ReactNode } from 'react';
import type { SourceId } from '../core/index.js';
import { useJson } from './use-json.js';

/**
 * §9 `/react`. Branches on `loading` and `ok`/`reason` only (J4.2) — `.message` is never read,
 * so a change to that human-facing string cannot change what renders. `children` mounts once
 * loading has finished and the load succeeded; `fallback` covers every other state, loading and
 * error alike, since the signature gives this component no separate error slot.
 */
export function JsonBoundary(props: { readonly id: SourceId; readonly fallback?: ReactNode; readonly children: ReactNode }): ReactElement {
  const result = useJson(props.id);
  if (result.loading || !result.ok) {
    return <>{props.fallback ?? null}</>;
  }
  return <>{props.children}</>;
}
