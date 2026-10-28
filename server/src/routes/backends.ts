import express, { Router } from 'express';
import { config } from '../config';
import { asyncHandler } from '../util/asyncHandler';
import { listBackends, getOwnedBackend, setBackendEnabled, getBackend } from '../models/backends';
import { getUser } from '../models/users';
import { countFilesOnBackend } from '../models/nodes';
import { backendUsage } from '../services/quota';
import { addLocalBackend, removeBackend } from '../services/backends';
import { currentUser, requireAdmin } from '../middleware/auth';
import { BadRequestError, NotFoundError } from '../util/errors';

/** The signed-in user's own storage backends. Nobody can see or change another user's. */
export const backendsRouter = Router();
const json = express.json();

// Small bits of server state the storage page needs (which cloud backends can be connected).
backendsRouter.get('/meta', (_req, res) => {
  res.json({
    oneDriveConfigured: !!config.microsoft,
    googleDriveConfigured: !!config.google,
  });
});

// List the user's backends with live usage (includes disabled/errored ones).
backendsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const usage = await Promise.all(listBackends(currentUser(req).id).map(backendUsage));
    res.json(usage);
  }),
);

// Add a local-disk backend. Admin only, since it consumes the server's own disk; the admin can
// allocate it to any user (ownerId), defaulting to themselves.
backendsRouter.post(
  '/local',
  requireAdmin,
  json,
  asyncHandler(async (req, res) => {
    const ownerId = req.body?.ownerId ? String(req.body.ownerId) : currentUser(req).id;
    if (!getUser(ownerId)) throw new BadRequestError('That user does not exist.');
    const backend = addLocalBackend(ownerId, req.body?.name, req.body?.quotaBytes);
    res.status(201).json(await backendUsage(backend));
  }),
);

// Toggle enabled.
backendsRouter.patch(
  '/:id',
  json,
  asyncHandler(async (req, res) => {
    const backend = getOwnedBackend(currentUser(req).id, req.params.id);
    if (!backend) throw new NotFoundError('Backend not found.');
    if (typeof req.body?.enabled === 'boolean') setBackendEnabled(backend.id, req.body.enabled);
    res.json(await backendUsage(getBackend(backend.id)!));
  }),
);

// Remove a backend. Refuses while it still holds files so nothing is silently orphaned.
backendsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const backend = getOwnedBackend(currentUser(req).id, req.params.id);
    if (!backend) throw new NotFoundError('Backend not found.');
    if (countFilesOnBackend(backend.id) > 0) {
      throw new BadRequestError(
        'This backend still stores files. Delete or move those files before removing it.',
      );
    }
    removeBackend(backend);
    res.json({ ok: true });
  }),
);
