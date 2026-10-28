import express, { Router } from 'express';
import { asyncHandler } from '../util/asyncHandler';
import { currentUser } from '../middleware/auth';
import { createUser, deleteUser, publicUser, updateUser, userSummaries } from '../services/users';

/** Admin-only account management. Mounted behind requireAuth + requireAdmin. */
export const usersRouter = Router();
const json = express.json();

usersRouter.get('/', (_req, res) => {
  res.json(userSummaries());
});

usersRouter.post(
  '/',
  json,
  asyncHandler(async (req, res) => {
    const user = await createUser({
      username: req.body?.username,
      password: req.body?.password,
      role: req.body?.role,
    });
    res.status(201).json(publicUser(user));
  }),
);

// Reset a user's password and/or change their role.
usersRouter.patch(
  '/:id',
  json,
  asyncHandler(async (req, res) => {
    const user = await updateUser(currentUser(req).id, req.params.id, {
      password: req.body?.password,
      role: req.body?.role,
    });
    res.json(publicUser(user));
  }),
);

// Delete an account together with its files and backends.
usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteUser(currentUser(req).id, req.params.id);
    res.json({ ok: true });
  }),
);
