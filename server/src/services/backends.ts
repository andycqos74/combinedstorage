import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import {
  type BackendRow,
  backendConfig,
  createBackend,
  deleteBackend,
  getBackend,
  updateBackendConfig,
} from '../models/backends';
import type { LocalConfig } from '../storage/local';
import { BadRequestError } from '../util/errors';

/**
 * Add a local-disk backend for a user. Each gets its own directory under the data dir; quota is
 * a simulated capacity (local disk has no inherent per-folder limit).
 */
export function addLocalBackend(ownerId: string, rawName: unknown, rawQuota: unknown): BackendRow {
  const name = String(rawName ?? '').trim();
  const quotaBytes = Number(rawQuota);
  if (!name) throw new BadRequestError('A name is required.');
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
    throw new BadRequestError('Quota must be a positive number of bytes.');
  }

  // Create the row first so its id names the on-disk root directory.
  const backend = createBackend({ ownerId, name, type: 'local', config: { root: '', quotaBytes } });
  const root = path.join(config.localRoot, backend.id);
  fs.mkdirSync(root, { recursive: true });
  updateBackendConfig(backend.id, { root, quotaBytes } satisfies LocalConfig);
  return getBackend(backend.id)!;
}

/** Delete a backend's row, and for a local backend its on-disk directory too. */
export function removeBackend(backend: BackendRow): void {
  if (backend.type === 'local') {
    try {
      const cfg = backendConfig<LocalConfig>(backend);
      if (cfg.root) fs.rmSync(cfg.root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  deleteBackend(backend.id);
}
