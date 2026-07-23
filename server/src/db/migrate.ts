import { db } from './index';
import { SCHEMA_SQL } from './schema';
import { nowIso } from '../util/ids';

export const ROOT_ID = 'root';

/** Create tables/indexes (idempotent) and seed the single tree root. */
export function migrate(): void {
  db.exec(SCHEMA_SQL);

  const root = db.prepare('SELECT id FROM nodes WHERE id = ?').get(ROOT_ID);
  if (!root) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO nodes (id, parent_id, name, type, path, created_at, updated_at)
       VALUES (?, NULL, '', 'folder', '/', ?, ?)`,
    ).run(ROOT_ID, now, now);
  }
}
