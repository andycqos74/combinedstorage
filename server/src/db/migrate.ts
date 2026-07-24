import { db } from './index';
import { SCHEMA_SQL } from './schema';
import { nowIso } from '../util/ids';

export const ROOT_ID = 'root';

/** Create tables/indexes (idempotent) and seed the single tree root. */
export function migrate(): void {
  db.exec(SCHEMA_SQL);
  // Friendly-alias column + its partial unique index (works for both fresh and upgraded DBs).
  addColumnIfMissing('nodes', 'alias', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_alias ON nodes(alias) WHERE alias IS NOT NULL');

  const root = db.prepare('SELECT id FROM nodes WHERE id = ?').get(ROOT_ID);
  if (!root) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO nodes (id, parent_id, name, type, path, created_at, updated_at)
       VALUES (?, NULL, '', 'folder', '/', ?, ?)`,
    ).run(ROOT_ID, now, now);
  }
}

/** Add a column to an existing table if it isn't already present (simple forward migration). */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
