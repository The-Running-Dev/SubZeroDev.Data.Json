import { readFile, stat as fsStat, watch as fsWatch } from 'node:fs/promises';
import type { FileSystemPort } from '../core/index.js';

/** `20-contract.md` §9. Backed by the real Node filesystem; read-only (D19). */
export function nodeFileSystem(): FileSystemPort {
  return {
    async read(path: string): Promise<string> {
      return readFile(path, 'utf8');
    },

    async stat(path: string): Promise<{ readonly mtimeMs: number; readonly size: number }> {
      const s = await fsStat(path);
      return { mtimeMs: s.mtimeMs, size: s.size };
    },

    watch(path: string, onChange: () => void): () => void {
      const controller = new AbortController();

      (async () => {
        try {
          const watcher = fsWatch(path, { signal: controller.signal });
          for await (const event of watcher) {
            void event;
            onChange();
          }
        } catch {
          // Aborted via unsubscribe, or the watched path went away — either way there is
          // nothing left to report through onChange.
        }
      })();

      return () => controller.abort();
    },
  };
}
