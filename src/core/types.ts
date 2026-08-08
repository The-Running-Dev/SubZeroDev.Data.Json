// Exact types from 20-contract.md §1-§7, §10. The contract is authoritative; this file
// transcribes it and adds no member the contract does not name.

// ---------------------------------------------------------------------------------- §1 Result

/** Unique within a source map, and across the public and server maps together (I23). */
export type SourceId = string;

/** Lowercase hex, 64 digits. Produced only by the core's canonical digest (I5). */
export type Digest = `sha256-${string}`;

export type ReasonCode =
  | 'json.ok'
  | 'json.transport'
  | 'json.status'
  | 'json.timeout'
  | 'json.parse'
  | 'json.schema'
  | 'json.notFound'
  | 'json.tooLarge'
  | 'json.unresolved';

export interface JsonMeta {
  readonly id: SourceId;
  readonly provider: 'http' | 'file' | 'inline' | 'none';
  readonly location: string;
  readonly bytes: number;
  readonly digest: Digest | null;
  readonly cached: boolean;
  readonly attempts: number;
  readonly validated: boolean;
}

export type JsonResult<T> =
  | { readonly ok: true; readonly reason: 'json.ok'; readonly data: T; readonly meta: JsonMeta }
  | {
      readonly ok: false;
      readonly reason: Exclude<ReasonCode, 'json.ok'>;
      readonly message: string;
      readonly data: T | null;
      readonly meta: JsonMeta;
    };

// --------------------------------------------------------------------------------- §2 Sources

export type JsonSource =
  | { readonly kind: 'http'; readonly url: string; readonly headers?: Readonly<Record<string, string>> }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'inline'; readonly data: unknown };

/** Sugar accepted in configuration and normalized once, at construction. */
export type SourceSpec = JsonSource | string;

// --------------------------------------------------------------------------------- §3 Request

export type Unwrap = 'none' | 'subzerodev' | ((raw: unknown) => unknown);

/** The value domain the canonical serializer accepts (I35). */
export type CanonicalValue =
  | null
  | boolean
  | string
  | number // finite only; NaN and ±Infinity are rejected
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined }; // undefined-valued keys are filtered

export type Validator<T> = (raw: unknown) =>
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export type CachePolicy =
  | { readonly kind: 'manual' }
  | { readonly kind: 'ttl'; readonly ttlMs: number }
  | { readonly kind: 'mtime' };

export interface RetryPolicy {
  readonly attempts: number;
  readonly delayMs: number;
  readonly backoff?: 'fixed' | 'exponential';
  readonly jitter?: boolean;
}

export interface JsonRequest<T> {
  readonly id: SourceId;
  readonly source?: SourceSpec;
  readonly fallback?: T;
  readonly validate?: Validator<T>;
  readonly cache?: false;
  readonly digest?: boolean;
}

// ----------------------------------------------------------------------------------- §4 Ports

export interface FileSystemPort {
  read(path: string): Promise<string>;
  stat(path: string): Promise<{ readonly mtimeMs: number; readonly size: number }>;
  watch?(path: string, onChange: () => void): () => void;
}

/** A cancellable wait. Cancelling settles nothing; it releases the timer. */
export interface ScheduledWait {
  readonly promise: Promise<void>;
  cancel(): void;
}

export interface CacheEntry {
  readonly data: unknown;
  readonly source: JsonSource;
  readonly location: string;
  readonly bytes: number;
  digest: Digest | null;
  readonly storedAt: number | null;
  readonly stamp: { readonly mtimeMs: number; readonly size: number } | null;
}

export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export interface JsonEvent {
  readonly id: SourceId;
  readonly phase: 'resolve' | 'fetch' | 'parse' | 'unwrap' | 'validate' | 'cache';
  readonly reason: ReasonCode;
  readonly meta: JsonMeta;
}

export interface JsonPorts {
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly fs?: FileSystemPort;
  readonly clock?: () => number;
  readonly rng?: () => number;
  readonly schedule?: (ms: number) => ScheduledWait;
  readonly cache?: CacheStore;
  readonly log?: (event: JsonEvent) => void;
}

// ---------------------------------------------------------------------------------- §5 Loader

export interface JsonLoader {
  load<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
  loadById<T>(id: SourceId): Promise<JsonResult<T>>;
  loadMany(ids: readonly SourceId[]): Promise<Readonly<Record<SourceId, JsonResult<unknown>>>>;

  /** Resolve eagerly. Rejects with JsonError('preload.failed') if any id fails. */
  preload(ids: readonly SourceId[]): Promise<void>;

  invalidate(id?: SourceId): void;
  stats(): { readonly entries: number; readonly hits: number; readonly misses: number };

  /** Unsubscribe every watcher, drop this loader's cache keys. Idempotent. */
  dispose(): void;
  [Symbol.dispose](): void;
}

// --------------------------------------------------------------------------- §6 Configuration

export type HttpCacheSpec = 'manual' | { readonly ttlMs: number };
export type FileCacheSpec = 'manual' | { readonly ttlMs: number } | { readonly mtime: true };

export interface RetrySpec {
  readonly attempts: number;
  readonly delayMs: number;
  readonly backoff?: 'fixed' | 'exponential';
  readonly jitter?: boolean;
}

interface SourceEntryCommon {
  readonly at: 'build' | 'runtime';
  readonly schema?: string;
  readonly unwrap?: Unwrap;
}

export type SourceEntry =
  | (SourceEntryCommon & {
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly cache: HttpCacheSpec;
      readonly timeoutMs?: number;
      readonly retry?: RetrySpec;
      readonly maxBytes?: number;
      readonly path?: never;
      readonly inline?: never;
    })
  | (SourceEntryCommon & {
      readonly path: string;
      readonly cache: FileCacheSpec;
      readonly maxBytes?: number;
      readonly url?: never;
      readonly inline?: never;
    })
  | (SourceEntryCommon & {
      readonly inline: unknown;
      readonly url?: never;
      readonly path?: never;
      readonly cache?: never;
    });

export interface SourceMap {
  readonly version: 1;
  readonly sources: Readonly<Record<SourceId, SourceEntry>>;
}

// -------------------------------------------------------------------------------- §7 Lockfile

export interface JsonLock {
  readonly version: 1;
  readonly sources: Readonly<
    Record<
      SourceId,
      {
        readonly location: string;
        readonly digest: Digest;
        readonly bytes: number;
      }
    >
  >;
}

// --------------------------------------------------------------------- §10 Error semantics

export interface JsonFailure {
  readonly id: SourceId;
  readonly reason: ReasonCode;
  readonly message: string;
}

export type JsonErrorCode =
  | 'config.missingPort'
  | 'config.missingProvider'
  | 'config.invalidEntry'
  | 'config.unreadable'
  | 'config.duplicateId'
  | 'preload.failed'
  | 'build.failed'
  | 'build.serverSourceLeaked';
