import { Readable } from 'node:stream';
import { ConfidentialClientApplication } from '@azure/msal-node';
import type {
  StorageProvider,
  PutOptions,
  PutResult,
  ByteRange,
  GetResult,
  QuotaInfo,
} from './provider';
import {
  type BackendRow,
  backendConfig,
  updateBackendConfig,
} from '../models/backends';
import { config } from '../config';
import { newId } from '../util/ids';

/** Persisted per-backend config for a connected OneDrive account. */
export interface OneDriveConfig {
  /** Serialized MSAL token cache (holds the refresh token). */
  tokenCache: string;
  /** MSAL account id used to silently refresh access tokens. */
  homeAccountId: string;
  account?: string;
  driveId?: string;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024; // <=4 MiB -> single PUT
const CHUNK = 5 * 320 * 1024; // 1.6 MiB, a multiple of 320 KiB (Graph requirement)

function requireMicrosoft() {
  if (!config.microsoft) {
    throw new Error('OneDrive is not configured (missing MS_CLIENT_ID / MS_CLIENT_SECRET).');
  }
  return config.microsoft;
}

function makeCca(cacheData?: string): ConfidentialClientApplication {
  const ms = requireMicrosoft();
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: ms.clientId,
      authority: `https://login.microsoftonline.com/${ms.tenant}`,
      clientSecret: ms.clientSecret,
    },
  });
  if (cacheData) cca.getTokenCache().deserialize(cacheData);
  return cca;
}

// ---- OAuth flow helpers (used by routes/oauth.ts) --------------------------

export async function getAuthorizeUrl(state: string): Promise<string> {
  const ms = requireMicrosoft();
  return makeCca().getAuthCodeUrl({
    scopes: ms.scopes,
    redirectUri: ms.redirectUri,
    state,
    // Always show the account picker so a *different* account can be connected instead of
    // silently reusing whoever is already signed in to this browser.
    prompt: 'select_account',
  });
}

/**
 * Exchange an auth code for tokens and build a ready-to-store backend config. `accountKey`
 * (the MSAL homeAccountId) uniquely identifies the connected account so a reconnect updates
 * the existing backend instead of creating a duplicate.
 */
export async function connectFromCode(
  code: string,
): Promise<{ backendName: string; accountKey: string; config: OneDriveConfig }> {
  const ms = requireMicrosoft();
  const cca = makeCca();
  const result = await cca.acquireTokenByCode({
    code,
    scopes: ms.scopes,
    redirectUri: ms.redirectUri,
  });
  if (!result?.account) throw new Error('OneDrive sign-in did not return an account.');

  const drive = await graphJson('/me/drive', result.accessToken);
  const cfg: OneDriveConfig = {
    tokenCache: cca.getTokenCache().serialize(),
    homeAccountId: result.account.homeAccountId,
    account: result.account.username,
    driveId: drive.id,
  };
  return {
    backendName: `OneDrive (${result.account.username})`,
    accountKey: result.account.homeAccountId,
    config: cfg,
  };
}

// ---- Graph REST helpers ----------------------------------------------------

async function graph(
  path: string,
  accessToken: string,
  init: { method?: string; headers?: Record<string, string>; body?: Buffer | string } = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${GRAPH}${path}`;
  return fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
    body: init.body,
  });
}

async function graphJson(
  path: string,
  accessToken: string,
  init?: { method?: string; headers?: Record<string, string>; body?: Buffer | string },
): Promise<any> {
  const res = await graph(path, accessToken, init);
  if (!res.ok) {
    throw new Error(`Graph ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function encodeDrivePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Re-chunk an arbitrary stream into fixed-size buffers (last one may be smaller). */
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

export class OneDriveProvider implements StorageProvider {
  readonly type = 'onedrive';
  readonly backendId: string;

  constructor(private readonly row: BackendRow) {
    this.backendId = row.id;
  }

  /** Get a valid access token, refreshing (and re-persisting the cache) as needed. */
  private async token(): Promise<string> {
    const ms = requireMicrosoft();
    const cfg = backendConfig<OneDriveConfig>(this.row);
    const cca = makeCca(cfg.tokenCache);
    const account = await cca.getTokenCache().getAccountByHomeId(cfg.homeAccountId);
    if (!account) {
      throw new Error('OneDrive account is no longer in the token cache; reconnect the backend.');
    }
    const result = await cca.acquireTokenSilent({ account, scopes: ms.scopes });
    if (!result) throw new Error('Failed to acquire a OneDrive access token.');

    const updated = cca.getTokenCache().serialize();
    if (updated !== cfg.tokenCache) {
      updateBackendConfig(this.row.id, { ...cfg, tokenCache: updated });
    }
    return result.accessToken;
  }

  async put(data: Readable, opts: PutOptions): Promise<PutResult> {
    const token = await this.token();
    const drivePath = encodeDrivePath(`CombinedStorage/${newId()}`);

    if (opts.size <= SIMPLE_UPLOAD_LIMIT) {
      const buf = await readAll(data);
      const item = await graphJson(`/me/drive/root:/${drivePath}:/content`, token, {
        method: 'PUT',
        headers: { 'Content-Type': opts.contentType || 'application/octet-stream' },
        body: buf,
      });
      return { objectKey: item.id, size: item.size ?? buf.length };
    }

    // Large file: resumable upload session with 1.6 MiB chunks.
    const session = await graphJson(`/me/drive/root:/${drivePath}:/createUploadSession`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    const uploadUrl: string = session.uploadUrl;
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
      } else if (res.status !== 202) {
        throw new Error(`OneDrive chunk upload failed: ${res.status} ${await res.text()}`);
      }
      offset = end + 1;
    }
    if (!finalItem) throw new Error('OneDrive upload session did not complete.');
    return { objectKey: finalItem.id, size: finalItem.size ?? total };
  }

  async get(objectKey: string, range?: ByteRange): Promise<GetResult> {
    const token = await this.token();
    const item = await graphJson(`/me/drive/items/${objectKey}`, token);
    const size: number = item.size ?? 0;
    const downloadUrl: string | undefined = item['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) throw new Error('OneDrive item has no download URL.');

    const headers: Record<string, string> = {};
    if (range) headers.Range = `bytes=${range.start}-${range.end}`;
    const res = await fetch(downloadUrl, { headers });
    if (!res.ok && res.status !== 206) {
      throw new Error(`OneDrive download failed: ${res.status}`);
    }
    if (!res.body) throw new Error('OneDrive download returned an empty body.');

    return {
      stream: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      size,
      contentType: item.file?.mimeType,
    };
  }

  async delete(objectKey: string): Promise<void> {
    const token = await this.token();
    const res = await graph(`/me/drive/items/${objectKey}`, token, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`OneDrive delete failed: ${res.status} ${await res.text()}`);
    }
  }

  async quota(): Promise<QuotaInfo> {
    const token = await this.token();
    const drive = await graphJson('/me/drive', token);
    const q = drive.quota ?? {};
    return { total: q.total ?? 0, used: q.used ?? 0 };
  }
}
