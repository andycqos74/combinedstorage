import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { migrate, ROOT_ID } from '../src/db/migrate';
import * as files from '../src/services/files';
import { getFileByHandle } from '../src/models/nodes';
import { resetDb, makeLocalBackend, adminId } from './helpers';

function upload(parentId: string, name: string, content: string) {
  const buf = Buffer.from(content);
  return files.uploadFile(adminId(), {
    parentId,
    name,
    stream: Readable.from(buf),
    size: buf.length,
    mimeType: 'text/plain',
  });
}

describe('friendly aliases', () => {
  beforeAll(() => migrate());
  beforeEach(() => {
    resetDb();
    makeLocalBackend('local', 10 * 1024 * 1024);
  });

  it('sets a slugified alias, resolvable by handle (token still works too)', async () => {
    const node = await upload(ROOT_ID, 'Annual Report.pdf', 'x');
    const updated = files.setAlias(adminId(), node.id, 'Annual Report 2024');
    expect(updated.alias).toBe('annual-report-2024');
    expect(getFileByHandle('annual-report-2024')?.id).toBe(node.id);
    expect(getFileByHandle(node.public_token!)?.id).toBe(node.id);
  });

  it('rejects an alias already in use', async () => {
    const a = await upload(ROOT_ID, 'a.txt', 'x');
    const b = await upload(ROOT_ID, 'b.txt', 'y');
    files.setAlias(adminId(), a.id, 'shared');
    expect(() => files.setAlias(adminId(), b.id, 'shared')).toThrow();
  });

  it('suggests a unique alias, inserting a suffix before the extension', async () => {
    const first = await upload(ROOT_ID, 'report.pdf', 'x');
    files.setAlias(adminId(), first.id, 'report.pdf');
    const folder = files.createFolder(adminId(), ROOT_ID, 'sub');
    const second = await upload(folder.id, 'report.pdf', 'y');
    expect(files.suggestAlias(adminId(), second.id).suggestion).toBe('report-2.pdf');
  });

  it('clears an alias', async () => {
    const node = await upload(ROOT_ID, 'a.txt', 'x');
    files.setAlias(adminId(), node.id, 'my-link');
    expect(getFileByHandle('my-link')?.id).toBe(node.id);
    files.clearAlias(adminId(), node.id);
    expect(getFileByHandle('my-link')).toBeUndefined();
  });

  it('strips accents and rejects empty slugs', async () => {
    const node = await upload(ROOT_ID, 'x.txt', 'x');
    expect(files.setAlias(adminId(), node.id, 'Café Ñoño').alias).toBe('cafe-nono');
    expect(() => files.setAlias(adminId(), node.id, '!!!')).toThrow();
  });
});
