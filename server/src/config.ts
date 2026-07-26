import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// __dirname at runtime: server/src (dev via tsx) or server/dist (built). Both are
// one level below the server workspace, two below the repo root.
const serverDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverDir, '..');

// Prefer a repo-root .env (where .env.example lives); allow a server/.env override.
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(serverDir, '.env') });

function resolveDataDir(): string {
  const raw = process.env.DATA_DIR || './data';
  return path.isAbsolute(raw) ? raw : path.resolve(serverDir, raw);
}

const port = Number(process.env.PORT || 4000);
const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });

// The externally-reachable base URL (e.g. https://file.example.com behind a tunnel/proxy).
// Public CDN links and, by default, the OAuth callback URLs are built from this.
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';

const msClientId = process.env.MS_CLIENT_ID?.trim();
const msClientSecret = process.env.MS_CLIENT_SECRET?.trim();
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  redirectUri: string;
  scopes: string[];
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export const config = {
  port,
  publicBaseUrl,
  dataDir,
  dbPath: path.join(dataDir, 'combined.db'),
  /** Base directory under which local backends store their blobs (one subdir per backend). */
  localRoot: path.join(dataDir, 'local'),
  /** Staging area for in-progress chunked WebDAV uploads (one subdir per upload session). */
  chunkRoot: path.join(dataDir, 'chunks'),
  /** Directory containing the built web SPA (served in production). */
  webDist: path.resolve(serverDir, '..', 'web', 'dist'),
  admin: {
    username: adminUsername,
    password: adminPassword,
  },
  // WebDAV drive endpoint (/dav). Enabled by default; credentials default to the admin login.
  dav: {
    enabled: (process.env.DAV_ENABLED ?? 'true').toLowerCase() !== 'false',
    username: process.env.DAV_USERNAME || adminUsername,
    password: process.env.DAV_PASSWORD || adminPassword,
  },
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-me',
  isProd: process.env.NODE_ENV === 'production',
  // Whether the session cookie requires HTTPS. Defaults to on in production, but can be
  // forced off (COOKIE_SECURE=false) to test over plain HTTP, e.g. a local Docker container.
  cookieSecure:
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE.toLowerCase() === 'true'
      : process.env.NODE_ENV === 'production',
  // When true, every uploaded file automatically gets a friendly alias derived from its name.
  autoAliasOnUpload: (process.env.AUTO_ALIAS_ON_UPLOAD ?? '').toLowerCase() === 'true',
  // Chunk size the web UI uses for large uploads. Each chunk is a separate request, so this must
  // stay below any proxy request-body cap in front of the server (Cloudflare Free/Pro = 100 MB).
  uploadChunkSize: Math.max(1, Number(process.env.UPLOAD_CHUNK_MB) || 32) * 1024 * 1024,
  microsoft:
    msClientId && msClientSecret
      ? ({
          clientId: msClientId,
          clientSecret: msClientSecret,
          tenant: process.env.MS_TENANT || 'common',
          redirectUri:
            process.env.MS_REDIRECT_URI || `${publicBaseUrl}/api/oauth/onedrive/callback`,
          scopes: (process.env.MS_SCOPES || 'Files.ReadWrite offline_access User.Read')
            .split(/\s+/)
            .filter(Boolean),
        } satisfies MicrosoftConfig)
      : null,
  google:
    googleClientId && googleClientSecret
      ? ({
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          redirectUri:
            process.env.GOOGLE_REDIRECT_URI || `${publicBaseUrl}/api/oauth/google/callback`,
          scopes: (
            process.env.GOOGLE_SCOPES || 'https://www.googleapis.com/auth/drive.file openid email'
          )
            .split(/\s+/)
            .filter(Boolean),
        } satisfies GoogleConfig)
      : null,
} as const;

export type AppConfig = typeof config;
