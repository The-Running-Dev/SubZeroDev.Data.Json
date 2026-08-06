// Runner. `node harness/run.mjs` — no install, no network, no toolchain.

import { selfTest } from './canonical.mjs';
import probes from './probes.mjs';

const MARK = { true: 'REPRODUCED', false: 'not reproduced', null: 'not testable here' };

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

console.log('\nSubZeroDev.Data.Json — red-team harness');
console.log('Reference implementation of 20-contract.md §1-§5 as written. No network, no clock.\n');

try {
  selfTest();
  console.log('  canonical.mjs self-test: sha256 + key ordering vectors pass\n');
} catch (e) {
  console.error(`  canonical.mjs self-test FAILED: ${e.message}\n`);
  process.exitCode = 1;
}

const selected = only.length ? probes.filter((p) => only.includes(p.id)) : probes;
const results = [];

for (const p of selected) {
  let out;
  try {
    out = await p.fn();
  } catch (e) {
    out = { expected: '(probe threw)', observed: 'error', detail: `${e.stack}` };
  }
  results.push({ ...p, ...out });

  const mark = MARK[String(out.observed)] ?? `ERROR (${out.observed})`;
  console.log(`  [${p.severity.padEnd(10)}] ${p.id.padEnd(4)} ${mark}`);
  console.log(`               ${p.title}`);
  if (verbose || out.observed !== false) {
    console.log(`               expected: ${out.expected}`);
    for (const line of wrap(out.detail, 92)) console.log(`               ${line}`);
  }
  console.log('');
}

const reproduced = results.filter((r) => r.observed === true);
const missed = results.filter((r) => r.observed === false);
const untestable = results.filter((r) => r.observed === null);
const errored = results.filter((r) => r.observed !== true && r.observed !== false && r.observed !== null);

console.log('  ' + '-'.repeat(76));
console.log(`  reproduced ${reproduced.length}   not reproduced ${missed.length}   ` +
            `not testable here ${untestable.length}   probe errors ${errored.length}`);
if (missed.length) console.log(`  not reproduced: ${missed.map((r) => r.id).join(', ')}`);
if (errored.length) {
  console.log(`  probe errors:   ${errored.map((r) => r.id).join(', ')}`);
  process.exitCode = 1;
}
console.log('');

function wrap(text, width) {
  const words = String(text ?? '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
