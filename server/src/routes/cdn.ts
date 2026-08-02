import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../util/asyncHandler';
import { parseRange } from '../util/range';
import * as files from '../services/files';
import * as images from '../services/images';
import type { NodeRow } from '../models/nodes';

export const cdnRouter = Router();

/**
 * Serve a resized/reformatted rendition of an image, e.g. ?w=800&fmt=webp or ?w=400&h=400.
 * Renditions are rendered once and cached on disk; the cache key includes the file's content
 * version, so editing a file invalidates its variants automatically.
 */
async function serveVariant(
  req: Request,
  res: Response,
  node: NodeRow,
  params: images.VariantParams,
): Promise<void> {
  const version = String(Date.parse(node.updated_at) || 0);
  const cachePath = images.variantCachePath(node.public_token ?? node.id, version, params);
  const mimeType = images.variantMimeType(params, node.mime_type || 'application/octet-stream');

  // A variant's validator must cover both the source version and the requested transform.
  const etag = `"${node.public_token ?? node.id}-${version}-${params.w ?? ''}x${params.h ?? ''}-${params.fit}-${params.fmt ?? ''}-${params.q}"`;
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, no-cache');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  let out = await images.readCachedVariant(cachePath);
  if (!out) {
    const source = await files.readFileBytes(node);
    out = await images.renderVariant(source, params);
    await images.writeCachedVariant(cachePath, out);
  }

  res.setHeader('Content-Length', String(out.length));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(out);
}

const serve = asyncHandler(async (req, res) => {
  // The handle can be a file's permanent token or its friendly alias.
  const node = files.fileByHandle(req.params.token);
  if (!node) {
    res.status(404).send('Not found');
    return;
  }

  // Image renditions are requested with query params; anything else serves the stored file.
  const variant = images.isConvertibleImage(node.mime_type)
    ? images.parseVariantParams(req.query as Record<string, unknown>)
    : null;
  if (variant) {
    await serveVariant(req, res, node, variant);
    return;
  }

  // If the backend can serve the bytes directly (e.g. a presigned URL), redirect to it.
  const direct = await files.directUrl(node);
  if (direct) {
    res.redirect(302, direct);
    return;
  }

  const size = node.size ?? 0;
  const etag = files.fileEtag(node);

  res.setHeader('Content-Type', node.mime_type || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  // Files are mutable (editing replaces the bytes while keeping the URL), so caches must
  // revalidate rather than serve a stale copy for an hour. Revalidation is cheap: an unchanged
  // file answers 304 with no body, and the ETag changes as soon as the content does.
  res.setHeader('Cache-Control', 'public, no-cache');
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
