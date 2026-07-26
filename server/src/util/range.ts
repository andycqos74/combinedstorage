import type { ByteRange } from '../storage/provider';

/**
 * Parse a single-range `Range: bytes=start-end` header against a known object size.
 * Returns null for absent, malformed, or unsatisfiable ranges (caller serves the full body).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, s, e] = match;

  let start: number;
  let end: number;
  if (s === '' && e === '') return null;
  if (s === '') {
    // suffix range: last N bytes
    const n = Number(e);
    if (n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === '' ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}
