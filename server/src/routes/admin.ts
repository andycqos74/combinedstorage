import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { asyncHandler } from '../util/asyncHandler';
import {
  listBackends,
  getBackend,
  createBackend,
  updateBackendConfig,
  setBackendEnabled,
  deleteBackend,
  backendConfig,
} from '../models/backends';
import { countFilesOnBackend } from '../models/nodes';
import { backendUsage } from '../services/quota';
import type { LocalConfig } from '../storage/local';
import { BadRequestError, NotFoundError } from '../util/errors';

export const adminRouter = Router();
const json = express.json();

// Small bits of server state the admin UI needs (which cloud backends can be connected).
adminRouter.get('/meta', (_req, res) => {
  res.json({
    oneDriveConfigured: !!config.microsoft,
    googleDriveConfigured: !!config.google,
  });
});

// List all backends with live usage (includes disabled/errored ones for the admin view).
adminRouter.get(
  '/backends',
  asyncHandler(async (_req, res) => {
    const usage = await Promise.all(listBackends().map(backendUsage));
    res.json(usage);
  }),
);

// Add a local-disk backend. Each gets its own directory under the data dir; quota is a
// simulated capacity (local disk has no inherent per-folder limit).
adminRouter.post(
  '/backends/local',
  json,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const quotaBytes = Number(req.body?.quotaBytes);
    if (!name) throw new BadRequestError('A name is required.');
    if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
      throw new BadRequestError('Quota must be a positive number of bytes.');
    }

    // Create the row first so its id names the on-disk root directory.
    const backend = createBackend({ name, type: 'local', config: { root: '', quotaBytes } });
    const root = path.join(config.localRoot, backend.id);
    fs.mkdirSync(root, { recursive: true });
    updateBackendConfig(backend.id, { root, quotaBytes } satisfies LocalConfig);

    res.status(201).json(await backendUsage(getBackend(backend.id)!));
  }),
);

// Toggle enabled / rename a backend.
adminRouter.patch(
  '/backends/:id',
  json,
  asyncHandler(async (req, res) => {
    const backend = getBackend(req.params.id);
    if (!backend) throw new NotFoundError('Backend not found.');
    if (typeof req.body?.enabled === 'boolean') setBackendEnabled(backend.id, req.body.enabled);
    res.json(await backendUsage(getBackend(backend.id)!));
  }),
);

// Remove a backend. Refuses while it still holds files so nothing is silently orphaned.
adminRouter.delete(
  '/backends/:id',
  asyncHandler(async (req, res) => {
    const backend = getBackend(req.params.id);
    if (!backend) throw new NotFoundError('Backend not found.');
    if (countFilesOnBackend(backend.id) > 0) {
      throw new BadRequestError(
        'This backend still stores files. Delete or move those files before removing it.',
      );
    }
    if (backend.type === 'local') {
      try {
        const cfg = backendConfig<LocalConfig>(backend);
        if (cfg.root) fs.rmSync(cfg.root, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    deleteBackend(backend.id);
    res.json({ ok: true });
  }),
);
