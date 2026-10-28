import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { app } from '../src/app';
import { db } from '../src/db';
import { migrate, ROOT_ID } from '../src/db/migrate';
import * as files from '../src/services/files';
import * as users from '../src/services/users';
import { chooseBackend } from '../src/services/placement';
import { getNode, listChildren } from '../src/models/nodes';
import { getBackend, listBackends } from '../src/models/backends';
import { getUser, type UserRow } from '../src/models/users';
import { InsufficientSpaceError } from '../src/util/errors';
import { resetDb, makeLocalBackend, adminId } from './helpers';

let server: http.Server;
let port: number;

interface Res {
  status: number;
  body: string;
}

function call(
  method: string,
  path: string,
  opts: { cookie?: string; auth?: string; json?: unknown; body?: string } = {},
): Promise<Res & { cookie: string }> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.auth) headers.Authorization = 'Basic ' + Buffer.from(opts.auth).toString('base64');
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
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
    if (body != null) r.write(body);
    r.end();
  });
}

async function login(username: string, password: string): Promise<string> {
  const res = await call('POST', '/api/auth/login', { json: { username, password } });
  expect(res.status).toBe(200);
  return res.cookie;
}

function upload(userId: string, parentId: string, name: string, content = 'x') {
  const buf = Buffer.from(content);
  return files.uploadFile(userId, {
    parentId,
    name,
    stream: Readable.from(buf),
    size: buf.length,
    mimeType: 'text/plain',
  });
}

let alice: UserRow;
let bob: UserRow;

