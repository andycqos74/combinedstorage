/**
 * Database schema for the combined-storage metadata layer.
 *
 * Two tables carry the whole model:
 *   - backends: the registry of connected storage backends (local disk, OneDrive, ...).
 *   - nodes:    the logical file tree. A file node points at its physical location via
 *               (backend_id, object_key); folders are metadata-only. Because logical
 *               names live here and object keys are opaque, rename/move are pure DB ops.
 *
 * The tree is anchored by a single seeded root node (id = 'root', parent_id = NULL) so
 * that UNIQUE(parent_id, name) also enforces uniqueness at the top level (SQLite treats
 * NULLs as distinct, which would otherwise let duplicate root names slip through).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS backends (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,                       -- 'local' | 'onedrive'
  config       TEXT NOT NULL,                       -- JSON, provider-specific
  status       TEXT NOT NULL DEFAULT 'connected',   -- 'connected' | 'error'
  enabled      INTEGER NOT NULL DEFAULT 1,
  quota_total  INTEGER,                             -- cached bytes, refreshed on demand
  quota_used   INTEGER,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id           TEXT PRIMARY KEY,
  parent_id    TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('folder','file')),
  path         TEXT NOT NULL,                       -- denormalized logical path, e.g. /photos/cat.jpg
  size         INTEGER,                             -- file only
  mime_type    TEXT,                                -- file only
  backend_id   TEXT REFERENCES backends(id),        -- file only: which backend holds the bytes
  object_key   TEXT,                                -- file only: key/id within that backend
  public_token TEXT UNIQUE,                         -- file only: permanent random CDN handle
  alias        TEXT,                                -- file only: optional friendly CDN handle
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (parent_id, name)
);

CREATE INDEX IF NOT EXISTS idx_nodes_parent  ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_backend ON nodes(backend_id);
CREATE INDEX IF NOT EXISTS idx_nodes_token   ON nodes(public_token);
-- NOTE: the unique index on nodes(alias) is created in migrate() after ensuring the column
-- exists, so upgrading an existing database (added via ALTER TABLE) works too.
`;
