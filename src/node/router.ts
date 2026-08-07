import type { JsonLoader, ReasonCode, SourceId } from '../core/index.js';
import { envelope } from './envelope.js';

/** Structural, so /node depends on no web framework. Compatible with an Express handler. */
export type JsonRouteHandler = (
  req: { readonly method: string; readonly params: Readonly<Record<string, string>> },
  res: { status(code: number): { json(body: unknown): void } },
  next: (err?: unknown) => void,
) => void;

/** I28, D20: never the upstream status. `json.tooLarge` joins the 502 row per D33. */
const STATUS_BY_REASON: Readonly<Record<Exclude<ReasonCode, 'json.ok'>, number>> = {
  'json.unresolved': 404,
  'json.notFound': 404,
  'json.timeout': 504,
  'json.transport': 504,
  'json.status': 502,
  'json.parse': 502,
  'json.schema': 502,
  'json.tooLarge': 502,
};

/** `20-contract.md` §9. GET only (`00-brief.md` §5.1) — no other verb is reachable through it. */
export function jsonRouter(loader: JsonLoader, ids: readonly SourceId[]): JsonRouteHandler {
  const known = new Set(ids);

  return (req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    const id = req.params['id'];
    if (id === undefined || !known.has(id)) {
      next();
      return;
    }

    loader.loadById(id).then(
      (result) => {
        if (result.ok) {
          res.status(200).json(envelope(result.data));
        } else {
          res.status(STATUS_BY_REASON[result.reason]).json({ success: false, error: result.message });
        }
      },
      (err: unknown) => next(err),
    );
  };
}
