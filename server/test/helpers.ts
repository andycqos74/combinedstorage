import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db';
import { createBackend, updateBackendConfig, type BackendRow } from '../src/models/backends';

/** Clear all tree nodes (except the seeded root) and all backends between tests. */
export function resetDb(): void {
  db.exec("DELETE FROM nodes WHERE id != 'root'; DELETE FROM backends;");
}

/** Create a local backend backed by a fresh temp directory. */
export function makeLocalBackend(name: string, quotaBytes: number): BackendRow {
  const backend = createBackend({ name, type: 'local', config: {} });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
  updateBackendConfig(backend.id, { root, quotaBytes });
  return { ...backend, config: JSON.stringify({ root, quotaBytes }) };
}
