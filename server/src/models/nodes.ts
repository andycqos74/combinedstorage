import { db } from '../db';
import { newId, nowIso, publicToken } from '../util/ids';
import { ROOT_ID } from '../db/migrate';

export { ROOT_ID };

export type NodeType = 'folder' | 'file';

export interface NodeRow {
  id: string;
  parent_id: string | null;
  name: string;
  type: NodeType;
  path: string;
  size: number | null;
  mime_type: string | null;
  backend_id: string | null;
  object_key: string | null;
  public_token: string | null;
  alias: string | null;
  created_at: string;
  updated_at: string;
}

export function getNode(id: string): NodeRow | undefined {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
}

export function getFileByToken(token: string): NodeRow | undefined {
  return db
    .prepare("SELECT * FROM nodes WHERE public_token = ? AND type = 'file'")
    .get(token) as NodeRow | undefined;
}

/** Resolve a public CDN handle to a file: matches either its permanent token or its alias. */
export function getFileByHandle(handle: string): NodeRow | undefined {
  return db
    .prepare("SELECT * FROM nodes WHERE type = 'file' AND (public_token = ? OR alias = ?)")
    .get(handle, handle) as NodeRow | undefined;
}

/** True if a handle is already taken by any file's token or alias (optionally excluding one node). */
export function handleInUse(handle: string, exceptId?: string): boolean {
  const row = db
    .prepare(
      `SELECT id FROM nodes
       WHERE (public_token = ? OR alias = ?) AND id != ?`,
    )
    .get(handle, handle, exceptId ?? '') as { id: string } | undefined;
  return !!row;
}

export function setNodeAlias(id: string, alias: string | null): void {
  db.prepare('UPDATE nodes SET alias = ?, updated_at = ? WHERE id = ?').run(alias, nowIso(), id);
}

/** Children of a folder: folders first, then files, each case-insensitively sorted. */
export function listChildren(parentId: string): NodeRow[] {
  return db
    .prepare(
      `SELECT * FROM nodes WHERE parent_id = ?
       ORDER BY (type = 'file') ASC, name COLLATE NOCASE ASC`,
    )
    .all(parentId) as NodeRow[];
}

export function childByName(parentId: string, name: string): NodeRow | undefined {
  return db
    .prepare('SELECT * FROM nodes WHERE parent_id = ? AND name = ?')
    .get(parentId, name) as NodeRow | undefined;
}

export function createFolderNode(parentId: string, name: string, path: string): NodeRow {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO nodes (id, parent_id, name, type, path, created_at, updated_at)
     VALUES (?, ?, ?, 'folder', ?, ?, ?)`,
  ).run(id, parentId, name, path, now, now);
  return getNode(id)!;
}

export function createFileNode(input: {
  parentId: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  backendId: string;
  objectKey: string;
}): NodeRow {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO nodes
       (id, parent_id, name, type, path, size, mime_type, backend_id, object_key, public_token, created_at, updated_at)
     VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.parentId,
    input.name,
    input.path,
    input.size,
    input.mimeType,
    input.backendId,
    input.objectKey,
    publicToken(),
    now,
    now,
  );
  return getNode(id)!;
}

/** Repoint a file node at freshly-stored bytes (used when a WebDAV PUT overwrites content). */
export function updateFileBlob(input: {
  id: string;
  backendId: string;
  objectKey: string;
  size: number;
  mimeType: string;
}): void {
  db.prepare(
    'UPDATE nodes SET backend_id = ?, object_key = ?, size = ?, mime_type = ?, updated_at = ? WHERE id = ?',
  ).run(input.backendId, input.objectKey, input.size, input.mimeType, nowIso(), input.id);
}

export function updateNodeNameAndPath(id: string, name: string, path: string): void {
  db.prepare('UPDATE nodes SET name = ?, path = ?, updated_at = ? WHERE id = ?').run(
    name,
    path,
    nowIso(),
    id,
  );
}

export function updateNodeParentAndPath(id: string, parentId: string, path: string): void {
  db.prepare('UPDATE nodes SET parent_id = ?, path = ?, updated_at = ? WHERE id = ?').run(
    parentId,
    path,
    nowIso(),
    id,
  );
}

export function updateNodePath(id: string, path: string): void {
  db.prepare('UPDATE nodes SET path = ?, updated_at = ? WHERE id = ?').run(path, nowIso(), id);
}

export function deleteNodeRow(id: string): void {
  db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
}

/**
 * A node plus all of its descendants, via a recursive CTE. Used by delete (to remove
 * each file's bytes from its backend) and by move (to rewrite descendant paths).
 */
export function collectSubtree(id: string): NodeRow[] {
  return db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM nodes WHERE id = ?
         UNION ALL
         SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
       )
       SELECT nodes.* FROM nodes JOIN sub ON nodes.id = sub.id`,
    )
    .all(id) as NodeRow[];
}

/** Total bytes of file nodes physically stored on a given backend. */
export function usedBytesByBackend(backendId: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(size), 0) AS used FROM nodes WHERE backend_id = ? AND type = 'file'")
    .get(backendId) as { used: number };
  return row.used;
}

/** Number of file nodes physically stored on a given backend. */
export function countFilesOnBackend(backendId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM nodes WHERE backend_id = ? AND type = 'file'")
    .get(backendId) as { c: number };
  return row.c;
}
