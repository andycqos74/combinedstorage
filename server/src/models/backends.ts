import { db } from '../db';
import { newId, nowIso } from '../util/ids';

export type BackendType = 'local' | 'onedrive' | 'googledrive';

export interface BackendRow {
  id: string;
  name: string;
  type: BackendType;
  config: string; // JSON string
  status: string; // 'connected' | 'error'
  enabled: number; // 0 | 1
  quota_total: number | null;
  quota_used: number | null;
  owner_id: string;
  created_at: string;
}

/** A user's backends (all of them, including disabled/errored ones). */
export function listBackends(ownerId: string): BackendRow[] {
  return db
    .prepare('SELECT * FROM backends WHERE owner_id = ? ORDER BY created_at ASC')
    .all(ownerId) as BackendRow[];
}

/** A user's backends that are eligible to receive/serve data right now. */
export function listUsableBackends(ownerId: string): BackendRow[] {
  return db
    .prepare(
      `SELECT * FROM backends WHERE owner_id = ? AND enabled = 1 AND status = 'connected'
       ORDER BY created_at ASC`,
    )
    .all(ownerId) as BackendRow[];
}

export function getBackend(id: string): BackendRow | undefined {
  return db.prepare('SELECT * FROM backends WHERE id = ?').get(id) as BackendRow | undefined;
}

/** A backend, but only if it belongs to the given user. */
export function getOwnedBackend(ownerId: string, id: string): BackendRow | undefined {
  return db
    .prepare('SELECT * FROM backends WHERE id = ? AND owner_id = ?')
    .get(id, ownerId) as BackendRow | undefined;
}

export function createBackend(input: {
  ownerId: string;
  name: string;
  type: BackendType;
  config: unknown;
}): BackendRow {
  const id = newId();
  db.prepare(
    `INSERT INTO backends (id, name, type, config, status, enabled, owner_id, created_at)
     VALUES (?, ?, ?, ?, 'connected', 1, ?, ?)`,
  ).run(id, input.name, input.type, JSON.stringify(input.config ?? {}), input.ownerId, nowIso());
  return getBackend(id)!;
}

export function updateBackendConfig(id: string, config: unknown): void {
  db.prepare('UPDATE backends SET config = ? WHERE id = ?').run(JSON.stringify(config ?? {}), id);
}

export function setBackendStatus(id: string, status: string): void {
  db.prepare('UPDATE backends SET status = ? WHERE id = ?').run(status, id);
}

export function setBackendEnabled(id: string, enabled: boolean): void {
  db.prepare('UPDATE backends SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export function setBackendQuotaCache(id: string, total: number, used: number): void {
  db.prepare('UPDATE backends SET quota_total = ?, quota_used = ? WHERE id = ?').run(total, used, id);
}

export function deleteBackend(id: string): void {
  db.prepare('DELETE FROM backends WHERE id = ?').run(id);
}

/** Parse a backend row's provider-specific config JSON. */
export function backendConfig<T = Record<string, unknown>>(row: BackendRow): T {
  return JSON.parse(row.config) as T;
}

/**
 * Find a user's existing backend of the given type for a specific cloud account, so a reconnect
 * updates it instead of creating a duplicate. The account is identified by a provider-specific
 * key stored in the config (OneDrive: homeAccountId; Google: accountId).
 */
export function findBackendByAccount(
  ownerId: string,
  type: BackendType,
  accountKey: string,
): BackendRow | undefined {
  for (const row of listBackends(ownerId)) {
    if (row.type !== type) continue;
    try {
      const cfg = JSON.parse(row.config) as {
        accountKey?: string;
        homeAccountId?: string;
        accountId?: string;
      };
      const key = cfg.accountKey ?? cfg.homeAccountId ?? cfg.accountId;
      if (key && key === accountKey) return row;
    } catch {
      // ignore rows with unparseable config
    }
  }
  return undefined;
}
