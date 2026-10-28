/**
 * Database schema for the combined-storage metadata layer.
 *
 * Three tables carry the whole model:
 *   - users:    accounts. Each user has a private file tree and their own storage backends.
 *   - backends: the registry of connected storage backends (local disk, OneDrive, ...),
 *               each owned by one user.
 *   - nodes:    the logical file tree. A file node points at its physical location via
 *               (backend_id, object_key); folders are metadata-only. Because logical
 *               names live here and object keys are opaque, rename/move are pure DB ops.
 *
 * Each user's tree is anchored by their own root node (parent_id = NULL, referenced by
 * users.root_id). The first admin's root keeps the historical id 'root'. Every node carries
 * its owner_id so access checks never need to walk up to the root.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,                      -- scrypt$<salt>$<hash>
  role          TEXT NOT NULL DEFAULT 'user',       -- 'admin' | 'user'
  root_id       TEXT NOT NULL,                      -- this user's tree root node
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backends (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,                       -- 'local' | 'onedrive' | 'googledrive'
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
-- NOTE: the unique index on nodes(alias) and the owner_id columns/indexes are created in
-- migrate() after ensuring the columns exist, so upgrading an existing database (added via
-- ALTER TABLE) works too.
`;