beforeAll(async () => {
  migrate();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());
beforeEach(async () => {
  resetDb();
  alice = await users.createUser({ username: 'alice', password: 'alice-pass' });
  bob = await users.createUser({ username: 'bob', password: 'bob-pass1' });
});

describe('per-user file trees', () => {
  it('gives each new user their own empty root, reachable as "root"', async () => {
    makeLocalBackend('alice disk', 1_000_000, alice.id);
    await upload(alice.id, ROOT_ID, 'alice.txt');

    expect(files.listFolder(alice.id, ROOT_ID).children.map((n) => n.name)).toEqual(['alice.txt']);
    expect(files.listFolder(bob.id, ROOT_ID).children).toEqual([]);
    expect(files.listFolder(adminId(), ROOT_ID).children).toEqual([]);
    expect(files.listFolder(alice.id, ROOT_ID).folder.id).toBe(alice.root_id);
  });

  it("treats another user's nodes as missing", async () => {
    makeLocalBackend('alice disk', 1_000_000, alice.id);
    const folder = files.createFolder(alice.id, ROOT_ID, 'private');
    const file = await upload(alice.id, folder.id, 'secret.txt');
    const bobFolder = files.createFolder(bob.id, ROOT_ID, 'mine');

    expect(() => files.listFolder(bob.id, folder.id)).toThrow(/not found/i);
    expect(() => files.listFolder(bob.id, alice.root_id)).toThrow(/not found/i);
    expect(() => files.rename(bob.id, file.id, 'pwned.txt')).toThrow(/not found/i);
    expect(() => files.move(bob.id, file.id, bobFolder.id)).toThrow(/not found/i);
    expect(() => files.move(alice.id, file.id, bobFolder.id)).toThrow(/not found/i);
    expect(() => files.createFolder(bob.id, folder.id, 'intruder')).toThrow(/not found/i);
    expect(() => files.setAlias(bob.id, file.id, 'stolen')).toThrow(/not found/i);
    await expect(files.remove(bob.id, file.id)).rejects.toThrow(/not found/i);
    await expect(files.copyNode(bob.id, file.id, bobFolder.id, 'copy.txt', false)).rejects.toThrow(
      /not found/i,
    );
    expect(files.nodeName(bob.id, file.id)).toBeUndefined();
    expect(files.breadcrumb(bob.id, folder.id)).toEqual([]);

    // Nothing changed.
    expect(getNode(file.id)?.name).toBe('secret.txt');
    expect(getNode(file.id)?.parent_id).toBe(folder.id);
    expect(listChildren(bobFolder.id)).toEqual([]);
  });

  it('new nodes inherit the owner of their parent', async () => {
    makeLocalBackend('bob disk', 1_000_000, bob.id);
    const folder = files.createFolder(bob.id, ROOT_ID, 'docs');
    const file = await upload(bob.id, folder.id, 'a.txt');
    const copy = await files.copyNode(bob.id, file.id, ROOT_ID, 'b.txt', false);
    expect([folder, file, copy].map((n) => n.owner_id)).toEqual([bob.id, bob.id, bob.id]);
  });

  it("places uploads only on the uploader's own backends", async () => {
    const aliceDisk = makeLocalBackend('alice disk', 1_000_000, alice.id);
    makeLocalBackend('bob disk', 10_000_000, bob.id); // more free space, but not Alice's

    const node = await upload(alice.id, ROOT_ID, 'a.txt');
    expect(node.backend_id).toBe(aliceDisk.id);

    // A user with no backends has nowhere to put anything.
    await expect(chooseBackend(adminId(), 1)).rejects.toBeInstanceOf(InsufficientSpaceError);
  });
});

describe('account management', () => {
  it('rejects duplicate usernames (case-insensitively) and short passwords', async () => {
    await expect(users.createUser({ username: 'ALICE', password: 'whatever1' })).rejects.toThrow(
      /taken/,
    );
    await expect(users.createUser({ username: 'carol', password: 'short' })).rejects.toThrow(/8/);
    await expect(
      users.createUser({ username: 'bad name', password: 'whatever1' }),
    ).rejects.toThrow();
  });

  it('keeps at least one admin and stops admins removing themselves', async () => {
    await expect(users.updateUser(adminId(), adminId(), { role: 'user' })).rejects.toThrow();
    await expect(users.deleteUser(adminId(), adminId())).rejects.toThrow();
  });

  it("deleting a user removes their files, bytes and backends but nobody else's", async () => {
    const disk = makeLocalBackend('alice disk', 1_000_000, alice.id);
    makeLocalBackend('bob disk', 1_000_000, bob.id);
    const aliceFile = await upload(alice.id, ROOT_ID, 'a.txt');
    const bobFile = await upload(bob.id, ROOT_ID, 'b.txt');

    await users.deleteUser(adminId(), alice.id);

    expect(getUser(alice.id)).toBeUndefined();
    expect(getNode(aliceFile.id)).toBeUndefined();
    expect(getNode(alice.root_id)).toBeUndefined();
    expect(getBackend(disk.id)).toBeUndefined();
    expect(getNode(bobFile.id)).toBeDefined();
    expect(listBackends(bob.id)).toHaveLength(1);
  });

  it('adopts data from before user accounts into the first admin', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO nodes (id, parent_id, name, type, path, created_at, updated_at)
       VALUES ('legacy', 'root', 'old', 'folder', '/old', ?, ?)`,
    ).run(now, now);
    migrate();
    expect(getNode('legacy')?.owner_id).toBe(adminId());
  });
});

describe('HTTP API isolation', () => {
  it('scopes /api/files and /api/storage to the signed-in user', async () => {
    makeLocalBackend('alice disk', 1_000_000, alice.id);
    const file = await upload(alice.id, ROOT_ID, 'alice.txt');
    const bobCookie = await login('bob', 'bob-pass1');

    const list = await call('GET', '/api/files/root', { cookie: bobCookie });
    expect(list.status).toBe(200);
    expect(JSON.parse(list.body).children).toEqual([]);

    expect((await call('GET', `/api/files/${alice.root_id}`, { cookie: bobCookie })).status).toBe(
      404,
    );
    expect((await call('DELETE', `/api/files/${file.id}`, { cookie: bobCookie })).status).toBe(404);
    const bulk = await call('POST', '/api/files/bulk/delete', {
      cookie: bobCookie,
      json: { ids: [file.id] },
    });
    expect(JSON.parse(bulk.body).succeeded).toEqual([]);
    expect(getNode(file.id)).toBeDefined();

    const storage = JSON.parse((await call('GET', '/api/storage', { cookie: bobCookie })).body);
    expect(storage.total).toBe(0);
    expect(storage.backends).toEqual([]);
  });

  it("lists and changes only the user's own backends", async () => {
    const aliceDisk = makeLocalBackend('alice disk', 1_000_000, alice.id);
    const bobCookie = await login('bob', 'bob-pass1');

    expect(JSON.parse((await call('GET', '/api/backends', { cookie: bobCookie })).body)).toEqual(
      [],
    );
    const patch = await call('PATCH', `/api/backends/${aliceDisk.id}`, {
      cookie: bobCookie,
      json: { enabled: false },
    });
    expect(patch.status).toBe(404);
    expect(
      (await call('DELETE', `/api/backends/${aliceDisk.id}`, { cookie: bobCookie })).status,
    ).toBe(404);
    expect(getBackend(aliceDisk.id)?.enabled).toBe(1);
  });

  it('keeps user management and local disks admin-only', async () => {
    const bobCookie = await login('bob', 'bob-pass1');
    expect((await call('GET', '/api/users', { cookie: bobCookie })).status).toBe(403);
    const local = await call('POST', '/api/backends/local', {
      cookie: bobCookie,
      json: { name: 'free disk', quotaBytes: 1e12 },
    });
    expect(local.status).toBe(403);

    const adminCookie = await login('admin', 'changeme');
    const created = await call('POST', '/api/users', {
      cookie: adminCookie,
      json: { username: 'carol', password: 'carol-pass' },
    });
    expect(created.status).toBe(201);
    const carol = JSON.parse(created.body);
    expect(carol.role).toBe('user');
    expect(carol.password_hash).toBeUndefined();

    const given = await call('POST', '/api/backends/local', {
      cookie: adminCookie,
      json: { name: 'carol disk', quotaBytes: 1000, ownerId: carol.id },
    });
    expect(given.status).toBe(201);
    expect(listBackends(carol.id)).toHaveLength(1);
    expect(listBackends(adminId())).toHaveLength(0);

    const carolCookie = await login('carol', 'carol-pass');
    const me = JSON.parse((await call('GET', '/api/auth/me', { cookie: carolCookie })).body);
    expect(me).toMatchObject({ authenticated: true, username: 'carol', role: 'user' });
  });

  it('lets a user change their own password', async () => {
    const cookie = await login('bob', 'bob-pass1');
    const wrong = await call('POST', '/api/auth/password', {
      cookie,
      json: { currentPassword: 'nope', newPassword: 'bob-pass2' },
    });
    expect(wrong.status).toBe(400);
    const ok = await call('POST', '/api/auth/password', {
      cookie,
      json: { currentPassword: 'bob-pass1', newPassword: 'bob-pass2' },
    });
    expect(ok.status).toBe(200);
    expect(
      (await call('POST', '/api/auth/login', { json: { username: 'bob', password: 'bob-pass1' } }))
        .status,
    ).toBe(401);
    await login('bob', 'bob-pass2');
  });

  it("ends a deleted user's session", async () => {
    const cookie = await login('bob', 'bob-pass1');
    await users.deleteUser(adminId(), bob.id);
    expect((await call('GET', '/api/files/root', { cookie })).status).toBe(401);
  });

  it('refuses sign-up unless ALLOW_SIGNUP is on', async () => {
    const res = await call('POST', '/api/auth/register', {
      json: { username: 'eve', password: 'eve-pass1' },
    });
    expect(res.status).toBe(403);
  });

  it('refuses an OAuth callback without a signed-in user', async () => {
    const res = await call('GET', '/api/oauth/google/callback?code=c&state=s');
    expect(res.status).toBe(401);
  });
});

describe('WebDAV isolation', () => {
  it("serves each user's own tree under their own login", async () => {
    makeLocalBackend('alice disk', 1_000_000, alice.id);
    makeLocalBackend('bob disk', 1_000_000, bob.id);

    expect(
      (await call('PUT', '/dav/note.txt', { auth: 'alice:alice-pass', body: 'from alice' })).status,
    ).toBe(201);
    expect(
      (await call('PUT', '/dav/note.txt', { auth: 'bob:bob-pass1', body: 'from bob' })).status,
    ).toBe(201);

    expect((await call('GET', '/dav/note.txt', { auth: 'alice:alice-pass' })).body).toBe(
      'from alice',
    );
    expect((await call('GET', '/dav/note.txt', { auth: 'bob:bob-pass1' })).body).toBe('from bob');
    expect((await call('GET', '/dav/note.txt', { auth: 'admin:changeme' })).status).toBe(404);
    expect((await call('GET', '/dav/note.txt', { auth: 'bob:wrong-pass' })).status).toBe(401);
  });

  it('stops accepting a password once it is changed', async () => {
    expect((await call('PROPFIND', '/dav/', { auth: 'bob:bob-pass1' })).status).toBe(207);
    await users.updateUser(adminId(), bob.id, { password: 'bob-pass2' });
    expect((await call('PROPFIND', '/dav/', { auth: 'bob:bob-pass1' })).status).toBe(401);
    expect((await call('PROPFIND', '/dav/', { auth: 'bob:bob-pass2' })).status).toBe(207);
  });
});
