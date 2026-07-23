import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { migrate, ROOT_ID } from '../src/db/migrate';
import * as files from '../src/services/files';
import { getNode, childByName } from '../src/models/nodes';
import { getBackend, backendConfig } from '../src/models/backends';
import { resetDb, makeLocalBackend } from './helpers';

function upload(parentId: string, name: string, content: string) {
  const buf = Buffer.from(content);
  return files.uploadFile({
    parentId,
    name,
    stream: Readable.from(buf),
    size: buf.length,
    mimeType: 'text/plain',
  });
}

describe('files service', () => {
  beforeAll(() => migrate());
  beforeEach(() => {
    resetDb();
    makeLocalBackend('local', 10 * 1024 * 1024);
  });

  it('creates folders with correct nested paths', () => {
    const docs = files.createFolder(ROOT_ID, 'docs');
    expect(docs.path).toBe('/docs');
    const sub = files.createFolder(docs.id, 'reports');
    expect(sub.path).toBe('/docs/reports');
  });

  it('rejects duplicate names in the same folder', () => {
    files.createFolder(ROOT_ID, 'docs');
    expect(() => files.createFolder(ROOT_ID, 'docs')).toThrow();
  });

  it('rejects names containing slashes', () => {
    expect(() => files.createFolder(ROOT_ID, 'a/b')).toThrow();
  });

  it('uploads a file with a size, mime, backend and public token', async () => {
    const node = await upload(ROOT_ID, 'hello.txt', 'hi there');
    expect(node.type).toBe('file');
    expect(node.size).toBe(8);
    expect(node.mime_type).toBe('text/plain');
    expect(node.backend_id).toBeTruthy();
    expect(node.public_token).toBeTruthy();
    expect(files.fileByToken(node.public_token!)?.id).toBe(node.id);
  });

  it('rename is metadata-only: token and object key are unchanged', async () => {
    const node = await upload(ROOT_ID, 'a.txt', 'content');
    const renamed = files.rename(node.id, 'b.txt');
    expect(renamed.name).toBe('b.txt');
    expect(renamed.path).toBe('/b.txt');
    expect(renamed.public_token).toBe(node.public_token);
    expect(renamed.object_key).toBe(node.object_key);
    expect(renamed.backend_id).toBe(node.backend_id);
  });

  it('renaming a folder repaths its whole subtree', async () => {
    const docs = files.createFolder(ROOT_ID, 'docs');
    const sub = files.createFolder(docs.id, 'sub');
    await upload(sub.id, 'f.txt', 'x');
    files.rename(docs.id, 'papers');
    expect(getNode(sub.id)!.path).toBe('/papers/sub');
    expect(childByName(sub.id, 'f.txt')!.path).toBe('/papers/sub/f.txt');
  });

  it('moves a node into another folder and repaths', async () => {
    const docs = files.createFolder(ROOT_ID, 'docs');
    const node = await upload(ROOT_ID, 'move-me.txt', 'x');
    files.move(node.id, docs.id);
    expect(getNode(node.id)!.path).toBe('/docs/move-me.txt');
  });

  it('prevents moving a folder into its own subtree', () => {
    const a = files.createFolder(ROOT_ID, 'a');
    const b = files.createFolder(a.id, 'b');
    expect(() => files.move(a.id, b.id)).toThrow();
  });

  it('deletes a file and removes its bytes from the backend', async () => {
    const node = await upload(ROOT_ID, 'gone.txt', 'bye');
    const backend = getBackend(node.backend_id!)!;
    const { root } = backendConfig<{ root: string }>(backend);
    const blob = path.join(root, node.object_key!);
    expect(fs.existsSync(blob)).toBe(true);

    await files.remove(node.id);
    expect(getNode(node.id)).toBeUndefined();
    expect(files.fileByToken(node.public_token!)).toBeUndefined();
    expect(fs.existsSync(blob)).toBe(false);
  });

  it('deletes a folder subtree recursively', async () => {
    const docs = files.createFolder(ROOT_ID, 'docs');
    const sub = files.createFolder(docs.id, 'sub');
    const f = await upload(sub.id, 'f.txt', 'x');
    await files.remove(docs.id);
    expect(getNode(docs.id)).toBeUndefined();
    expect(getNode(sub.id)).toBeUndefined();
    expect(getNode(f.id)).toBeUndefined();
  });
});
