import { db } from '../db';
import { newId, nowIso } from '../util/ids';

export type BackendType = 'local' | 'onedrive';

export interface BackendRow {
  id: string;
  name: string;
  type: BackendType;
  config: string; // JSON string
  status: string; // 'connected' | 'error'
  enabled: number; // 0 | 1
  quota_total: number | null;
  quota_used: number | null;
  created_at: string;
}

export function listBackends(): BackendRow[] {
  return db.prepare('SELECT * FROM backends ORDER BY created_at ASC').all() as BackendRow[];
}

/** Backends eligible to receive/serve data right now. */
export function listUsableBackends(): BackendRow[] {
  return db
    .prepare("SELECT * FROM backends WHERE enabled = 1 AND status = 'connected' ORDER BY created_at ASC")
    .all() as BackendRow[];
}

export function getBackend(id: string): BackendRow | undefined {
  return db.prepare('SELECT * FROM backends WHERE id = ?').get(id) as BackendRow | undefined;
}

export function createBackend(input: { name: string; type: BackendType; config: unknown }): BackendRow {
  const id = newId();
  db.prepare(
    `INSERT INTO backends (id, name, type, config, status, enabled, created_at)
     VALUES (?, ?, ?, ?, 'connected', 1, ?)`,
  ).run(id, input.name, input.type, JSON.stringify(input.config ?? {}), nowIso());
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
