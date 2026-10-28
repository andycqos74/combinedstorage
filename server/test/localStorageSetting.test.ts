import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { app } from '../src/app';
import { ROOT_ID } from '../src/db/migrate';
import * as files from '../src/services/files';
import * as users from '../src/services/users';
import { aggregateQuota } from '../src/services/quota';
import { getSettings, updateSettings } from '../src/models/settings';
import { InsufficientSpaceError } from '../src/util/errors';
import { resetDb, makeLocalBackend, adminId } from './helpers';

let server: http.Server;
let port: number;

function call(
  method: string,
  path: string,
  opts: { cookie?: string; json?: unknown } = {},
): Promise<{ status: number; body: string; cookie: string }> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const r = http.request(`http://localhost:${port}${path}`, { method, headers }, (res) => {
      const buf: Buffer[] = [];
      res.on('data', (c) => buf.push(c as Buffer));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(buf).toString(),
          cookie: String(res.headers['set-cookie']?.[0] ?? '').split(';')[0],
        }),
      );
    });
    r.on('error', reject);
    if (opts.json !== undefined) r.write(JSON.stringify(opts.json));
    r.end();
  });
}

async function login(username: string, password: string): Promise<string> {
  return (await call('POST', '/api/auth/login', { json: { username, password } })).cookie;
}

function upload(name: string) {
  const buf = Buffer.from('content');
  return files.uploadFile(adminId(), {
    parentId: ROOT_ID,
    name,
    stream: Readable.from(buf),
    size: buf.length,
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());
beforeEach(() => resetDb());

describe('local disk storage switch', () => {
  it('is on by default', () => {
    expect(getSettings().localStorageEnabled).toBe(true);
  });

  it('when off, local disks take no new uploads and leave the pool, but files stay readable', async () => {
    makeLocalBackend('disk', 1_000_000);
    const before = await upload('before.txt');

    updateSettings({ localStorageEnabled: false });
    await expect(upload('after.txt')).rejects.toBeInstanceOf(InsufficientSpaceError);
    expect((await aggregateQuota(adminId())).total).toBe(0);
    const { stream } = await files.openFile(before);
    expect(Buffer.concat(await stream.toArray()).toString()).toBe('content');
    await files.remove(adminId(), before.id); // can still be cleaned up

    updateSettings({ localStorageEnabled: true });
    expect((await upload('again.txt')).backend_id).toBeTruthy();
  });

  it('only admins can change it, and adding a local disk is refused while it is off', async () => {
    await users.createUser({ username: 'bob', password: 'bob-pass1' });
    const bob = await login('bob', 'bob-pass1');
    const admin = await login('admin', 'changeme');

    expect(JSON.parse((await call('GET', '/api/settings', { cookie: bob })).body)).toEqual({
      localStorageEnabled: true,
    });
    const denied = await call('PATCH', '/api/settings', {
      cookie: bob,
      json: { localStorageEnabled: false },
    });
    expect(denied.status).toBe(403);
    expect(getSettings().localStorageEnabled).toBe(true);

    const off = await call('PATCH', '/api/settings', {
      cookie: admin,
      json: { localStorageEnabled: false },
    });
    expect(JSON.parse(off.body).localStorageEnabled).toBe(false);
    const add = await call('POST', '/api/backends/local', {
      cookie: admin,
      json: { name: 'disk', quotaBytes: 1000 },
    });
    expect(add.status).toBe(403);
    const meta = JSON.parse((await call('GET', '/api/backends/meta', { cookie: bob })).body);
    expect(meta.localStorageEnabled).toBe(false);
  });
});
