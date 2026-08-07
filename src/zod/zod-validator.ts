import type { ZodType } from 'zod';
import type { Validator } from '../core/types.js';

/** Adapts a zod schema to `Validator<T>` (§9 `/zod`). Never throws (J5.1). */
export function zodValidator<T>(schema: ZodType<T>): Validator<T> {
  return (raw: unknown) => {
    try {
      const result = schema.safeParse(raw);
      if (result.success) {
        return { ok: true, value: result.data };
      }
      return { ok: false, message: result.error.message };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, message };
    }
  };
}
