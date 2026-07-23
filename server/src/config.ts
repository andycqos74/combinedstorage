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

const msClientId = process.env.MS_CLIENT_ID?.trim();
const msClientSecret = process.env.MS_CLIENT_SECRET?.trim();

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  redirectUri: string;
  scopes: string[];
}

export const config = {
  port,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  dataDir,
  dbPath: path.join(dataDir, 'combined.db'),
  /** Base directory under which local backends store their blobs (one subdir per backend). */
  localRoot: path.join(dataDir, 'local'),
  /** Directory containing the built web SPA (served in production). */
  webDist: path.resolve(serverDir, '..', 'web', 'dist'),
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'changeme',
  },
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-me',
  isProd: process.env.NODE_ENV === 'production',
  microsoft:
    msClientId && msClientSecret
      ? ({
          clientId: msClientId,
          clientSecret: msClientSecret,
          tenant: process.env.MS_TENANT || 'common',
          redirectUri:
            process.env.MS_REDIRECT_URI || `http://localhost:${port}/api/oauth/onedrive/callback`,
          scopes: (process.env.MS_SCOPES || 'Files.ReadWrite offline_access User.Read')
            .split(/\s+/)
            .filter(Boolean),
        } satisfies MicrosoftConfig)
      : null,
} as const;

export type AppConfig = typeof config;
