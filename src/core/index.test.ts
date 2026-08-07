import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('core index (20-contract.md §9)', () => {
  it('does not export canonicalize, digestOf, or sha256Hex — §9 declares none of them', () => {
    expect('canonicalize' in core).toBe(false);
    expect('digestOf' in core).toBe(false);
    expect('sha256Hex' in core).toBe(false);
  });
});
