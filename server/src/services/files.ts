import type { Readable } from 'node:stream';
import { lookup as mimeLookup } from 'mime-types';
import {
  ROOT_ID,
  type NodeRow,
  getNode,
  getOwnedNode,
  getFileByToken,
  getFileByHandle,
  handleInUse,
  setNodeAlias,
  listChildren,
  childByName,
  createFolderNode,
  createFileNode,
  updateFileBlob,
  updateNodeNameAndPath,
  updateNodeParentAndPath,
  updateNodePath,
  deleteNodeRow,
  collectSubtree,
} from '../models/nodes';
import { getBackend } from '../models/backends';
import { getUser } from '../models/users';
import { providerFor } from '../storage/registry';
import type { ByteRange, GetResult } from '../storage/provider';
import { chooseBackend } from './placement';
import { config } from '../config';
import { BadRequestError, NotFoundError } from '../util/errors';
import { Readable as NodeReadable } from 'node:stream';
import { collectStream, convertForUpload, shouldAttemptConversion } from './images';

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

interface IncomingContent {
  stream: Readable;
  size: number;
  name: string;
  mimeType: string;
}

/**
 * Apply the global image rule to incoming bytes before they are placed and stored.
 *
 * Conversion happens here — ahead of chooseBackend — so placement and quota see the real stored
 * size rather than the pre-conversion one. Anything that isn't a convertible image, is too large
 * to buffer, or wouldn't get smaller is passed straight through untouched.
 */
async function applyUploadConversion(
  input: IncomingContent,
  source: 'web' | 'drive' = 'web',
): Promise<IncomingContent> {
  if (source === 'drive' && !config.images.convertOnDrive) return input;
  if (!shouldAttemptConversion(input.mimeType, input.size)) return input;

  const original = await collectStream(input.stream);
  const converted = await convertForUpload(original, input.name, input.mimeType);
  if (!converted) {
    // Unchanged, but the stream is already consumed — hand back the buffered bytes.
    return { ...input, stream: NodeReadable.from(original), size: original.length };
  }
  return {
    stream: NodeReadable.from(converted.buffer),
    size: converted.buffer.length,
    name: converted.name,
    mimeType: converted.mimeType,
  };
}

// ---- ownership -------------------------------------------------------------
// Every operation takes the acting user's id. Nodes owned by someone else resolve exactly like
// missing ones (404), so one user cannot discover, read or touch another user's tree. The id
// "root" is accepted as an alias for the user's own root folder.

function ownedNode(userId: string, id: string): NodeRow | undefined {
  if (id === ROOT_ID) {
    const user = getUser(userId);
    return user ? getOwnedNode(userId, user.root_id) : undefined;
  }
  return getOwnedNode(userId, id);
}

function requireNode(userId: string, id: string): NodeRow {
  const node = ownedNode(userId, id);
  if (!node) throw new NotFoundError('Item not found.');
  return node;
}

function requireFolder(userId: string, id: string, label = 'Folder'): NodeRow {
  const node = ownedNode(userId, id);
  if (!node || node.type !== 'folder') throw new NotFoundError(`${label} not found.`);
  return node;
}

function requireFile(userId: string, id: string): NodeRow {
  const node = ownedNode(userId, id);
  if (!node || node.type !== 'file') throw new NotFoundError('File not found.');
  return node;
}

