import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createJsonLoader } from '../core/index.js';
import { zodValidator } from './zod-validator.js';

describe('zodValidator (J5.1)', () => {
  const schema = z.object({ x: z.number() });

  it('returns ok:true with the parsed value on a matching schema', () => {
    const validate = zodValidator(schema);
    const verdict = validate({ x: 1 });
    expect(verdict).toEqual({ ok: true, value: { x: 1 } });
  });

  it('returns ok:false with the zod message on a schema mismatch', () => {
    const validate = zodValidator(schema);
    const verdict = validate({ x: 'not a number' });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok || typeof verdict.message).toBe('string');
    expect(verdict.ok ? '' : verdict.message.length > 0).toBe(true);
  });

  it('catches a schema that throws and reports it the same way as a failed parse', () => {
    const throwing = {
      safeParse: () => {
        throw new Error('boom');
      },
    } as unknown as z.ZodType<unknown>;
    const validate = zodValidator(throwing);
    const verdict = validate({});
    expect(verdict).toEqual({ ok: false, message: 'boom' });
  });

  it("round-trips through the core: a matching payload resolves json.ok", async () => {
    const loader = createJsonLoader({
      version: 1,
      sources: { a: { at: 'build', inline: { x: 1 } } },
    });
    const result = await loader.load({ id: 'a', validate: zodValidator(schema) });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({ x: 1 });
  });

  it("round-trips through the core: a mismatching payload resolves json.schema with the zod message", async () => {
    const loader = createJsonLoader({
      version: 1,
      sources: { a: { at: 'build', inline: { x: 'nope' } } },
    });
    const result = await loader.load({ id: 'a', validate: zodValidator(schema) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('json.schema');
    expect(!result.ok && result.message.length > 0).toBe(true);
  });

  it('round-trips through the core: a throwing schema also resolves json.schema', async () => {
    const throwing = {
      safeParse: () => {
        throw new Error('boom');
      },
    } as unknown as z.ZodType<unknown>;
    const loader = createJsonLoader({
      version: 1,
      sources: { a: { at: 'build', inline: { x: 1 } } },
    });
    const result = await loader.load({ id: 'a', validate: zodValidator(throwing) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('json.schema');
  });
});
