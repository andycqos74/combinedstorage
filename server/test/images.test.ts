import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { migrate, ROOT_ID } from '../src/db/migrate';
import { config } from '../src/config';
import * as files from '../src/services/files';
import * as images from '../src/services/images';
import { resetDb, makeLocalBackend } from './helpers';

/** A photo-like JPEG that is deliberately larger than the conversion cap. */
async function makeJpeg(width = 4000, height = 3000): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 30 } },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

const originalSettings = { ...config.images };

beforeAll(() => migrate());
beforeEach(() => {
  resetDb();
  makeLocalBackend('local', 200 * 1024 * 1024);
});
afterEach(() => {
  Object.assign(config.images, originalSettings);
});

describe('upload conversion', () => {
  it('leaves images alone when conversion is disabled', async () => {
    config.images.convertOnUpload = false;
    const jpeg = await makeJpeg(800, 600);
    const node = await files.uploadFile({
      parentId: ROOT_ID,
      name: 'photo.jpg',
      stream: Readable.from(jpeg),
      size: jpeg.length,
      mimeType: 'image/jpeg',
    });
    expect(node.name).toBe('photo.jpg');
    expect(node.mime_type).toBe('image/jpeg');
    expect(node.size).toBe(jpeg.length);
  });

  it('resizes and converts to WebP when enabled, renaming the extension', async () => {
    config.images.convertOnUpload = true;
    config.images.maxDimension = 1024;
    const jpeg = await makeJpeg(4000, 3000);

    const node = await files.uploadFile({
      parentId: ROOT_ID,
      name: 'holiday photo.JPG',
      stream: Readable.from(jpeg),
      size: jpeg.length,
      mimeType: 'image/jpeg',
    });

    expect(node.name).toBe('holiday photo.webp');
    expect(node.mime_type).toBe('image/webp');
    expect(node.size!).toBeLessThan(jpeg.length);

    // The stored bytes really are a resized WebP.
    const stored = await files.readFileBytes(node);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width!, meta.height!)).toBe(1024);
  });

  it('passes through images that would not get smaller', async () => {
    config.images.convertOnUpload = true;
    config.images.maxDimension = 4096;
    // A tiny already-compressed WebP: re-encoding cannot beat it.
    const webp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp({ quality: 1 })
      .toBuffer();

    const node = await files.uploadFile({
      parentId: ROOT_ID,
      name: 'tiny.webp',
      stream: Readable.from(webp),
      size: webp.length,
      mimeType: 'image/webp',
    });
    expect(node.size).toBe(webp.length);
  });

  it('does not touch non-image files or SVGs', async () => {
    config.images.convertOnUpload = true;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    const node = await files.uploadFile({
      parentId: ROOT_ID,
      name: 'logo.svg',
      stream: Readable.from(svg),
      size: svg.length,
      mimeType: 'image/svg+xml',
    });
    expect(node.name).toBe('logo.svg');
    expect(node.size).toBe(svg.length);
  });

  it('applies to drive writes too (writeFileAtPath)', async () => {
    config.images.convertOnUpload = true;
    config.images.maxDimension = 512;
    const jpeg = await makeJpeg(2000, 2000);

    const node = await files.writeFileAtPath({
      parentId: ROOT_ID,
      name: 'from-drive.jpg',
      stream: Readable.from(jpeg),
      size: jpeg.length,
      mimeType: 'image/jpeg',
    });
    expect(node.name).toBe('from-drive.webp');
    const meta = await sharp(await files.readFileBytes(node)).metadata();
    expect(meta.width).toBe(512);
  });

  it('streams very large images through untouched rather than buffering them', async () => {
    config.images.convertOnUpload = true;
    config.images.maxConvertBytes = 1024; // pretend anything over 1 KB is too big
    const jpeg = await makeJpeg(600, 400);
    expect(jpeg.length).toBeGreaterThan(1024);

    const node = await files.uploadFile({
      parentId: ROOT_ID,
      name: 'big.jpg',
      stream: Readable.from(jpeg),
      size: jpeg.length,
      mimeType: 'image/jpeg',
    });
    expect(node.name).toBe('big.jpg');
    expect(node.size).toBe(jpeg.length);
  });
});

describe('on-demand variants', () => {
  it('parses only genuine variant requests', () => {
    expect(images.parseVariantParams({})).toBeNull();
    expect(images.parseVariantParams({ foo: 'bar' })).toBeNull();
    expect(images.parseVariantParams({ w: '800' })).toMatchObject({ w: 800, fit: 'cover' });
    expect(images.parseVariantParams({ fmt: 'webp' })).toMatchObject({ fmt: 'webp' });
    expect(images.parseVariantParams({ w: '-5' })).toBeNull(); // rejects nonsense
    expect(images.parseVariantParams({ w: '300', fit: 'inside' })).toMatchObject({ fit: 'inside' });
  });

  it('renders a resized rendition, cropping to fill for fixed ratios', async () => {
    const jpeg = await makeJpeg(1600, 900);
    const square = await images.renderVariant(jpeg, { w: 400, h: 400, fit: 'cover', q: 80 });
    const meta = await sharp(square).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(400);
  });

  it('converts format on demand', async () => {
    const jpeg = await makeJpeg(300, 200);
    const webp = await images.renderVariant(jpeg, { w: 150, fit: 'inside', fmt: 'webp', q: 70 });
    expect((await sharp(webp).metadata()).format).toBe('webp');
  });

  it('keys the cache on the content version so edits invalidate variants', () => {
    const params: images.VariantParams = { w: 200, fit: 'cover', q: 80 };
    const a = images.variantCachePath('tok', '1000', params);
    const b = images.variantCachePath('tok', '2000', params);
    expect(a).not.toBe(b);
    // ...and different transforms of the same version are distinct too
    expect(images.variantCachePath('tok', '1000', { ...params, w: 400 })).not.toBe(a);
  });
});
