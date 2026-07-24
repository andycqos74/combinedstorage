import type { Readable } from 'node:stream';
import { lookup as mimeLookup } from 'mime-types';
import {
  ROOT_ID,
  type NodeRow,
  getNode,
  getFileByToken,
  getFileByHandle,
  handleInUse,
  setNodeAlias,
  listChildren,
  childByName,
  createFolderNode,
  createFileNode,
  updateNodeNameAndPath,
  updateNodeParentAndPath,
  updateNodePath,
  deleteNodeRow,
  collectSubtree,
} from '../models/nodes';
import { getBackend } from '../models/backends';
import { providerFor } from '../storage/registry';
import type { ByteRange, GetResult } from '../storage/provider';
import { chooseBackend } from './placement';
import { config } from '../config';
import { BadRequestError, NotFoundError } from '../util/errors';

// ---- helpers ---------------------------------------------------------------

function joinPath(parentPath: string, name: string): string {
  return parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
}

/** Reject path separators and control characters; spaces, hyphens and unicode are fine. */
function validateName(raw: string): string {
  const name = (raw ?? '').trim();
  if (!name) throw new BadRequestError('A name is required.');
  if (name.length > 255) throw new BadRequestError('Name is too long (max 255 characters).');
  for (const ch of name) {
    if (ch === '/' || ch === '\\' || ch.charCodeAt(0) < 0x20) {
      throw new BadRequestError('Name may not contain slashes or control characters.');
    }
  }
  if (name === '.' || name === '..') throw new BadRequestError('Invalid name.');
  return name;
}

// ---- friendly aliases ------------------------------------------------------

