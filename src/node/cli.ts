#!/usr/bin/env node
import { convertYamlToJson } from './yaml.js';

/**
 * The CLI half of J2.3 — the entry point `Data/build.ts` calls instead of its own
 * `processYamlToJson` (J8.1). It is a thin wrapper on purpose: the conversion, and every
 * behaviour J8.2 pins, lives in `convertYamlToJson`, so the CLI adds argument handling and
 * a summary line and nothing else.
 *
 * `20-contract.md` §9 declares the function, not the executable, so the command name and
 * its output are this module's own and not a contract surface.
 */
async function main(argv: readonly string[]): Promise<number> {
  const [from, to] = argv;

  if (from === undefined || to === undefined) {
    console.error('Usage: data-json-yaml <from-dir> <to-dir>');

    return 2;
  }

  const converted = await convertYamlToJson(from, to);

  console.log(`[INFO] YAML to JSON Conversion Completed: ${converted} File(s) Processed`);

  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);

    process.exitCode = 1;
  }
);
