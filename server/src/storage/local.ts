import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type {
  StorageProvider,
  PutOptions,
  PutResult,
  ByteRange,
  GetResult,
  QuotaInfo,
} from './provider';
import { newId } from '../util/ids';

export interface LocalConfig {
  /** Absolute directory this backend owns. Each stored object is a file directly inside it. */
  root: string;
  /** Simulated capacity in bytes (local disk has no inherent per-folder quota). */
  quotaBytes: number;
}

/**
 * Stores each file as an opaque, UUID-named blob inside its own root directory. Usage is
 * computed by summing the blob sizes on disk, so it is self-contained (no DB dependency).
 */
export class LocalProvider implements StorageProvider {
  readonly type = 'local';

  constructor(
    readonly backendId: string,
    private readonly cfg: LocalConfig,
  ) {}

  private absKey(objectKey: string): string {
    const root = path.resolve(this.cfg.root);
    const abs = path.resolve(root, objectKey);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Invalid object key: ${objectKey}`);
    }
    return abs;
  }

  async put(data: Readable, _opts: PutOptions): Promise<PutResult> {
    await fsp.mkdir(this.cfg.root, { recursive: true });
    const objectKey = newId();
    const abs = this.absKey(objectKey);
    await pipeline(data, fs.createWriteStream(abs));
    const stat = await fsp.stat(abs);
    return { objectKey, size: stat.size };
  }

  async get(objectKey: string, range?: ByteRange): Promise<GetResult> {
    const abs = this.absKey(objectKey);
    const stat = await fsp.stat(abs);
    const stream = range
      ? fs.createReadStream(abs, { start: range.start, end: range.end })
      : fs.createReadStream(abs);
    return { stream, size: stat.size };
  }

  async delete(objectKey: string): Promise<void> {
    const abs = this.absKey(objectKey);
    await fsp.rm(abs, { force: true });
  }

  async quota(): Promise<QuotaInfo> {
    let used = 0;
    try {
      const entries = await fsp.readdir(this.cfg.root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          used += (await fsp.stat(path.join(this.cfg.root, entry.name))).size;
        }
      }
    } catch (err) {
      // Root not created yet -> zero usage.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return { total: this.cfg.quotaBytes, used };
  }
}
