import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp, { type Sharp } from 'sharp';
import { config } from '../config';

/**
 * Image processing: shrinking/re-encoding uploads to save space, and rendering on-demand
 * variants (thumbnails, fixed widths, alternate formats) for CDN use.
 *
 * Two deliberate exclusions: SVG (vector — rasterising it loses the point) and GIF (animation
 * would be flattened). Both are passed through untouched.
 */

const CONVERTIBLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif']);

const EXTENSIONS: Record<string, string> = {
  webp: '.webp',
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  avif: '.avif',
};

const MIME_FOR: Record<string, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
};

export function isConvertibleImage(mimeType?: string | null): boolean {
  return !!mimeType && CONVERTIBLE.has(mimeType.toLowerCase());
}

/** Swap a filename's extension, e.g. ("photo.JPG", ".webp") -> "photo.webp". */
export function replaceExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}${extension}`;
}

function encode(pipeline: Sharp, format: string, quality: number): Sharp {
  switch (format) {
    case 'jpeg':
    case 'jpg':
      return pipeline.jpeg({ quality, mozjpeg: true });
    case 'png':
      return pipeline.png({ compressionLevel: 9 });
    case 'avif':
      return pipeline.avif({ quality });
    case 'webp':
    default:
      return pipeline.webp({ quality });
  }
}

export interface ConvertedUpload {
  buffer: Buffer;
  mimeType: string;
  /** Filename with the new extension (unchanged when the format did not change). */
  name: string;
  originalBytes: number;
}

/**
 * Apply the global upload rule: auto-orient, scale the longest edge down to the configured
 * maximum, re-encode to the target format, and drop EXIF (sharp strips metadata by default,
 * and `.rotate()` bakes in the orientation first so the image doesn't end up sideways).
 *
 * Returns null when conversion doesn't apply or wouldn't help — including when the result comes
 * out bigger than the original, which happens with already-optimised images.
 */
export async function convertForUpload(
  buffer: Buffer,
  name: string,
  mimeType: string,
): Promise<ConvertedUpload | null> {
  if (!config.images.convertOnUpload) return null;
  if (!isConvertibleImage(mimeType)) return null;
  if (buffer.length > config.images.maxConvertBytes) return null;

  const { format, quality, maxDimension } = config.images;

  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;

    const pipeline = sharp(buffer)
      .rotate() // apply EXIF orientation before we discard the metadata
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true });

    const out = await encode(pipeline, format, quality).toBuffer();

    // Don't "save space" by making the file bigger.
    if (out.length >= buffer.length) return null;

    const extension = EXTENSIONS[format] ?? '.webp';
    return {
      buffer: out,
      mimeType: MIME_FOR[format] ?? 'image/webp',
      name: replaceExtension(name, extension),
      originalBytes: buffer.length,
    };
  } catch {
    // A corrupt or unsupported image should never block the upload — store it as-is.
    return null;
  }
}

// ---- on-demand variants ----------------------------------------------------

export interface VariantParams {
  w?: number;
  h?: number;
  fit: 'cover' | 'inside';
  fmt?: string;
  q: number;
}

function positiveInt(value: unknown, max = 10000): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), max);
}

/**
 * Read variant options off a query string. Returns null when the request asks for the file as
 * stored, so the normal path serves it untouched.
 */
export function parseVariantParams(query: Record<string, unknown>): VariantParams | null {
  if (!config.images.variantsEnabled) return null;
  const w = positiveInt(query.w);
  const h = positiveInt(query.h);
  const fmtRaw = typeof query.fmt === 'string' ? query.fmt.toLowerCase() : undefined;
  const fmt = fmtRaw && MIME_FOR[fmtRaw] ? fmtRaw : undefined;
  if (!w && !h && !fmt) return null;

  const q = positiveInt(query.q, 100) ?? config.images.quality;
  const fit = query.fit === 'inside' ? 'inside' : 'cover';
  return { w, h, fit, fmt, q };
}

export function variantMimeType(params: VariantParams, sourceMime: string): string {
  return params.fmt ? (MIME_FOR[params.fmt] ?? sourceMime) : sourceMime;
}

/** Render a rendition. `cover` crops to fill (what fixed-ratio presets need); `inside` fits within. */
export async function renderVariant(source: Buffer, params: VariantParams): Promise<Buffer> {
  let pipeline = sharp(source).rotate();
  if (params.w || params.h) {
    pipeline = pipeline.resize({
      width: params.w,
      height: params.h,
      fit: params.fit,
      withoutEnlargement: true,
    });
  }
  if (params.fmt) pipeline = encode(pipeline, params.fmt, params.q);
  return pipeline.toBuffer();
}

/**
 * Cache path for a rendition. The key includes a content version, because a file's token stays
 * the same when its bytes are replaced — keying on the token alone would serve pre-edit variants
 * forever.
 */
export function variantCachePath(token: string, version: string, params: VariantParams): string {
  const key = crypto
    .createHash('sha1')
    .update(`${token}|${version}|${params.w ?? ''}x${params.h ?? ''}|${params.fit}|${params.fmt ?? ''}|${params.q}`)
    .digest('hex');
  return path.join(config.variantRoot, `${key}.bin`);
}

export async function readCachedVariant(cachePath: string): Promise<Buffer | null> {
  try {
    return await fsp.readFile(cachePath);
  } catch {
    return null;
  }
}

export async function writeCachedVariant(cachePath: string, data: Buffer): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    // Write via a temp file so a concurrent reader never sees a half-written variant.
    const tmp = `${cachePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, cachePath);
  } catch {
    // Caching is an optimisation; failing to write it must not fail the request.
  }
}

/** Drop cached variants that haven't been read for a while, so the cache can't grow forever. */
export async function sweepVariants(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<number> {
  let entries: string[];
  try {
    entries = await fsp.readdir(config.variantRoot);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    const file = path.join(config.variantRoot, name);
    try {
      const stat = await fsp.stat(file);
      if (stat.mtimeMs < cutoff) {
        await fsp.rm(file, { force: true });
        removed++;
      }
    } catch {
      /* ignore races */
    }
  }
  return removed;
}

/**
 * Collect a stream into memory. Only call this once the declared size is known to be small
 * (see shouldAttemptConversion) — a stream cannot be rewound, so deciding mid-read is not an option.
 */
export async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Whether an upload is worth buffering for conversion, decided before any bytes are read. */
export function shouldAttemptConversion(mimeType: string | undefined, declaredSize: number): boolean {
  return (
    config.images.convertOnUpload &&
    isConvertibleImage(mimeType) &&
    declaredSize > 0 &&
    declaredSize <= config.images.maxConvertBytes
  );
}
