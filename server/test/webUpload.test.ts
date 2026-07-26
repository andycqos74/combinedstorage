import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app';
import { childByName, ROOT_ID } from '../src/models/nodes';
import { resetDb, makeLocalBackend } from './helpers';

let server: http.Server;
let port: number;
let cookie = '';

interface Res {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function call(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: Buffer | string } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  return new Promise((resolve, reject) => {
    const r = http.request(`http://localhost:${port}${path}`, { method, headers }, (res) => {
      const buf: Buffer[] = [];
      res.on('data', (c) => buf.push(c as Buffer));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(buf).toString(), headers: res.headers }),
      );
    });
    r.on('error', reject);
    if (opts.body != null) r.write(opts.body);
    r.end();
  });
}

const json = (data: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const login = await call('POST', '/api/auth/login', json({ username: 'admin', password: 'changeme' }));
  cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0];
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  makeLocalBackend('local', 50 * 1024 * 1024);
});

describe('web chunked upload API', () => {
  it('requires authentication', async () => {
    const saved = cookie;
    cookie = '';
    expect((await call('POST', `/api/files/${ROOT_ID}/upload-init`)).status).toBe(401);
    cookie = saved;
  });

  it('uploads a file in chunks and assembles it', async () => {
    const init = await call('POST', `/api/files/${ROOT_ID}/upload-init`);
    expect(init.status).toBe(201);
    const { uploadId, chunkSize } = JSON.parse(init.body);
    expect(typeof uploadId).toBe('string');
    expect(chunkSize).toBeGreaterThan(0);

    const parts = ['first-', 'second-', 'third'];
    let offset = 0;
    for (const p of parts) {
      const put = await call('PUT', `/api/files/upload-chunk/${uploadId}?offset=${offset}`, { body: p });
      expect(put.status).toBe(204);
      offset += p.length;
    }

    const done = await call(
      'POST',
      `/api/files/${ROOT_ID}/upload-complete/${uploadId}`,
      json({ name: 'assembled.txt', mimeType: 'text/plain' }),
    );
    expect(done.status).toBe(201);
    const dto = JSON.parse(done.body);
    expect(dto.name).toBe('assembled.txt');
    expect(dto.size).toBe('first-second-third'.length);
    expect(dto.url).toContain('/f/');

    const node = childByName(ROOT_ID, 'assembled.txt')!;
    expect(node.size).toBe('first-second-third'.length);
  });

  it('rejects completing an upload with no chunks', async () => {
    const { uploadId } = JSON.parse((await call('POST', `/api/files/${ROOT_ID}/upload-init`)).body);
    const done = await call(
      'POST',
      `/api/files/${ROOT_ID}/upload-complete/${uploadId}`,
      json({ name: 'empty.txt' }),
    );
    expect(done.status).toBe(400);
  });

  it('can abandon an upload session', async () => {
    const { uploadId } = JSON.parse((await call('POST', `/api/files/${ROOT_ID}/upload-init`)).body);
    await call('PUT', `/api/files/upload-chunk/${uploadId}?offset=0`, { body: 'x' });
    expect((await call('DELETE', `/api/files/upload-chunk/${uploadId}`)).status).toBe(204);
  });

  it('404s when opening a session in a folder that does not exist', async () => {
    expect((await call('POST', '/api/files/does-not-exist/upload-init')).status).toBe(404);
  });
});
