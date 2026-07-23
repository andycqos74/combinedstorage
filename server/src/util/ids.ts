import { randomUUID, randomBytes } from 'node:crypto';

/** Primary-key generator for DB rows. */
export const newId = (): string => randomUUID();

/** ISO-8601 UTC timestamp used for created_at / updated_at columns. */
export const nowIso = (): string => new Date().toISOString();

/**
 * Unguessable, URL-safe handle used in public CDN links (/f/:token).
 * 16 random bytes -> 22 base64url chars.
 */
export const publicToken = (): string => randomBytes(16).toString('base64url');