/** Turn a filename (or user input) into a friendly URL slug, keeping a trailing extension. */
function slugify(input: string): string {
  return (input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-') // anything but alnum/dot -> hyphen
    .replace(/-+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^[-.]+|[-.]+$/g, ''); // trim leading/trailing separators
}

/** Insert a numeric suffix before the extension: "report.pdf" + 2 -> "report-2.pdf". */
function withSuffix(slug: string, n: number): string {
  const dot = slug.lastIndexOf('.');
  return dot > 0 ? `${slug.slice(0, dot)}-${n}${slug.slice(dot)}` : `${slug}-${n}`;
}

/** A unique friendly handle derived from `base`, appending -2, -3, … if needed. */
function uniqueAlias(base: string, exceptId?: string): string {
  const slug = slugify(base) || 'file';
  if (!handleInUse(slug, exceptId)) return slug;
  for (let n = 2; n < 10000; n++) {
    const candidate = withSuffix(slug, n);
    if (!handleInUse(candidate, exceptId)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

/** Normalize a user-supplied alias to a valid slug, or throw with a clear message. */
function normalizeAlias(raw: string): string {
  const slug = slugify(raw);
  if (!slug) {
    throw new BadRequestError('That link has no usable characters — use letters, numbers, dots or hyphens.');
  }
  if (slug.length > 128) throw new BadRequestError('Link is too long (max 128 characters).');
  return slug;
}

function requireFolder(id: string, label = 'Folder'): NodeRow {
  const node = getNode(id);
  if (!node || node.type !== 'folder') throw new NotFoundError(`${label} not found.`);
  return node;
}

function requireFile(id: string): NodeRow {
  const node = getNode(id);
  if (!node || node.type !== 'file') throw new NotFoundError('File not found.');
  return node;
}

/** Rewrite the `path` of every descendant after a folder is renamed or moved. */
function repathDescendants(folderId: string, newFolderPath: string): void {
  for (const child of listChildren(folderId)) {
    const childPath = joinPath(newFolderPath, child.name);
    updateNodePath(child.id, childPath);
    if (child.type === 'folder') repathDescendants(child.id, childPath);
  }
}

// ---- reads -----------------------------------------------------------------

export function listFolder(folderId: string): { folder: NodeRow; children: NodeRow[] } {
  const folder = requireFolder(folderId);
  return { folder, children: listChildren(folderId) };
}

/** Ancestor chain from the root down to (and including) the folder, for breadcrumbs. */
export function breadcrumb(folderId: string): { id: string; name: string }[] {
  const chain: { id: string; name: string }[] = [];
  let cur: NodeRow | undefined = getNode(folderId);
  while (cur) {
    chain.unshift({ id: cur.id, name: cur.id === ROOT_ID ? 'Home' : cur.name });
    cur = cur.parent_id ? getNode(cur.parent_id) : undefined;
  }
  return chain;
}

// ---- mutations -------------------------------------------------------------

export function createFolder(parentId: string, rawName: string): NodeRow {
  const parent = requireFolder(parentId, 'Parent folder');
  const name = validateName(rawName);
  if (childByName(parentId, name)) {
    throw new BadRequestError('An item with that name already exists here.');
  }
  return createFolderNode(parentId, name, joinPath(parent.path, name));
}

/**
 * Stream an upload to the chosen backend, then record the file node. Placement runs on the
 * declared size (accurate Content-Length from the raw-body upload); the stored size is the
 * bytes the provider actually wrote. When AUTO_ALIAS_ON_UPLOAD is on, a friendly alias is
 * generated from the name.
 */
export async function uploadFile(input: {
  parentId: string;
  name: string;
  stream: Readable;
  size: number;
  mimeType?: string;
}): Promise<NodeRow> {
  const parent = requireFolder(input.parentId, 'Parent folder');
  const name = validateName(input.name);
  if (childByName(input.parentId, name)) {
    throw new BadRequestError('An item with that name already exists here.');
  }

  const mimeType = input.mimeType || mimeLookup(name) || 'application/octet-stream';
  const backend = await chooseBackend(input.size);
  const { objectKey, size } = await providerFor(backend).put(input.stream, {
    size: input.size,
    contentType: mimeType,
  });

  const node = createFileNode({
    parentId: input.parentId,
    name,
    path: joinPath(parent.path, name),
    size,
    mimeType,
    backendId: backend.id,
    objectKey,
  });

  if (config.autoAliasOnUpload) {
    setNodeAlias(node.id, uniqueAlias(node.name, node.id));
    return getNode(node.id)!;
  }
  return node;
}

export function rename(id: string, rawName: string): NodeRow {
  const node = getNode(id);
  if (!node) throw new NotFoundError('Item not found.');
  if (node.id === ROOT_ID) throw new BadRequestError('The root folder cannot be renamed.');

  const name = validateName(rawName);
  const parentId = node.parent_id!;
  const clash = childByName(parentId, name);
  if (clash && clash.id !== id) {
    throw new BadRequestError('An item with that name already exists here.');
  }

  const parent = getNode(parentId)!;
  const newPath = joinPath(parent.path, name);
  updateNodeNameAndPath(id, name, newPath);
  if (node.type === 'folder') repathDescendants(id, newPath);
  return getNode(id)!;
}

export function move(id: string, newParentId: string): NodeRow {
  const node = getNode(id);
  if (!node) throw new NotFoundError('Item not found.');
  if (node.id === ROOT_ID) throw new BadRequestError('The root folder cannot be moved.');

  const dest = requireFolder(newParentId, 'Destination folder');
  if (dest.id === node.parent_id) return node; // already there

  if (node.type === 'folder') {
    const subtreeIds = new Set(collectSubtree(id).map((n) => n.id));
    if (subtreeIds.has(newParentId)) {
      throw new BadRequestError('A folder cannot be moved into itself or one of its subfolders.');
    }
  }
  if (childByName(newParentId, node.name)) {
    throw new BadRequestError('An item with that name already exists in the destination.');
  }

  const newPath = joinPath(dest.path, node.name);
  updateNodeParentAndPath(id, newParentId, newPath);
  if (node.type === 'folder') repathDescendants(id, newPath);
  return getNode(id)!;
}

/**
 * Delete a file or a whole folder subtree. Physical bytes are removed from each file's
 * backend first (best-effort — an orphaned blob is harmless since the DB is the source of
 * truth); the row delete then cascades to descendants via ON DELETE CASCADE.
 */
export async function remove(id: string): Promise<void> {
  const node = getNode(id);
  if (!node) throw new NotFoundError('Item not found.');
  if (node.id === ROOT_ID) throw new BadRequestError('The root folder cannot be deleted.');

  for (const n of collectSubtree(id)) {
    if (n.type === 'file' && n.backend_id && n.object_key) {
      const backend = getBackend(n.backend_id);
      if (!backend) continue;
      try {
        await providerFor(backend).delete(n.object_key);
      } catch {
        // Leave the DB delete to proceed; a stray blob will not corrupt the tree.
      }
    }
  }
  deleteNodeRow(id);
}

// ---- friendly-alias operations ---------------------------------------------

/** A unique alias suggestion for a file (does not persist it) plus its current alias. */
export function suggestAlias(id: string): { suggestion: string; currentAlias: string | null } {
  const node = requireFile(id);
  return { suggestion: uniqueAlias(node.name, node.id), currentAlias: node.alias };
}

/** Set (or replace) a file's friendly alias. Throws if the normalized slug is already taken. */
export function setAlias(id: string, rawAlias: string): NodeRow {
  const node = requireFile(id);
  const alias = normalizeAlias(rawAlias);
  if (handleInUse(alias, node.id)) {
    throw new BadRequestError('That friendly link is already in use — try another.');
  }
  setNodeAlias(id, alias);
  return getNode(id)!;
}

export function clearAlias(id: string): NodeRow {
  requireFile(id);
  setNodeAlias(id, null);
  return getNode(id)!;
}

// ---- serving (used by the CDN endpoint) ------------------------------------

export function fileByToken(token: string): NodeRow | undefined {
  return getFileByToken(token);
}

/** Resolve a public handle (permanent token or friendly alias) to a file. */
export function fileByHandle(handle: string): NodeRow | undefined {
  return getFileByHandle(handle);
}

export async function openFile(node: NodeRow, range?: ByteRange): Promise<GetResult> {
  if (!node.backend_id || !node.object_key) throw new NotFoundError('File has no stored content.');
  const backend = getBackend(node.backend_id);
  if (!backend) throw new NotFoundError('Storage backend for this file is missing.');
  return providerFor(backend).get(node.object_key, range);
}

/** A backend-native direct URL for the file, if its provider offers one (else null). */
export async function directUrl(node: NodeRow): Promise<string | null> {
  if (!node.backend_id || !node.object_key) return null;
  const backend = getBackend(node.backend_id);
  if (!backend) return null;
  const provider = providerFor(backend);
  return provider.getDirectUrl ? provider.getDirectUrl(node.object_key) : null;
}
