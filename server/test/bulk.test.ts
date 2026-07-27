import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app';
import * as files from '../src/services/files';
import { ROOT_ID, getNode, childByName, listChildren } from '../src/models/nodes';
import { resetDb, makeLocalBackend } from './helpers';

let server: http.Server;
let port: number;
let cookie = '';

function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = { Cookie: cookie };
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload) headers['Content-Type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const r = http.request(`http://localhost:${port}${path}`, { method, headers }, (res) => {
      const buf: Buffer[] = [];
      res.on('data', (c) => buf.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(buf).toString() }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function upload(parentId: string, name: string, content = 'x') {
  const buf = Buffer.from(content);
  return files.uploadFile({ parentId, name, stream: Readable.from(buf), size: buf.length, mimeType: 'text/plain' });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const login = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const r = http.request(
      `http://localhost:${port}/api/auth/login`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      resolve,
    );
    r.on('error', reject);
    r.write(JSON.stringify({ username: 'admin', password: 'changeme' }));
    r.end();
  });
  login.resume();
  cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0];
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  makeLocalBackend('local', 50 * 1024 * 1024);
});

describe('bulk operations API', () => {
  it('moves several items into a folder', async () => {
    const dest = files.createFolder(ROOT_ID, 'dest');
    const a = await upload(ROOT_ID, 'a.txt');
    const b = await upload(ROOT_ID, 'b.txt');

    const res = await call('POST', '/api/files/bulk/move', { ids: [a.id, b.id], parentId: dest.id });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).succeeded).toHaveLength(2);
    expect(getNode(a.id)!.parent_id).toBe(dest.id);
    expect(getNode(b.id)!.path).toBe('/dest/b.txt');
  });

  it('reports per-item failures without aborting the rest', async () => {
    const dest = files.createFolder(ROOT_ID, 'dest');
    const ok = await upload(ROOT_ID, 'ok.txt');
    const res = await call('POST', '/api/files/bulk/move', {
      ids: [ok.id, 'does-not-exist'],
      parentId: dest.id,
    });
    const out = JSON.parse(res.body);
    expect(out.succeeded).toEqual([ok.id]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].id).toBe('does-not-exist');
  });

  it('copies into a folder, auto-renaming on a name clash', async () => {
    const dest = files.createFolder(ROOT_ID, 'dest');
    const a = await upload(ROOT_ID, 'note.txt', 'hello');
    await upload(dest.id, 'note.txt', 'existing'); // clash

    const res = await call('POST', '/api/files/bulk/copy', { ids: [a.id], parentId: dest.id });
    expect(JSON.parse(res.body).succeeded).toHaveLength(1);
    expect(childByName(dest.id, 'note.txt')).toBeTruthy(); // original untouched
    expect(childByName(dest.id, 'note (2).txt')).toBeTruthy(); // copy renamed
    expect(getNode(a.id)).toBeTruthy(); // source still there
  });

  it('deletes several items', async () => {
    const a = await upload(ROOT_ID, 'a.txt');
    const folder = files.createFolder(ROOT_ID, 'gone');
    await upload(folder.id, 'inner.txt');

    const res = await call('POST', '/api/files/bulk/delete', { ids: [a.id, folder.id] });
    expect(JSON.parse(res.body).succeeded).toHaveLength(2);
    expect(listChildren(ROOT_ID)).toHaveLength(0);
  });

  it('generates friendly aliases for a selection, keeping existing ones', async () => {
    const a = await upload(ROOT_ID, 'My Report.txt');
    const b = await upload(ROOT_ID, 'b.txt');
    files.setAlias(b.id, 'keep-me');

    const res = await call('POST', '/api/files/bulk/alias', { ids: [a.id, b.id] });
    expect(JSON.parse(res.body).succeeded).toHaveLength(2);
    expect(getNode(a.id)!.alias).toBe('my-report.txt');
    expect(getNode(b.id)!.alias).toBe('keep-me');
  });

  it('copies a single item via POST /:id/copy', async () => {
    const dest = files.createFolder(ROOT_ID, 'dest');
    const a = await upload(ROOT_ID, 'one.txt', 'body');
    const res = await call('POST', `/api/files/${a.id}/copy`, { parentId: dest.id });
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body).path).toBe('/dest/one.txt');
  });

  it('rejects an empty selection', async () => {
    expect((await call('POST', '/api/files/bulk/delete', { ids: [] })).status).toBe(400);
  });
});
