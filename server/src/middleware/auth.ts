import type { Request, RequestHandler } from 'express';
import { getUser, type UserRow } from '../models/users';

/**
 * Gate for the management API. The public CDN (/f/...) and OAuth callback bypass this.
 * The user is re-read on every request, so a deleted account loses access immediately and a
 * role change applies without signing in again.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  const user = req.session?.userId ? getUser(req.session.userId) : undefined;
  if (user) {
    req.user = user;
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required.' });
};

/** Restrict a route to admins. Must run after requireAuth. */
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.user?.role === 'admin') {
    next();
    return;
  }
  res.status(403).json({ error: 'Only an admin can do that.' });
};

/** The signed-in user (requireAuth or davBasicAuth has already run). */
export function currentUser(req: Request): UserRow {
  if (!req.user) throw new Error('currentUser() called on an unauthenticated request.');
  return req.user;
}
