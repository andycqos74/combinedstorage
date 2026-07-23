import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LocalProvider } from '../src/storage/local';

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

describe('LocalProvider', () => {
  let root: string;
  let provider: LocalProvider;

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-local-'));
    provider = new LocalProvider('test-backend', { root, quotaBytes: 1024 * 1024 });
  });
  afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('stores and retrieves content', async () => {
    const data = Buffer.from('the quick brown fox');
    const { objectKey, size } = await provider.put(Readable.from(data), { size: data.length });
    expect(size).toBe(data.length);

    const { stream, size: total } = await provider.get(objectKey);
    expect(total).toBe(data.length);
    expect((await collect(stream)).toString()).toBe('the quick brown fox');
  });

  it('serves a byte range', async () => {
    const data = Buffer.from('0123456789');
    const { objectKey } = await provider.put(Readable.from(data), { size: data.length });
    const { stream } = await provider.get(objectKey, { start: 2, end: 5 });
    expect((await collect(stream)).toString()).toBe('2345');
  });

  it('reports quota total and disk-based usage', async () => {
    const before = await provider.quota();
    const data = Buffer.alloc(1000, 7);
    await provider.put(Readable.from(data), { size: data.length });
    const after = await provider.quota();
    expect(after.total).toBe(1024 * 1024);
    expect(after.used - before.used).toBe(1000);
  });

  it('deletes content and is idempotent', async () => {
    const { objectKey } = await provider.put(Readable.from(Buffer.from('x')), { size: 1 });
    await provider.delete(objectKey);
    await expect(provider.get(objectKey)).rejects.toBeTruthy();
    await expect(provider.delete(objectKey)).resolves.toBeUndefined();
  });
});
