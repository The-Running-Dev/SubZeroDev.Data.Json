import { digestOf } from './canonical.js';
import { normalizeSource } from './config.js';
import type { NormalizedEntry } from './config.js';
import type { JsonMeta, JsonRequest, JsonResult, JsonSource, ReasonCode, SourceId } from './types.js';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function locationOf(source: JsonSource): string {
  if (source.kind === 'http') return source.url;
  if (source.kind === 'file') return source.path;
  return '';
}

function emptyMeta(id: SourceId): JsonMeta {
  return {
    id,
    provider: 'none',
    location: '',
    bytes: 0,
    digest: null,
    cached: false,
    attempts: 0,
    validated: false,
  };
}

function fail<T>(
  request: JsonRequest<T>,
  id: SourceId,
  reason: Exclude<ReasonCode, 'json.ok'>,
  message: string,
  meta: JsonMeta,
): JsonResult<T> {
  const hasFallback = 'fallback' in request && request.fallback !== undefined;
  return {
    ok: false,
    reason,
    message,
    data: hasFallback ? deepFreeze(request.fallback as T) : null,
    meta,
  };
}

function applyUnwrap(parsed: unknown, unwrap: NormalizedEntry['unwrap']): unknown {
  if (unwrap === 'none') return parsed;
  if (typeof unwrap === 'function') return unwrap(parsed);
  if (unwrap === 'subzerodev') {
    if (parsed === null || typeof parsed !== 'object' || !('success' in parsed)) {
      throw new Error("declared envelope 'subzerodev' absent");
    }
    const envelope = parsed as { success: boolean; data?: unknown; message?: string };
    if (envelope.success === false) {
      throw new Error(envelope.message ?? "envelope reported 'success: false'");
    }
    return envelope.data;
  }
  throw new Error(`unknown unwrap mode ${String(unwrap)}`);
}

/**
 * The 10-design.md §3.1 pipeline for an `inline` entry only (J1 scope). http and file
 * transport are J10/J12 — the provider branch for them is deliberately absent here rather
 * than stubbed, per 30-slices.md J1's out-of-scope note.
 */
export async function runInlinePipeline<T>(
  request: JsonRequest<T>,
  declared: NormalizedEntry | undefined,
): Promise<JsonResult<T>> {
  const id = request.id;

  // 1. Resolve.
  const source = request.source !== undefined ? normalizeSource(request.source) : declared?.source;
  if (!id || !source) {
    return fail(request, id, 'json.unresolved', `no source declared for id '${id}'`, emptyMeta(id || ''));
  }

  const unwrap = declared?.unwrap ?? 'none';
  const location = locationOf(source);

  if (source.kind !== 'inline') {
    // Out of scope for J1 (30-slices.md): the http/file provider branches belong to J12/J10.
    throw new Error(
      `runInlinePipeline: source '${id}' is '${source.kind}', which J1 does not implement (see J10/J12)`,
    );
  }

  // 4. Transport. inline makes no attempt at all.
  const parsed = source.data;

  // 6. Unwrap. 'none' is the default and returns the parsed body exactly as parsed.
  let value: unknown;
  try {
    value = applyUnwrap(parsed, unwrap);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(request, id, 'json.schema', message, {
      id,
      provider: 'inline',
      location,
      bytes: 0,
      digest: null,
      cached: false,
      attempts: 0,
      validated: false,
    });
  }

  // 7. Digest, freeze.
  const digest = request.digest ? digestOf(value) : null;
  const frozen = deepFreeze(value);
  const baseMeta: JsonMeta = {
    id,
    provider: 'inline',
    location,
    bytes: 0,
    digest,
    cached: false,
    attempts: 0,
    validated: false,
  };

  // 8. Validate. Per call, against the value.
  if (!request.validate) {
    return { ok: true, reason: 'json.ok', data: frozen as T, meta: baseMeta };
  }
  let verdict;
  try {
    verdict = request.validate(frozen);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(request, id, 'json.schema', `validator threw: ${message}`, baseMeta);
  }
  if (!verdict.ok) {
    return fail(request, id, 'json.schema', verdict.message, { ...baseMeta, validated: false });
  }
  return {
    ok: true,
    reason: 'json.ok',
    data: deepFreeze(verdict.value),
    meta: { ...baseMeta, validated: true },
  };
}
