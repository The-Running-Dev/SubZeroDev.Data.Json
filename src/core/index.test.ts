import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('core index (20-contract.md §9)', () => {
  it('exports canonicalize and sha256Hex, but keeps digestOf internal', () => {
    expect('canonicalize' in core).toBe(true);
    expect('digestOf' in core).toBe(false);
    expect('sha256Hex' in core).toBe(true);
  });
});