/** A user's root folder has no parent. */
function isRoot(node: NodeRow): boolean {
  return node.parent_id === null;
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

export function listFolder(
  userId: string,
  folderId: string,
): { folder: NodeRow; children: NodeRow[] } {
  const folder = requireFolder(userId, folderId);
  return { folder, children: listChildren(folder.id) };
}

/** Ancestor chain from the root down to (and including) the folder, for breadcrumbs. */
export function breadcrumb(userId: string, folderId: string): { id: string; name: string }[] {
  const chain: { id: string; name: string }[] = [];
  let cur: NodeRow | undefined = ownedNode(userId, folderId);
  while (cur) {
    chain.unshift({ id: cur.id, name: isRoot(cur) ? 'Home' : cur.name });
    cur = cur.parent_id ? getNode(cur.parent_id) : undefined;
  }
  return chain;
}

// ---- mutations -------------------------------------------------------------

export function createFolder(userId: string, parentId: string, rawName: string): NodeRow {
  const parent = requireFolder(userId, parentId, 'Parent folder');
  const name = validateName(rawName);
  if (childByName(parent.id, name)) {
    throw new BadRequestError('An item with that name already exists here.');
  }
  return createFolderNode(parent.id, name, joinPath(parent.path, name));
}

/**
 * Stream an upload to the chosen backend, then record the file node. Placement runs on the
 * declared size (accurate Content-Length from the raw-body upload); the stored size is the
 * bytes the provider actually wrote. When AUTO_ALIAS_ON_UPLOAD is on, a friendly alias is
 * generated from the name.
 */
export async function uploadFile(
  userId: string,
  input: {
    parentId: string;
    name: string;
    stream: Readable;
    size: number;
    mimeType?: string;
  },
): Promise<NodeRow> {
  const parent = requireFolder(userId, input.parentId, 'Parent folder');
  const requestedName = validateName(input.name);
  if (childByName(parent.id, requestedName)) {
    throw new BadRequestError('An item with that name already exists here.');
  }

  const content = await applyUploadConversion({
    stream: input.stream,
    size: input.size,
    name: requestedName,
    mimeType: input.mimeType || mimeLookup(requestedName) || 'application/octet-stream',
  });
  // Conversion can change the extension (photo.jpg -> photo.webp), which may collide.
  const name =
    content.name === requestedName ? requestedName : freeChildName(parent.id, content.name);
  const mimeType = content.mimeType;

  const backend = await chooseBackend(userId, content.size);
  const { objectKey, size } = await providerFor(backend).put(content.stream, {
    size: content.size,
    contentType: mimeType,
  });

  const node = createFileNode({
    parentId: parent.id,
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

export function rename(userId: string, id: string, rawName: string): NodeRow {
  const node = requireNode(userId, id);
  if (isRoot(node)) throw new BadRequestError('The root folder cannot be renamed.');

  const name = validateName(rawName);
  const parentId = node.parent_id!;
  const clash = childByName(parentId, name);
  if (clash && clash.id !== node.id) {
    throw new BadRequestError('An item with that name already exists here.');
  }

  const parent = getNode(parentId)!;
  const newPath = joinPath(parent.path, name);
  updateNodeNameAndPath(node.id, name, newPath);
  if (node.type === 'folder') repathDescendants(node.id, newPath);
  return getNode(node.id)!;
}

export function move(userId: string, id: string, newParentId: string): NodeRow {
  const node = requireNode(userId, id);
  if (isRoot(node)) throw new BadRequestError('The root folder cannot be moved.');

  const dest = requireFolder(userId, newParentId, 'Destination folder');
  if (dest.id === node.parent_id) return node; // already there

  if (node.type === 'folder') {
    const subtreeIds = new Set(collectSubtree(node.id).map((n) => n.id));
    if (subtreeIds.has(dest.id)) {
      throw new BadRequestError('A folder cannot be moved into itself or one of its subfolders.');
    }
  }
  if (childByName(dest.id, node.name)) {
    throw new BadRequestError('An item with that name already exists in the destination.');
  }

  const newPath = joinPath(dest.path, node.name);
  updateNodeParentAndPath(node.id, dest.id, newPath);
  if (node.type === 'folder') repathDescendants(node.id, newPath);
  return getNode(node.id)!;
}

/**
 * Delete a file or a whole folder subtree. Physical bytes are removed from each file's
 * backend first (best-effort — an orphaned blob is harmless since the DB is the source of
 * truth); the row delete then cascades to descendants via ON DELETE CASCADE.
 */
export async function remove(userId: string, id: string): Promise<void> {
  const node = requireNode(userId, id);
  if (isRoot(node)) throw new BadRequestError('The root folder cannot be deleted.');

  await deleteStoredBytes(collectSubtree(node.id));
  deleteNodeRow(node.id);
}

/** Best-effort removal of file nodes' bytes from their backends. */
export async function deleteStoredBytes(nodes: NodeRow[]): Promise<void> {
  for (const n of nodes) {
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
}

/**
 * Create or overwrite a file at a given folder+name (WebDAV PUT semantics). On overwrite the
 * node keeps its id, public_token, and alias — so existing CDN/friendly links survive an
 * in-place edit — while its bytes are repointed to a freshly-stored object and the old object
 * is removed.
 */
export async function writeFileAtPath(
  userId: string,
  input: {
    parentId: string;
    name: string;
    stream: Readable;
    size: number;
    mimeType?: string;
  },
): Promise<NodeRow> {
  const parent = requireFolder(userId, input.parentId, 'Parent folder');
  const requestedName = validateName(input.name);
  const existingAtRequested = childByName(parent.id, requestedName);
  if (existingAtRequested && existingAtRequested.type === 'folder') {
    throw new BadRequestError('A folder with that name already exists here.');
  }

  const content = await applyUploadConversion(
    {
      stream: input.stream,
      size: input.size,
      name: requestedName,
      mimeType: input.mimeType || mimeLookup(requestedName) || 'application/octet-stream',
    },
    'drive',
  );
  const name = content.name;
  const mimeType = content.mimeType;
  // Re-resolve after a possible extension change so a repeat save overwrites the same node.
  const existing = name === requestedName ? existingAtRequested : childByName(parent.id, name);
  if (existing && existing.type === 'folder') {
    throw new BadRequestError('A folder with that name already exists here.');
  }

  const backend = await chooseBackend(userId, content.size);
  const { objectKey, size } = await providerFor(backend).put(content.stream, {
    size: content.size,
    contentType: mimeType,
  });

  if (existing) {
    const oldBackendId = existing.backend_id;
    const oldObjectKey = existing.object_key;
    updateFileBlob({ id: existing.id, backendId: backend.id, objectKey, size, mimeType });
    const isSameObject = oldBackendId === backend.id && oldObjectKey === objectKey;
    if (oldBackendId && oldObjectKey && !isSameObject) {
      const oldBackend = getBackend(oldBackendId);
      if (oldBackend) {
        try {
          await providerFor(oldBackend).delete(oldObjectKey);
        } catch {
          // a stray old blob is harmless; the DB is the source of truth
        }
      }
    }
    return getNode(existing.id)!;
  }

  const node = createFileNode({
    parentId: parent.id,
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

/**
 * Replace an existing file's bytes in place, keeping its id, public_token and alias — so an
 * edit (e.g. saving from the image editor) never breaks links that were already shared.
 * Placement runs again, so the new content may land on a different backend.
 */
export async function replaceFileContent(
  userId: string,
  input: {
    id: string;
    stream: Readable;
    size: number;
    mimeType?: string;
  },
): Promise<NodeRow> {
  const node = requireFile(userId, input.id);
  const mimeType = input.mimeType || node.mime_type || 'application/octet-stream';

  const backend = await chooseBackend(userId, input.size);
  const { objectKey, size } = await providerFor(backend).put(input.stream, {
    size: input.size,
    contentType: mimeType,
  });

  const oldBackendId = node.backend_id;
  const oldObjectKey = node.object_key;
  updateFileBlob({ id: node.id, backendId: backend.id, objectKey, size, mimeType });

  const sameObject = oldBackendId === backend.id && oldObjectKey === objectKey;
  if (oldBackendId && oldObjectKey && !sameObject) {
    const oldBackend = getBackend(oldBackendId);
    if (oldBackend) {
      try {
        await providerFor(oldBackend).delete(oldObjectKey);
      } catch {
        // a stray old blob is harmless; the DB is the source of truth
      }
    }
  }
  return getNode(node.id)!;
}

/**
 * Cache validator for a file's current bytes.
 *
 * It must fold in `updated_at`, not just the token: an in-place edit deliberately keeps the same
 * token so shared links survive, so a token-only ETag would let browsers and caches keep serving
 * the pre-edit image forever.
 */
export function fileEtag(node: NodeRow): string | undefined {
  if (!node.public_token) return undefined;
  const version = Date.parse(node.updated_at) || 0;
  return `"${node.public_token}-${version.toString(36)}"`;
}

/** The display name of a user's node, or undefined if it is missing (used for error reporting). */
export function nodeName(userId: string, id: string): string | undefined {
  return ownedNode(userId, id)?.name;
}

/**
 * A name that doesn't collide in the user's destination folder: "report.pdf" -> "report (2).pdf".
 * Used when copying into a folder that already has an item with that name. A missing folder
 * returns the name unchanged; the operation that follows reports the 404.
 */
export function uniqueChildName(userId: string, parentId: string, name: string): string {
  const parent = ownedNode(userId, parentId);
  return parent ? freeChildName(parent.id, name) : name;
}

/** uniqueChildName for an already-resolved folder id. */
function freeChildName(parentId: string, name: string): string {
  if (!childByName(parentId, name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; n < 10000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!childByName(parentId, candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/** Copy a file or a whole folder subtree to a destination folder (WebDAV COPY). */
export async function copyNode(
  userId: string,
  id: string,
  destParentId: string,
  destName: string,
  overwrite: boolean,
): Promise<NodeRow> {
  const node = requireNode(userId, id);
  const destParent = requireFolder(userId, destParentId, 'Destination folder');
  const name = validateName(destName);

  const clash = childByName(destParent.id, name);
  if (clash) {
    if (!overwrite) throw new BadRequestError('An item with that name already exists in the destination.');
    await remove(userId, clash.id);
  }

  if (node.type === 'folder') {
    if (new Set(collectSubtree(node.id).map((n) => n.id)).has(destParent.id)) {
      throw new BadRequestError('A folder cannot be copied into itself or one of its subfolders.');
    }
    const newFolder = createFolderNode(destParent.id, name, joinPath(destParent.path, name));
    for (const child of listChildren(node.id)) {
      await copyNode(userId, child.id, newFolder.id, child.name, false);
    }
    return getNode(newFolder.id)!;
  }

  if (!node.backend_id || !node.object_key) throw new BadRequestError('File has no content to copy.');
  const src = await openFile(node);
  const backend = await chooseBackend(userId, node.size ?? 0);
  const { objectKey, size } = await providerFor(backend).put(src.stream, {
    size: node.size ?? 0,
    contentType: node.mime_type ?? undefined,
  });
  return createFileNode({
    parentId: destParent.id,
    name,
    path: joinPath(destParent.path, name),
    size,
    mimeType: node.mime_type ?? 'application/octet-stream',
    backendId: backend.id,
    objectKey,
  });
}

/**
 * Move a node to a new parent and/or name in one validated step (WebDAV MOVE). Validates only
 * the final destination, avoiding the transient name clashes a separate move+rename could hit.
 */
export function relocate(
  userId: string,
  id: string,
  newParentId: string,
  newName: string,
): NodeRow {
  const node = requireNode(userId, id);
  if (isRoot(node)) throw new BadRequestError('The root folder cannot be moved.');
  const dest = requireFolder(userId, newParentId, 'Destination folder');
  const name = validateName(newName);

  if (node.type === 'folder' && new Set(collectSubtree(node.id).map((n) => n.id)).has(dest.id)) {
    throw new BadRequestError('A folder cannot be moved into itself or one of its subfolders.');
  }
  const clash = childByName(dest.id, name);
  if (clash && clash.id !== node.id) {
    throw new BadRequestError('An item with that name already exists in the destination.');
  }

  const newPath = joinPath(dest.path, name);
  updateNodeParentAndPath(node.id, dest.id, newPath);
  if (name !== node.name) updateNodeNameAndPath(node.id, name, newPath);
  if (node.type === 'folder') repathDescendants(node.id, newPath);
  return getNode(node.id)!;
}

// ---- friendly-alias operations ---------------------------------------------

/** A unique alias suggestion for a file (does not persist it) plus its current alias. */
export function suggestAlias(
  userId: string,
  id: string,
): { suggestion: string; currentAlias: string | null } {
  const node = requireFile(userId, id);
  return { suggestion: uniqueAlias(node.name, node.id), currentAlias: node.alias };
}

/** Set (or replace) a file's friendly alias. Throws if the normalized slug is already taken. */
export function setAlias(userId: string, id: string, rawAlias: string): NodeRow {
  const node = requireFile(userId, id);
  const alias = normalizeAlias(rawAlias);
  if (handleInUse(alias, node.id)) {
    throw new BadRequestError('That friendly link is already in use — try another.');
  }
  setNodeAlias(node.id, alias);
  return getNode(node.id)!;
}

export function clearAlias(userId: string, id: string): NodeRow {
  const node = requireFile(userId, id);
  setNodeAlias(node.id, null);
  return getNode(node.id)!;
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

/** Read a whole file into memory (used to render image variants). */
export async function readFileBytes(node: NodeRow): Promise<Buffer> {
  const { stream } = await openFile(node);
  return collectStream(stream);
}

/** A backend-native direct URL for the file, if its provider offers one (else null). */
export async function directUrl(node: NodeRow): Promise<string | null> {
  if (!node.backend_id || !node.object_key) return null;
  const backend = getBackend(node.backend_id);
  if (!backend) return null;
  const provider = providerFor(backend);
  return provider.getDirectUrl ? provider.getDirectUrl(node.object_key) : null;
}
