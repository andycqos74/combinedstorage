import express, { Router } from 'express';
import { config } from '../config';
import { asyncHandler } from '../util/asyncHandler';
import { ROOT_ID, type NodeRow } from '../models/nodes';
import * as files from '../services/files';

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
