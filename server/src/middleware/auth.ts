import type { RequestHandler } from 'express';

/** Gate for the management API. The public CDN (/f/...) and OAuth callback bypass this. */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.session?.user) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required.' });
};
