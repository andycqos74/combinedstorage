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

/** Upload a File as a raw request body via XHR, reporting progress 0..1. */
function upload(parentId: string, file: File, onProgress?: (fraction: number) => void): Promise<NodeDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/files/${parentId}/upload?name=${encodeURIComponent(file.name)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          message = JSON.parse(xhr.responseText).error || message;
        } catch {
          /* ignore */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(file);
  });
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
