import express, { Router, type Request } from 'express';
import { config } from '../config';
import { asyncHandler } from '../util/asyncHandler';
import { getUser } from '../models/users';
import { requireAuth, currentUser } from '../middleware/auth';
import { authenticate, changeOwnPassword, createUser, publicUser } from '../services/users';
import { HttpError } from '../util/errors';

export const authRouter = Router();
const json = express.json();

/** Sign a user in on a fresh session id, so a pre-login session id cannot be fixated. */
function startSession(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        reject(err);
        return;
      }
      req.session.userId = userId;
      resolve();
    });
  });
}

authRouter.post(
  '/login',
  json,
  asyncHandler(async (req, res) => {
    const user = await authenticate(
      String(req.body?.username ?? ''),
      String(req.body?.password ?? ''),
    );
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    await startSession(req, user.id);
    res.json({ ok: true, user: publicUser(user) });
  }),
);

// Self-service sign-up, only when ALLOW_SIGNUP=true. New accounts are always regular users.
authRouter.post(
  '/register',
  json,
  asyncHandler(async (req, res) => {
    if (!config.allowSignup)
      throw new HttpError(403, 'Sign-up is disabled. Ask an admin for an account.');
    const user = await createUser({ username: req.body?.username, password: req.body?.password });
    await startSession(req, user.id);
    res.status(201).json({ ok: true, user: publicUser(user) });
  }),
);

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/me', (req, res) => {
  const user = req.session?.userId ? getUser(req.session.userId) : undefined;
  res.json({
    authenticated: !!user,
    username: user?.username ?? null,
    role: user?.role ?? null,
    signupEnabled: config.allowSignup,
  });
});

authRouter.post(
  '/password',
  requireAuth,
  json,
  asyncHandler(async (req, res) => {
    await changeOwnPassword(currentUser(req).id, req.body?.currentPassword, req.body?.newPassword);
    res.json({ ok: true });
  }),
);
