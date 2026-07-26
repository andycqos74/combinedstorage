import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config';
import { BadRequestError, NotFoundError } from '../util/errors';

/**
 * Staging store for chunked WebDAV uploads (the Nextcloud protocol rclone speaks).
 *
 * A client creates a session directory, PUTs each chunk into it as a separate request, then
 * MOVEs the session's virtual `.file` to the destination. Keeping every request small is what
 * lets large files through proxies that cap request bodies (e.g. Cloudflare's ~100 MB limit) —
 * the file size no longer matters, only the chunk size.
 *
 * Chunks are named `{start}-{end}` (15-digit zero-padded byte offsets) by rclone, so assembly
 * just means concatenating them in ascending start order.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function safeSegment(name: string): string {
  if (!SAFE_SEGMENT.test(name) || name === '.' || name === '..') {
    throw new BadRequestError('Invalid upload session or chunk name.');
  }
  return name;
}

/** Absolute path for a session dir, guarded against escaping the staging root. */
function sessionDir(session: string): string {
  const root = path.resolve(config.chunkRoot);
  const dir = path.resolve(root, safeSegment(session));
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new BadRequestError('Invalid upload session.');
  }
  return dir;
}

function chunkPath(session: string, chunk: string): string {
  return path.join(sessionDir(session), safeSegment(chunk));
}

export async function createSession(session: string): Promise<void> {
  await fsp.mkdir(sessionDir(session), { recursive: true });
}

export function sessionExists(session: string): boolean {
  return fs.existsSync(sessionDir(session));
}

/** Stream one chunk to disk. Returns the bytes written. */
export async function writeChunk(session: string, chunk: string, data: Readable): Promise<number> {
  const dir = sessionDir(session);
  await fsp.mkdir(dir, { recursive: true }); // tolerate a missing MKCOL
  const dest = chunkPath(session, chunk);
  await pipeline(data, fs.createWriteStream(dest));
  return (await fsp.stat(dest)).size;
}

/** Start offset encoded in a chunk name (`000000000000000-000000010485759` -> 0). */
function chunkStart(name: string): number {
  const n = Number(name.split('-')[0]);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Ordered chunk list for a session with the assembled total size. Excludes the virtual
 * `.file` marker the client MOVEs to finalize the upload.
 */
export async function sessionParts(
  session: string,
): Promise<{ paths: string[]; totalSize: number }> {
  const dir = sessionDir(session);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    throw new NotFoundError('Upload session not found.');
  }

  const names = entries.filter((n) => n !== '.file').sort((a, b) => chunkStart(a) - chunkStart(b));
  const paths: string[] = [];
  let totalSize = 0;
  for (const name of names) {
    const p = path.join(dir, name);
    const stat = await fsp.stat(p);
    if (!stat.isFile()) continue;
    paths.push(p);
    totalSize += stat.size;
  }
  return { paths, totalSize };
}

/** A single readable stream that concatenates the chunk files in order (never buffers whole). */
export function concatStream(paths: string[]): Readable {
  return Readable.from(
    (async function* () {
      for (const p of paths) {
        for await (const chunk of fs.createReadStream(p)) {
          yield chunk as Buffer;
        }
      }
    })(),
  );
}

export async function destroySession(session: string): Promise<void> {
  await fsp.rm(sessionDir(session), { recursive: true, force: true });
}

/**
 * Delete upload sessions left behind by aborted transfers (the client never finalized or
 * deleted them). Called at startup so staging space cannot grow without bound.
 */
export async function sweepStaleSessions(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const root = path.resolve(config.chunkRoot);
  let entries: string[];
  try {
    entries = await fsp.readdir(root);
  } catch {
    return 0; // nothing staged yet
  }

  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    const dir = path.join(root, name);
    try {
      const stat = await fsp.stat(dir);
      if (stat.mtimeMs < cutoff) {
        await fsp.rm(dir, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // ignore races with an in-flight upload
    }
  }
  return removed;
}
