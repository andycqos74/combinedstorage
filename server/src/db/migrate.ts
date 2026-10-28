import { db } from './index';
import { SCHEMA_SQL } from './schema';
import { config } from '../config';
import { insertUser } from '../models/users';
import { hashPasswordSync } from '../util/auth';

/**
 * Id of the first admin's tree root. In the API, "root" is also accepted as an alias for the
 * signed-in user's own root folder, whatever its real id.
 */
export const ROOT_ID = 'root';

/** Create tables/indexes (idempotent), seed the first admin, and adopt pre-multi-user data. */
export function migrate(): void {
  db.exec(SCHEMA_SQL);
  // Friendly-alias column + its partial unique index (works for both fresh and upgraded DBs).
  addColumnIfMissing('nodes', 'alias', 'TEXT');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_alias ON nodes(alias) WHERE alias IS NOT NULL',
  );
  // Ownership columns for multi-user support.
  addColumnIfMissing('nodes', 'owner_id', 'TEXT');
  addColumnIfMissing('backends', 'owner_id', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_owner ON nodes(owner_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_backends_owner ON backends(owner_id)');

  const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    // Seed the first admin from ADMIN_USERNAME / ADMIN_PASSWORD. Their tree is rooted at the
    // historical 'root' node, so a single-user install upgrades with every file intact.
    insertUser({
      username: config.admin.username,
      passwordHash: hashPasswordSync(config.admin.password),
      role: 'admin',
      rootId: ROOT_ID,
    });
  }

  // Anything that predates multi-user support belongs to the first admin.
  const firstAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1")
    .get() as { id: string } | undefined;
  if (firstAdmin) {
    db.prepare('UPDATE nodes SET owner_id = ? WHERE owner_id IS NULL').run(firstAdmin.id);
    db.prepare('UPDATE backends SET owner_id = ? WHERE owner_id IS NULL').run(firstAdmin.id);
  }
}

/** Add a column to an existing table if it isn't already present (simple forward migration). */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
