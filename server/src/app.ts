import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { migrate } from './db/migrate';
import { requireAuth } from './middleware/auth';
import { asyncHandler } from './util/asyncHandler';
import { HttpError } from './util/errors';
import { authRouter } from './routes/auth';
import { oauthRouter } from './routes/oauth';
import { filesRouter } from './routes/files';
import { adminRouter } from './routes/admin';
import { cdnRouter } from './routes/cdn';
import { webdavRouter } from './routes/webdav';
import { webdavChunksRouter } from './routes/webdavChunks';
import { sweepStaleSessions } from './services/chunks';
import { sweepVariants } from './services/images';
import { aggregateQuota } from './services/quota';

migrate();

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  session({
    name: 'cs.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// --- WebDAV drive (own Basic auth; not the cookie session) ---
if (config.dav.enabled) {
  app.use('/dav', webdavRouter);
  // Nextcloud-shaped aliases. rclone only enables chunked uploads for vendor=nextcloud, and it
  // derives the chunk endpoint from an endpoint URL matching /dav/files/<user>. Serving these
  // paths lets rclone split large files into small requests (see routes/webdavChunks.ts).
  app.use('/remote.php/dav/files/:user', webdavRouter);
  app.use('/remote.php/dav/uploads/:user', webdavChunksRouter);

  // Reclaim staging space from uploads that were aborted before finalizing.
  void sweepStaleSessions().then((n) => {
    // eslint-disable-next-line no-console
    if (n > 0) console.log(`Cleaned up ${n} stale chunked-upload session(s).`);
  });
}

// Drop image renditions that have not been requested in a long time.
void sweepVariants().then((n) => {
  // eslint-disable-next-line no-console
  if (n > 0) console.log(`Cleaned up ${n} stale image variant(s).`);
});

// --- Public (no auth): CDN file serving + OAuth callback + login ---
app.use('/f', cdnRouter);
app.use('/api/oauth', oauthRouter);
app.use('/api/auth', authRouter);

// --- Everything else under /api requires the admin session ---
app.use('/api', requireAuth);
app.get(
  '/api/storage',
  asyncHandler(async (_req, res) => {
    res.json(await aggregateQuota());
  }),
);
app.use('/api/files', filesRouter);
app.use('/api/admin', adminRouter);

// --- Front end ---
if (fs.existsSync(config.webDist)) {
  // Production: serve the built SPA and fall back to index.html for client routes.
  app.use(express.static(config.webDist));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/f/') ||
      req.path.startsWith('/dav') ||
      req.path.startsWith('/remote.php')
    ) {
      next();
      return;
    }
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
} else {
  // Dev: the SPA is served by Vite on :5173 (which proxies /api and /f here).
  app.get('/', (_req, res) => {
    res.type('text').send('Combined Storage API is running. In dev, open the app at http://localhost:5173');
  });
}

// --- 404 for unmatched API routes ---
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// --- Error handler ---
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
};
app.use(errorHandler);
