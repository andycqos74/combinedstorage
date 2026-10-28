import { db } from '../db';
import { newId, nowIso } from '../util/ids';

export type UserRole = 'admin' | 'user';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  root_id: string;
  created_at: string;
}

export function listUsers(): UserRow[] {
  return db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[];
}

export function getUser(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

/** Usernames are matched case-insensitively (the column is COLLATE NOCASE). */
export function getUserByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

export function countAdmins(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as {
    c: number;
  };
  return row.c;
}

/**
 * Insert a user together with the root folder of their private tree, in one transaction.
 * `rootId` lets the migration give the first admin the historical 'root' id.
 */
export function insertUser(input: {
  username: string;
  passwordHash: string;
  role: UserRole;
  rootId?: string;
}): UserRow {
  const id = newId();
  const rootId = input.rootId ?? newId();
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, root_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, input.username, input.passwordHash, input.role, rootId, now);
    const existingRoot = db.prepare('SELECT id FROM nodes WHERE id = ?').get(rootId);
    if (existingRoot) {
      db.prepare('UPDATE nodes SET owner_id = ? WHERE id = ?').run(id, rootId);
    } else {
      db.prepare(
        `INSERT INTO nodes (id, parent_id, name, type, path, owner_id, created_at, updated_at)
         VALUES (?, NULL, '', 'folder', '/', ?, ?, ?)`,
      ).run(rootId, id, now, now);
    }
  })();
  return getUser(id)!;
}

export function setUserPassword(id: string, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

export function setUserRole(id: string, role: UserRole): void {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

export function deleteUserRow(id: string): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
