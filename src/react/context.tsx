import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { JsonLoader } from '../core/index.js';
import { JsonError } from '../core/index.js';

export interface JsonProviderProps {
  readonly loader: JsonLoader;
  readonly children: ReactNode;
}

const JsonLoaderContext = createContext<JsonLoader | null>(null);

/**
 * Supplies the loader read by every hook and boundary below it (§9, I39). Accepts one; never
 * constructs one, and never disposes it on unmount — disposal stays with whoever created it
 * (D31). Nesting resolves to the nearest provider, which keeps each loader's cache boundary
 * (§5) intact under React.
 */
export function JsonProvider({ loader, children }: JsonProviderProps): ReactElement {
  return <JsonLoaderContext.Provider value={loader}>{children}</JsonLoaderContext.Provider>;
}

/** I39: no module-level default, no ambient singleton, no fallback loader. */
export function useJsonLoaderContext(): JsonLoader {
  const loader = useContext(JsonLoaderContext);
  if (loader === null) {
    throw new JsonError('config.missingProvider', 'useJson/JsonBoundary rendered with no JsonProvider above them');
  }
  return loader;
}
