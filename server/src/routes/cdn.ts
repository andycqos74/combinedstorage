import { Router } from 'express';
import { asyncHandler } from '../util/asyncHandler';
import * as files from '../services/files';
import type { ByteRange } from '../storage/provider';

export const cdnRouter = Router();

/** Parse a single-range `Range: bytes=start-end` header against a known object size. */
function parseRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, s, e] = match;

  let start: number;
  let end: number;
  if (s === '' && e === '') return null;
  if (s === '') {
    // suffix range: last N bytes
    const n = Number(e);
    if (n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === '' ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

const serve = asyncHandler(async (req, res) => {
  // The handle can be a file's permanent token or its friendly alias.
  const node = files.fileByHandle(req.params.token);
  if (!node) {
    res.status(404).send('Not found');
    return;
  }

  // If the backend can serve the bytes directly (e.g. a presigned URL), redirect to it.
  const direct = await files.directUrl(node);
  if (direct) {
    res.redirect(302, direct);
    return;
  }

  const size = node.size ?? 0;
  const etag = node.public_token ? `"${node.public_token}"` : undefined;

  res.setHeader('Content-Type', node.mime_type || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename="${node.name.replace(/["\r\n]/g, '')}"`);
  if (etag) res.setHeader('ETag', etag);

  if (etag && req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  const range = parseRange(
    typeof req.headers.range === 'string' ? req.headers.range : undefined,
    size,
  );

  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else {
    res.setHeader('Content-Length', String(size));
  }

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const { stream } = await files.openFile(node, range ?? undefined);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

cdnRouter.get('/:token', serve);
cdnRouter.get('/:token/:filename', serve);
cdnRouter.head('/:token', serve);
cdnRouter.head('/:token/:filename', serve);
