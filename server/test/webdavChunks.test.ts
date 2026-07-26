import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app';
import { config } from '../src/config';
import { childByName, ROOT_ID } from '../src/models/nodes';
import { resetDb, makeLocalBackend } from './helpers';

let server: http.Server;
let port: number;
const AUTH = 'Basic ' + Buffer.from('admin:changeme').toString('base64');
const FILES = '/remote.php/dav/files/admin';
const UPLOADS = '/remote.php/dav/uploads/admin';

interface Res {
  status: number;
  body: string;
}

function req(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: Buffer | string; auth?: boolean } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers.Authorization = AUTH;
  return new Promise((resolve, reject) => {
    const r = http.request(`http://localhost:${port}${path}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    if (opts.body != null) r.write(opts.body);
    r.end();
  });
}

/** Chunk name in rclone's format: 15-digit zero-padded start-end byte offsets. */
function chunkName(start: number, end: number): string {
  return `${String(start).padStart(15, '0')}-${String(end).padStart(15, '0')}`;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  makeLocalBackend('local', 50 * 1024 * 1024);
});

describe('chunked upload (Nextcloud protocol used by rclone)', () => {
  it('requires auth', async () => {
    expect((await req('MKCOL', `${UPLOADS}/rclone-chunked-upload-abc`, { auth: false })).status).toBe(401);
  });

  it('assembles chunks into one file with the correct content and size', async () => {
    const session = 'rclone-chunked-upload-test1';
    const parts = ['aaaa', 'bbbb', 'cc'];
    expect((await req('MKCOL', `${UPLOADS}/${session}`)).status).toBe(201);

    let offset = 0;
    for (const p of parts) {
      const name = chunkName(offset, offset + p.length - 1);
      expect((await req('PUT', `${UPLOADS}/${session}/${name}`, { body: p })).status).toBe(201);
      offset += p.length;
    }

    const move = await req('MOVE', `${UPLOADS}/${session}/.file`, {
      headers: { Destination: `http://localhost:${port}${FILES}/big.txt` },
    });
    expect(move.status).toBe(201);

    const get = await req('GET', `${FILES}/big.txt`);
    expect(get.body).toBe('aaaabbbbcc');
    expect(childByName(ROOT_ID, 'big.txt')!.size).toBe(10);
  });

  it('orders chunks by offset even when they arrive out of order', async () => {
    const session = 'rclone-chunked-upload-test2';
    await req('MKCOL', `${UPLOADS}/${session}`);
    // Upload the second chunk first (rclone transfers chunks concurrently).
    await req('PUT', `${UPLOADS}/${session}/${chunkName(5, 9)}`, { body: 'WORLD' });
    await req('PUT', `${UPLOADS}/${session}/${chunkName(0, 4)}`, { body: 'hello' });
    await req('MOVE', `${UPLOADS}/${session}/.file`, {
      headers: { Destination: `http://localhost:${port}${FILES}/ordered.txt` },
    });
    expect((await req('GET', `${FILES}/ordered.txt`)).body).toBe('helloWORLD');
  });

  it('removes the staging directory after assembly', async () => {
    const session = 'rclone-chunked-upload-test3';
    await req('MKCOL', `${UPLOADS}/${session}`);
    await req('PUT', `${UPLOADS}/${session}/${chunkName(0, 2)}`, { body: 'xyz' });
    await req('MOVE', `${UPLOADS}/${session}/.file`, {
      headers: { Destination: `http://localhost:${port}${FILES}/x.txt` },
    });
    expect(fs.existsSync(`${config.chunkRoot}/${session}`)).toBe(false);
  });

  it('fails cleanly when the destination folder does not exist', async () => {
    const session = 'rclone-chunked-upload-test4';
    await req('MKCOL', `${UPLOADS}/${session}`);
    await req('PUT', `${UPLOADS}/${session}/${chunkName(0, 0)}`, { body: 'z' });
    const move = await req('MOVE', `${UPLOADS}/${session}/.file`, {
      headers: { Destination: `http://localhost:${port}${FILES}/nope/deep.txt` },
    });
    expect(move.status).toBe(409);
  });

  it('rejects a path-traversal session name', async () => {
    expect((await req('MKCOL', `${UPLOADS}/..%2f..%2fevil`)).status).toBe(400);
  });

  it('DELETE abandons an upload session', async () => {
    const session = 'rclone-chunked-upload-test5';
    await req('MKCOL', `${UPLOADS}/${session}`);
    await req('PUT', `${UPLOADS}/${session}/${chunkName(0, 1)}`, { body: 'ab' });
    expect((await req('DELETE', `${UPLOADS}/${session}`)).status).toBe(204);
    expect(fs.existsSync(`${config.chunkRoot}/${session}`)).toBe(false);
  });
});
