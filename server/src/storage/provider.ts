import type { Readable } from 'node:stream';

export interface PutOptions {
  /** Declared byte length (may be advisory; providers return the actual bytes stored). */
  size: number;
  contentType?: string;
}

export interface PutResult {
  /** Opaque handle the provider uses to locate the bytes later (path, item id, S3 key, ...). */
  objectKey: string;
  /** Actual number of bytes stored. */
  size: number;
}

/** Inclusive byte range, matching HTTP Range semantics (bytes=start-end). */
export interface ByteRange {
  start: number;
  end: number;
}

export interface GetResult {
  /** Byte stream. If a range was requested, yields only that slice. */
  stream: Readable;
  /** Total size of the whole object (not the slice). */
  size: number;
  contentType?: string;
}

export interface QuotaInfo {
  total: number;
  used: number;
}

/**
 * The single abstraction every storage backend implements. The rest of the app never
 * knows whether bytes live on local disk, OneDrive, S3, etc. Adding a new backend type
 * = implement this interface and register it in registry.ts.
 */
export interface StorageProvider {
  readonly backendId: string;
  readonly type: string;

  /** Store a stream; the provider chooses and returns the objectKey. */
  put(data: Readable, opts: PutOptions): Promise<PutResult>;

  /** Read a stream, optionally just a byte range (for CDN Range requests). */
  get(objectKey: string, range?: ByteRange): Promise<GetResult>;

  /** Remove the stored bytes. Must not throw if already absent. */
  delete(objectKey: string): Promise<void>;

  /** Current total/used bytes for this backend. */
  quota(): Promise<QuotaInfo>;

  /**
   * Optional: a backend-native URL to serve the bytes directly (e.g. an S3 presigned URL).
   * When present and non-null the CDN endpoint 302-redirects to it instead of proxying.
   */
  getDirectUrl?(objectKey: string): Promise<string | null>;
}
