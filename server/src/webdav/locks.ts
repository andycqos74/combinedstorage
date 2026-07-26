import { randomUUID } from 'node:crypto';

/**
 * Minimal "null-lock" store. We don't actually enforce locks (single-admin PoC), but Windows
 * Explorer and Office require a server that advertises class-2 locking and answers LOCK, so we
 * hand out opaque lock tokens and accept UNLOCK. rclone ignores locking entirely.
 */
export const lockStore = {
  create(): string {
    return `opaquelocktoken:${randomUUID()}`;
  },
};
