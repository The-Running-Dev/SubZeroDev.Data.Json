import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * I37 — no leaf module imports another leaf. The invariant is enforced by a lint rule, so the
 * test that fails when the invariant is removed (00-brief.md §7.1) has to run the rule against
 * a violating fixture. Asserting only that the real tree is clean would pass with the rule
 * deleted, which is how a guard comes to rest on review while claiming not to (D50).
 */

const eslint = new ESLint();

async function i37Errors(code: string, filePath: string): Promise<readonly string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .map((m) => m.message)
    .filter((m) => m.startsWith('I37:'));
}

describe('I37: leaf modules do not import siblings', () => {
  it('rejects the /build → /node edge D19 forbids', async () => {
    const errors = await i37Errors(
      "import { nodeFileSystem } from '../node/fs.js';\nexport const a = nodeFileSystem;\n",
      'src/build/i37-fixture.ts',
    );
    expect(errors).toHaveLength(1);
  });

  it('rejects a sibling reached by dynamic import', async () => {
    const errors = await i37Errors(
      "export const p = async (): Promise<unknown> => await import('../build/gates.js');\n",
      'src/node/i37-fixture.ts',
    );
    expect(errors).toHaveLength(1);
  });

  it('rejects a sibling reached by re-export', async () => {
    const errors = await i37Errors(
      "export { envelope } from '../node/envelope.js';\n",
      'src/zod/i37-fixture.ts',
    );
    expect(errors).toHaveLength(1);
  });

  it('permits the core edge the star graph is made of', async () => {
    const errors = await i37Errors(
      "import type { JsonPorts } from '../core/index.js';\nexport type A = JsonPorts;\n",
      'src/node/i37-fixture.ts',
    );
    expect(errors).toEqual([]);
  });

  it('permits a declared external dependency', async () => {
    const errors = await i37Errors(
      "import yaml from 'js-yaml';\nexport const y = yaml;\n",
      'src/node/i37-fixture.ts',
    );
    expect(errors).toEqual([]);
  });
});
