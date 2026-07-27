// API client. Same-origin: in dev Vite proxies /api and /f to the server; in prod the
// server serves this SPA and the API together.

export interface NodeDto {
  id: string;
  parentId: string | null;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size: number | null;
  mimeType: string | null;
  url: string | null;
  alias: string | null;
  aliasUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Crumb {
  id: string;
  name: string;
}

export interface ListResponse {
  folder: NodeDto;
  breadcrumb: Crumb[];
  children: NodeDto[];
}

export interface BackendUsage {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  total: number;
  used: number;
  free: number;
}

export interface Usage {
  total: number;
  used: number;
  free: number;
  backends: BackendUsage[];
}

/** Outcome of a bulk operation: some items may fail without aborting the rest. */
export interface BulkResult {
  succeeded: string[];
  failed: { id: string; name?: string; error: string }[];
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...opts });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  const contentType = res.headers.get('content-type') || '';
  return (contentType.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

function jsonBody(data: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

/** Send one request body via XHR, reporting bytes sent so callers can aggregate progress. */
function xhrSend(
  method: string,
  url: string,
  body: Blob,
  opts: { contentType?: string; onBytes?: (loaded: number) => void } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    if (opts.contentType) xhr.setRequestHeader('Content-Type', opts.contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onBytes) opts.onBytes(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          message = JSON.parse(xhr.responseText).error || message;
        } catch {
          /* non-JSON error body */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(body);
  });
}

/**
 * Upload a file, reporting progress 0..1.
 *
 * Files above the server's chunk size are sent as a sequence of smaller requests (open a session,
 * PUT each chunk, then complete). That keeps every request under any proxy request-body cap —
 * notably Cloudflare's ~100 MB limit — so large uploads work through the tunnel. Smaller files
 * take the single-request path.
 */
async function upload(
  parentId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<NodeDto> {
  const CHUNK_THRESHOLD = 32 * 1024 * 1024;

  if (file.size <= CHUNK_THRESHOLD) {
    const text = await xhrSend(
      'POST',
      `/api/files/${parentId}/upload?name=${encodeURIComponent(file.name)}`,
      file,
      {
        contentType: file.type || 'application/octet-stream',
        onBytes: (loaded) => onProgress?.(file.size ? loaded / file.size : 1),
      },
    );
    return JSON.parse(text);
  }

  const { uploadId, chunkSize } = await req<{ uploadId: string; chunkSize: number }>(
    `/api/files/${parentId}/upload-init`,
    { method: 'POST' },
  );

  try {
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + chunkSize, file.size);
      const slice = file.slice(offset, end);
      const sent = offset; // bytes fully transferred before this chunk
      await xhrSend('PUT', `/api/files/upload-chunk/${uploadId}?offset=${offset}`, slice, {
        contentType: 'application/octet-stream',
        onBytes: (loaded) => onProgress?.((sent + loaded) / file.size),
      });
      offset = end;
      onProgress?.(offset / file.size);
    }
    return await req<NodeDto>(`/api/files/${parentId}/upload-complete/${uploadId}`, {
      method: 'POST',
      ...jsonBody({ name: file.name, mimeType: file.type || undefined }),
    });
  } catch (err) {
    // Best-effort: free the server's staging space if the upload failed part-way.
    void fetch(`/api/files/upload-chunk/${uploadId}`, { method: 'DELETE', credentials: 'include' });
    throw err;
  }
}

export const api = {
  me: () => req<{ authenticated: boolean; username: string | null }>('/api/auth/me'),
  login: (username: string, password: string) =>
    req<{ ok: true }>('/api/auth/login', { method: 'POST', ...jsonBody({ username, password }) }),
  logout: () => req<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  list: (folderId: string) => req<ListResponse>(`/api/files/${folderId}`),
  storage: () => req<Usage>('/api/storage'),
  createFolder: (parentId: string, name: string) =>
    req<NodeDto>(`/api/files/${parentId}/folders`, { method: 'POST', ...jsonBody({ name }) }),
  rename: (id: string, name: string) =>
    req<NodeDto>(`/api/files/${id}/rename`, { method: 'PATCH', ...jsonBody({ name }) }),
  move: (id: string, parentId: string) =>
    req<NodeDto>(`/api/files/${id}/move`, { method: 'PATCH', ...jsonBody({ parentId }) }),
  remove: (id: string) => req<{ ok: true }>(`/api/files/${id}`, { method: 'DELETE' }),
  upload,

  copy: (id: string, parentId: string) =>
    req<NodeDto>(`/api/files/${id}/copy`, { method: 'POST', ...jsonBody({ parentId }) }),

  bulkMove: (ids: string[], parentId: string) =>
    req<BulkResult>('/api/files/bulk/move', { method: 'POST', ...jsonBody({ ids, parentId }) }),
  bulkCopy: (ids: string[], parentId: string) =>
    req<BulkResult>('/api/files/bulk/copy', { method: 'POST', ...jsonBody({ ids, parentId }) }),
  bulkDelete: (ids: string[]) =>
    req<BulkResult>('/api/files/bulk/delete', { method: 'POST', ...jsonBody({ ids }) }),
  bulkAlias: (ids: string[]) =>
    req<BulkResult>('/api/files/bulk/alias', { method: 'POST', ...jsonBody({ ids }) }),

  suggestAlias: (id: string) =>
    req<{ suggestion: string; currentAlias: string | null }>(`/api/files/${id}/alias/suggest`),
  setAlias: (id: string, alias: string) =>
    req<NodeDto>(`/api/files/${id}/alias`, { method: 'PUT', ...jsonBody({ alias }) }),
  clearAlias: (id: string) => req<NodeDto>(`/api/files/${id}/alias`, { method: 'DELETE' }),

  meta: () =>
    req<{ oneDriveConfigured: boolean; googleDriveConfigured: boolean }>('/api/admin/meta'),
  backends: () => req<BackendUsage[]>('/api/admin/backends'),
  addLocal: (name: string, quotaBytes: number) =>
    req<BackendUsage>('/api/admin/backends/local', { method: 'POST', ...jsonBody({ name, quotaBytes }) }),
  setBackendEnabled: (id: string, enabled: boolean) =>
    req<BackendUsage>(`/api/admin/backends/${id}`, { method: 'PATCH', ...jsonBody({ enabled }) }),
  removeBackend: (id: string) => req<{ ok: true }>(`/api/admin/backends/${id}`, { method: 'DELETE' }),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
