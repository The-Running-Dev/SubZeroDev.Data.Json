import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { load } from 'js-yaml';

/**
 * `20-contract.md` §9. The conversion behind the CLI, and the one this package exists to
 * take over from `Docs-Template/scripts/pre-build.ts` and `Data/build.ts` (J2.3).
 *
 * Fidelity to those two is the criterion, not improvement on them: `js-yaml` 4.x `load()`
 * on its DEFAULT_SCHEMA, then `JSON.stringify(data, null, 2)` as UTF-8. D41 records why
 * that parser and that schema — in short, DEFAULT_SCHEMA resolves a bare timestamp to a
 * `Date` that serializes ISO-with-milliseconds, and `Docs-Template/config/projects.yml`
 * has 27+ of them, so any YAML 1.2 core-schema parser rewrites published bytes that J8.2
 * requires unchanged. O26 owns whether that coercion deserves to survive.
 *
 * Traversal is recursive and mirrors the source tree, which is `Data/build.ts`'s shape;
 * `Docs-Template`'s flat `config/` is the same walk over a tree one level deep.
 *
 * @param from Directory to read `.yml` and `.yaml` from, recursively.
 * @param to   Directory to write `.json` into, mirroring `from`'s structure.
 * @returns    How many files were converted. A file that failed to parse is not counted.
 */
export async function convertYamlToJson(from: string, to: string): Promise<number> {
  let entries;

  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch {
    // Both converters warn on a missing config directory and carry on rather than failing
    // the build around them. Reproduced, so a repository without one still builds.
    console.warn(`[WARN] Config Directory Not Found: ${from}`);

    return 0;
  }

  await mkdir(to, { recursive: true });

  let converted = 0;

  for (const entry of entries) {
    const source = join(from, entry.name);

    if (entry.isDirectory()) {
      converted += await convertYamlToJson(source, join(to, entry.name));
      continue;
    }

    if (!entry.isFile() || !/\.(yml|yaml)$/.test(entry.name)) continue;

    const target = join(to, entry.name.replace(/\.(yml|yaml)$/, '.json'));

    try {
      const parsed = load(await readFile(source, 'utf-8'));

      await writeFile(target, JSON.stringify(parsed, null, 2), 'utf-8');

      converted++;
    } catch (error) {
      // Known and retained (O27): both converters log the failure, skip the file, and
      // report a count that excludes it — so malformed YAML drops an artifact quietly.
      // Reproducing it is the criterion; changing it is a contract question, since §9
      // returns only a number and has nowhere to put a failure.
      console.error(
        `[ERROR] Failed to Process ${source}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return converted;
}
