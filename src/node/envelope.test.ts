import { describe, expect, it } from 'vitest';
import { createJsonLoader } from '../core/index.js';
import { envelope } from './envelope.js';

describe('envelope (J2.5)', () => {
  it('produces the success:true shape', () => {
    expect(envelope({ x: 1 })).toEqual({ success: true, data: { x: 1 } });
  });

  it("round-trips through unwrap: 'subzerodev' — the core reads what /node produces", async () => {
    const loader = createJsonLoader({
      version: 1,
      sources: {
        a: { at: 'build', inline: envelope({ x: 1 }), unwrap: 'subzerodev' },
      },
    });

    const result = await loader.load<{ x: number }>({ id: 'a' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({ x: 1 });
  });
});
