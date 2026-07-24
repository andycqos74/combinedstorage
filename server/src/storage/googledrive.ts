import { Readable } from 'node:stream';
import type {
  StorageProvider,
  PutOptions,
  PutResult,
  ByteRange,
  GetResult,
  QuotaInfo,
} from './provider';
import { type BackendRow, backendConfig } from '../models/backends';
import { config } from '../config';
import { newId } from '../util/ids';

/** Persisted per-backend config for a connected Google account. */
export interface GoogleDriveConfig {
  /** Long-lived refresh token; access tokens are minted from it on demand. */
  refreshToken: string;
  account?: string;
  /** Stable Google user id (`sub`), used to recognise a reconnect of the same account. */
  accountId?: string;
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SIMPLE_UPLOAD_LIMIT = 5 * 1024 * 1024; // <=5 MiB -> multipart upload
const CHUNK = 8 * 256 * 1024; // 2 MiB, a multiple of 256 KiB (Drive resumable requirement)
const UNLIMITED_FALLBACK = 1024 ** 4; // nominal 1 TiB when the account reports no quota limit

function requireGoogle() {
  if (!config.google) {
    throw new Error('Google Drive is not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  }
  return config.google;
}

// ---- OAuth flow helpers (used by routes/oauth.ts) --------------------------

export function getGoogleAuthorizeUrl(state: string): string {
  const g = requireGoogle();
  const params = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: g.redirectUri,
    response_type: 'code',
    scope: g.scopes.join(' '),
    access_type: 'offline', // ask for a refresh token
    // Show the account chooser (so a different account can be added) and force consent
    // (so a refresh token is always returned).
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Google token request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Exchange an auth code for a refresh token and build a ready-to-store backend config.
 * `accountKey` (the Google `sub`) uniquely identifies the account so a reconnect updates the
 * existing backend instead of creating a duplicate.
 */
export async function connectFromCode(
  code: string,
): Promise<{ backendName: string; accountKey: string; config: GoogleDriveConfig }> {
  const g = requireGoogle();
  const tok = await tokenRequest({
    code,
    client_id: g.clientId,
    client_secret: g.clientSecret,
    redirect_uri: g.redirectUri,
    grant_type: 'authorization_code',
  });
  if (!tok.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Remove this app under your Google Account permissions, then reconnect.',
    );
  }

  let account: string | undefined;
  let accountId: string | undefined;
  try {
    const info = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (info.ok) {
      const data = (await info.json()) as { email?: string; sub?: string };
      account = data.email;
      accountId = data.sub;
    }
  } catch {
    // identity is best-effort
  }

  return {
    backendName: `Google Drive (${account ?? 'account'})`,
    accountKey: accountId ?? account ?? tok.refresh_token,
    config: { refreshToken: tok.refresh_token, account, accountId },
  };
}

// ---- token cache + REST helpers --------------------------------------------

// Access tokens are short-lived; cache per refresh token to avoid a mint on every call.
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

async function accessTokenFor(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  const g = requireGoogle();
  const tok = await tokenRequest({
    client_id: g.clientId,
    client_secret: g.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const accessToken = tok.access_token as string;
  tokenCache.set(refreshToken, {
    accessToken,
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
  });
  return accessToken;
}

async function driveJson(
  url: string,
  token: string,
  init: { method?: string; headers?: Record<string, string>; body?: Buffer | string } = {},
): Promise<any> {
  const res = await fetch(url.startsWith('http') ? url : `${DRIVE}${url}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    body: init.body,
  });
  if (!res.ok) {
    throw new Error(`Google Drive ${init.method ?? 'GET'} ${url} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function* fixedChunks(stream: Readable, size: number): AsyncGenerator<Buffer> {
  let buf = Buffer.alloc(0);
  for await (const piece of stream) {
    buf = Buffer.concat([buf, piece as Buffer]);
    while (buf.length >= size) {
      yield buf.subarray(0, size);
      buf = buf.subarray(size);
    }
  }
  if (buf.length > 0) yield buf;
}

// ---- Provider --------------------------------------------------------------

export class GoogleDriveProvider implements StorageProvider {
  readonly type = 'googledrive';
  readonly backendId: string;

  constructor(private readonly row: BackendRow) {
    this.backendId = row.id;
  }

  private token(): Promise<string> {
    return accessTokenFor(backendConfig<GoogleDriveConfig>(this.row).refreshToken);
  }

  async put(data: Readable, opts: PutOptions): Promise<PutResult> {
    const token = await this.token();
    // The logical name lives in our DB; store the Drive file under an opaque name.
    const name = newId();
    const contentType = opts.contentType || 'application/octet-stream';

    if (opts.size <= SIMPLE_UPLOAD_LIMIT) {
      const bytes = await readAll(data);
      const boundary = `cs-${newId()}`;
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name })}\r\n`,
        ),
        Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const item = await driveJson(`${UPLOAD}?uploadType=multipart&fields=id,size`, token, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return { objectKey: item.id, size: Number(item.size ?? bytes.length) };
    }

    // Larger files: resumable upload session, 2 MiB chunks.
    const initRes = await fetch(`${UPLOAD}?uploadType=resumable&fields=id,size`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': contentType,
        'X-Upload-Content-Length': String(opts.size),
      },
      body: JSON.stringify({ name }),
    });
    if (!initRes.ok) {
      throw new Error(`Google Drive resumable init failed: ${initRes.status} ${await initRes.text()}`);
    }
    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('Google Drive resumable upload returned no session URL.');

    const total = opts.size;
    let offset = 0;
    let finalItem: any = null;
    for await (const chunk of fixedChunks(data, CHUNK)) {
      const start = offset;
      const end = offset + chunk.length - 1;
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end}/${total}`,
        },
        body: chunk,
      });
      if (res.status === 200 || res.status === 201) {
        finalItem = await res.json();
      } else if (res.status !== 308) {
        // 308 Resume Incomplete = keep going
        throw new Error(`Google Drive chunk upload failed: ${res.status} ${await res.text()}`);
      }
      offset = end + 1;
    }
    if (!finalItem) throw new Error('Google Drive upload session did not complete.');
    return { objectKey: finalItem.id, size: Number(finalItem.size ?? total) };
  }

  async get(objectKey: string, range?: ByteRange): Promise<GetResult> {
    const token = await this.token();
    const meta = await driveJson(`/files/${objectKey}?fields=size,mimeType`, token);
    const size = Number(meta.size ?? 0);

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) headers.Range = `bytes=${range.start}-${range.end}`;
    const res = await fetch(`${DRIVE}/files/${objectKey}?alt=media`, { headers });
    if (!res.ok && res.status !== 206) throw new Error(`Google Drive download failed: ${res.status}`);
    if (!res.body) throw new Error('Google Drive download returned an empty body.');

    return {
      stream: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      size,
      contentType: meta.mimeType,
    };
  }

  async delete(objectKey: string): Promise<void> {
    const token = await this.token();
    const res = await fetch(`${DRIVE}/files/${objectKey}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Google Drive delete failed: ${res.status} ${await res.text()}`);
    }
  }

  async quota(): Promise<QuotaInfo> {
    const token = await this.token();
    const about = await driveJson('/about?fields=storageQuota', token);
    const q = about.storageQuota ?? {};
    const used = Number(q.usage ?? 0);
    // `limit` is absent for unlimited accounts — report a nominal capacity so it stays usable.
    const total = q.limit !== undefined ? Number(q.limit) : used + UNLIMITED_FALLBACK;
    return { total, used };
  }
}
