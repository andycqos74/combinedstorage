import express, { Router } from 'express';
import { config } from '../config';
import { asyncHandler } from '../util/asyncHandler';
import { ROOT_ID, type NodeRow } from '../models/nodes';
import * as files from '../services/files';
import * as chunks from '../services/chunks';
import { newId } from '../util/ids';
import { BadRequestError } from '../util/errors';

export const filesRouter = Router();
const json = express.json();

/** Serialize a node row for the API, attaching the public CDN URL for files. */
export function toDto(node: NodeRow) {
  return {
    id: node.id,
    parentId: node.parent_id,
    name: node.name,
    type: node.type,
    path: node.path,
    size: node.size,
    mimeType: node.mime_type,
    url:
      node.type === 'file' && node.public_token
        ? `${config.publicBaseUrl}/f/${node.public_token}`
        : null,
    alias: node.alias,
    aliasUrl:
      node.type === 'file' && node.alias ? `${config.publicBaseUrl}/f/${node.alias}` : null,
    createdAt: node.created_at,
    updatedAt: node.updated_at,
  };
}

// List a folder (children + breadcrumb). Use "root" for the top level.
filesRouter.get(
  '/:folderId',
  asyncHandler(async (req, res) => {
    const folderId = req.params.folderId || ROOT_ID;
    const { folder, children } = files.listFolder(folderId);
    res.json({
      folder: toDto(folder),
      breadcrumb: files.breadcrumb(folderId),
      children: children.map(toDto),
    });
  }),
);

// Create a folder.
filesRouter.post(
  '/:parentId/folders',
  json,
  asyncHandler(async (req, res) => {
    const node = files.createFolder(req.params.parentId, String(req.body?.name ?? ''));
    res.status(201).json(toDto(node));
  }),
);

// Upload a file: raw request body is the file content; name comes from the query string,
// size from Content-Length, and mime from Content-Type. (No JSON parser on this route.)
filesRouter.post(
  '/:parentId/upload',
  asyncHandler(async (req, res) => {
    const name = String(req.query.name ?? '');
    const size = Number(req.headers['content-length'] ?? 0);
    const contentType = req.headers['content-type'];
    const node = await files.uploadFile({
      parentId: req.params.parentId,
      name,
      stream: req,
      size: Number.isFinite(size) ? size : 0,
      mimeType: typeof contentType === 'string' ? contentType : undefined,
    });
    res.status(201).json(toDto(node));
  }),
);

// ---- chunked upload (large files) ----
// The browser splits a big file into chunks and sends each as its own request, so no single
// request exceeds a proxy's body cap (e.g. Cloudflare's ~100 MB). Chunks are staged on disk and
// assembled on completion, at which point the engine sees the true total size for placement.

// Open an upload session; returns the id to send chunks against and the chunk size to use.
filesRouter.post(
  '/:parentId/upload-init',
  asyncHandler(async (req, res) => {
    files.listFolder(req.params.parentId); // 404s if the parent folder is missing
    const uploadId = newId();
    await chunks.createSession(uploadId);
    res.status(201).json({ uploadId, chunkSize: config.uploadChunkSize });
  }),
);

// Store one chunk at a byte offset (raw request body).
filesRouter.put(
  '/upload-chunk/:uploadId',
  asyncHandler(async (req, res) => {
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isFinite(offset) || offset < 0) throw new BadRequestError('Invalid chunk offset.');
    // Name chunks by zero-padded offset so they assemble in ascending order.
    await chunks.writeChunk(req.params.uploadId, String(offset).padStart(15, '0'), req);
    res.status(204).end();
  }),
);

// Assemble the staged chunks into a real file, then clear the staging area.
filesRouter.post(
  '/:parentId/upload-complete/:uploadId',
  json,
  asyncHandler(async (req, res) => {
    const { parentId, uploadId } = req.params;
    try {
      const { paths, totalSize } = await chunks.sessionParts(uploadId);
      if (paths.length === 0) throw new BadRequestError('No chunks were uploaded.');
      const node = await files.uploadFile({
        parentId,
        name: String(req.body?.name ?? ''),
        stream: chunks.concatStream(paths),
        size: totalSize,
        mimeType: req.body?.mimeType || undefined,
      });
      res.status(201).json(toDto(node));
    } finally {
      await chunks.destroySession(uploadId);
    }
  }),
);

// Abandon an upload session (e.g. the user cancelled).
filesRouter.delete(
  '/upload-chunk/:uploadId',
  asyncHandler(async (req, res) => {
    await chunks.destroySession(req.params.uploadId);
    res.status(204).end();
  }),
);

// Rename a file or folder.
filesRouter.patch(
  '/:id/rename',
  json,
  asyncHandler(async (req, res) => {
    const node = files.rename(req.params.id, String(req.body?.name ?? ''));
    res.json(toDto(node));
  }),
);

// Move a file or folder into another folder.
filesRouter.patch(
  '/:id/move',
  json,
  asyncHandler(async (req, res) => {
    const node = files.move(req.params.id, String(req.body?.parentId ?? ''));
    res.json(toDto(node));
  }),
);

// Delete a file or folder (recursively).
filesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await files.remove(req.params.id);
    res.json({ ok: true });
  }),
);

// ---- friendly aliases ----

// Suggest a unique friendly alias for a file (does not persist it).
filesRouter.get(
  '/:id/alias/suggest',
  asyncHandler(async (req, res) => {
    res.json(files.suggestAlias(req.params.id));
  }),
);

// Set or replace a file's friendly alias.
filesRouter.put(
  '/:id/alias',
  json,
  asyncHandler(async (req, res) => {
    const node = files.setAlias(req.params.id, String(req.body?.alias ?? ''));
    res.json(toDto(node));
  }),
);

// Remove a file's friendly alias.
filesRouter.delete(
  '/:id/alias',
  asyncHandler(async (req, res) => {
    res.json(toDto(files.clearAlias(req.params.id)));
  }),
);
