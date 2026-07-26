import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app';
import { childByName, ROOT_ID } from '../src/models/nodes';
import * as files from '../src/services/files';
import { resetDb, makeLocalBackend } from './helpers';

let server: http.Server;
let port: number;
const AUTH = 'Basic ' + Buffer.from('admin:changeme').toString('base64');

interface DavResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function dav(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string; auth?: boolean } = {},
): Promise<DavResponse> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers.Authorization = AUTH;
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${port}${path}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }),
      );
    });
    req.on('error', reject);
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  resetDb();
  makeLocalBackend('local', 10 * 1024 * 1024);
});

describe('WebDAV endpoint', () => {
  it('requires Basic auth', async () => {
    expect((await dav('PROPFIND', '/dav/', { auth: false })).status).toBe(401);
    expect((await dav('PROPFIND', '/dav/', { headers: { Depth: '0' } })).status).toBe(207);
  });

  it('OPTIONS advertises DAV compliance', async () => {
    const res = await dav('OPTIONS', '/dav/');
    expect(res.status).toBe(200);
    expect(String(res.headers['dav'])).toContain('2');
  });

  it('PUT creates a file, GET reads it, PROPFIND lists it', async () => {
    expect((await dav('PUT', '/dav/hello.txt', { body: 'hello dav' })).status).toBe(201);
    const get = await dav('GET', '/dav/hello.txt');
    expect(get.status).toBe(200);
    expect(get.body).toBe('hello dav');

    const list = await dav('PROPFIND', '/dav/', { headers: { Depth: '1' } });
    expect(list.status).toBe(207);
    expect(list.body).toContain('/dav/hello.txt');
    expect(list.body).toContain('quota-available-bytes');
  });

  it('PUT overwrite keeps node id, token and alias; updates size', async () => {
    await dav('PUT', '/dav/a.txt', { body: 'v1' });
    const before = childByName(ROOT_ID, 'a.txt')!;
    files.setAlias(before.id, 'my-link'); // give it a friendly alias

    const res = await dav('PUT', '/dav/a.txt', { body: 'version two longer' });
    expect(res.status).toBe(204);

    const after = childByName(ROOT_ID, 'a.txt')!;
    expect(after.id).toBe(before.id);
    expect(after.public_token).toBe(before.public_token);
    expect(after.alias).toBe('my-link');
    expect(after.size).toBe('version two longer'.length);
    expect((await dav('GET', '/dav/a.txt')).body).toBe('version two longer');
  });

  it('serves a byte range (206)', async () => {
    await dav('PUT', '/dav/r.txt', { body: '0123456789' });
    const res = await dav('GET', '/dav/r.txt', { headers: { Range: 'bytes=2-5' } });
    expect(res.status).toBe(206);
    expect(res.body).toBe('2345');
  });

  it('MKCOL, MOVE and DELETE', async () => {
    expect((await dav('MKCOL', '/dav/docs')).status).toBe(201);
    await dav('PUT', '/dav/note.txt', { body: 'x' });

    const move = await dav('MOVE', '/dav/note.txt', {
      headers: { Destination: `http://localhost:${port}/dav/docs/renamed.txt` },
    });
    expect([201, 204]).toContain(move.status);
    expect((await dav('GET', '/dav/docs/renamed.txt')).body).toBe('x');
    expect((await dav('GET', '/dav/note.txt')).status).toBe(404);

    expect((await dav('DELETE', '/dav/docs')).status).toBe(204);
    expect((await dav('PROPFIND', '/dav/docs', { headers: { Depth: '0' } })).status).toBe(404);
  });
});
