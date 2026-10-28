import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db';
import { createBackend, updateBackendConfig, type BackendRow } from '../src/models/backends';
import { getUserByUsername } from '../src/models/users';

/** Id of the seeded first admin ('admin' / 'changeme'), whose tree is rooted at 'root'. */
export function adminId(): string {
  return getUserByUsername('admin')!.id;
}

/**
 * Clear all tree nodes (except the seeded root), all backends, and every user except the seeded
 * admin between tests; site settings go back to their defaults.
 */
export function resetDb(): void {
  db.exec(`
    DELETE FROM nodes WHERE parent_id IS NOT NULL;
    DELETE FROM backends;
    DELETE FROM nodes WHERE id != 'root';
    DELETE FROM users WHERE root_id != 'root';
    DELETE FROM settings;
  `);
}

/** Create a local backend backed by a fresh temp directory, owned by the admin by default. */
export function makeLocalBackend(
  name: string,
  quotaBytes: number,
  ownerId = adminId(),
): BackendRow {
  const backend = createBackend({ ownerId, name, type: 'local', config: {} });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
  updateBackendConfig(backend.id, { root, quotaBytes });
  return { ...backend, config: JSON.stringify({ root, quotaBytes }) };
}
