import type { JsonErrorCode, JsonFailure } from './types.js';

/**
 * The only thing this package throws or rejects with (I24). `failures` is empty for every
 * `config.*` code — those name one entry inline in `message` instead.
 */
export class JsonError extends Error {
  readonly code: JsonErrorCode;
  readonly failures: readonly JsonFailure[];

  constructor(code: JsonErrorCode, message: string, failures: readonly JsonFailure[] = []) {
    super(message);
    this.name = 'JsonError';
    this.code = code;
    this.failures = failures;
  }
}
