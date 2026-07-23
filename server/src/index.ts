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
import { aggregateQuota } from './services/quota';

migrate();

const app = express();
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
    if (req.path.startsWith('/api') || req.path.startsWith('/f/')) {
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

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Combined Storage server listening on http://localhost:${config.port}`);
  if (!config.microsoft) {
    // eslint-disable-next-line no-console
    console.log('OneDrive not configured (set MS_CLIENT_ID / MS_CLIENT_SECRET to enable it).');
  }
});
