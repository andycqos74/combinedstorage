import { createHash } from 'node:crypto';
import { db } from '../db';
import { config } from '../config';
import {
  type UserRow,
  type UserRole,
  listUsers,
  getUser,
  getUserByUsername,
  countAdmins,
  insertUser,
  setUserPassword,
  setUserRole,
  deleteUserRow,
} from '../models/users';
import { listBackends } from '../models/backends';
import { listFilesOwnedBy, ownerFileStats, deleteNodeRow } from '../models/nodes';
import { deleteStoredBytes } from './files';
import { removeBackend } from './backends';
import { hashPassword, verifyPassword, safeEqual } from '../util/auth';
import { BadRequestError, NotFoundError } from '../util/errors';

/** What the API exposes about a user (never the password hash). */
export function publicUser(user: UserRow) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.created_at };
}

// ---- validation ------------------------------------------------------------

// Usernames appear in WebDAV URLs (/remote.php/dav/files/<user>), so keep them URL-safe.
const USERNAME_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const MIN_PASSWORD = 8;

function validateUsername(raw: unknown): string {
  const username = String(raw ?? '').trim();
  if (!USERNAME_RE.test(username)) {
    throw new BadRequestError(
      'Usernames are 1–64 characters: letters, numbers, dots, hyphens, underscores or @.',
    );
  }
  return username;
}

function validatePassword(raw: unknown): string {
  const password = String(raw ?? '');
  if (password.length < MIN_PASSWORD) {
    throw new BadRequestError(`Passwords must be at least ${MIN_PASSWORD} characters.`);
  }
  return password;
}

function validateRole(raw: unknown): UserRole {
  if (raw === 'admin' || raw === 'user') return raw;
  throw new BadRequestError("Role must be 'admin' or 'user'.");
}

// ---- authentication --------------------------------------------------------

// Hash of a throwaway password, checked when the username is unknown so a failed login takes
// about as long whether or not the account exists.
let dummyHash: Promise<string> | null = null;

/** Check a username/password pair; returns the user or null. */
export async function authenticate(username: string, password: string): Promise<UserRow | null> {
  const user = getUserByUsername(username);
  if (!user) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verifyPassword(password, await dummyHash);
    return null;
  }
  return (await verifyPassword(password, user.password_hash)) ? user : null;
}

/**
 * WebDAV clients send Basic credentials on every request, and a scrypt check per request would
 * make directory listings crawl. Successful checks are remembered briefly, keyed by a hash of the
 * credentials, and the cache is cleared whenever any password, role or account changes.
 */
const DAV_CACHE_TTL_MS = 5 * 60 * 1000;
const davCache = new Map<string, { userId: string; expires: number }>();

function clearAuthCache(): void {
  davCache.clear();
}

/** Authenticate WebDAV Basic credentials (cached; also honours the legacy DAV_USERNAME login). */
export async function authenticateDav(username: string, password: string): Promise<UserRow | null> {
  const key = createHash('sha256').update(`${username}\0${password}`).digest('hex');
  const hit = davCache.get(key);
  if (hit && hit.expires > Date.now()) {
    const user = getUser(hit.userId);
    if (user) return user;
  }

  let user = await authenticate(username, password);
  // DAV_USERNAME / DAV_PASSWORD predate user accounts; they keep working and act as the first admin.
  const legacy = config.dav.legacy;
  if (
    !user &&
    legacy &&
    safeEqual(username, legacy.username) &&
    safeEqual(password, legacy.password)
  ) {
    user = listUsers().find((u) => u.role === 'admin') ?? null;
  }
  if (user) {
    if (davCache.size > 1000) davCache.clear();
    davCache.set(key, { userId: user.id, expires: Date.now() + DAV_CACHE_TTL_MS });
  }
  return user;
}

// ---- account management ----------------------------------------------------

export async function createUser(input: {
  username: unknown;
  password: unknown;
  role?: unknown;
}): Promise<UserRow> {
  const username = validateUsername(input.username);
  const password = validatePassword(input.password);
  const role = input.role === undefined ? 'user' : validateRole(input.role);
  if (getUserByUsername(username)) throw new BadRequestError('That username is already taken.');
  return insertUser({ username, passwordHash: await hashPassword(password), role });
}

/** A user changing their own password: the current one must be supplied. */
export async function changeOwnPassword(
  userId: string,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<void> {
  const user = getUser(userId);
  if (!user) throw new NotFoundError('User not found.');
  if (!(await verifyPassword(String(currentPassword ?? ''), user.password_hash))) {
    throw new BadRequestError('Your current password is incorrect.');
  }
  setUserPassword(user.id, await hashPassword(validatePassword(newPassword)));
  clearAuthCache();
}

/** Admin: set a user's password and/or role. The last admin cannot be demoted. */
export async function updateUser(
  actorId: string,
  userId: string,
  changes: { password?: unknown; role?: unknown },
): Promise<UserRow> {
  const user = getUser(userId);
  if (!user) throw new NotFoundError('User not found.');

  if (changes.role !== undefined) {
    const role = validateRole(changes.role);
    if (user.role === 'admin' && role !== 'admin') {
      if (user.id === actorId) throw new BadRequestError('You cannot remove your own admin role.');
      if (countAdmins() <= 1) throw new BadRequestError('There must be at least one admin.');
    }
    setUserRole(user.id, role);
  }
  if (changes.password !== undefined) {
    setUserPassword(user.id, await hashPassword(validatePassword(changes.password)));
  }
  clearAuthCache();
  return getUser(user.id)!;
}

/**
 * Admin: delete an account and everything it owns — its files (including their bytes on its
 * backends), its backends, and the account itself. You cannot delete yourself.
 */
export async function deleteUser(actorId: string, userId: string): Promise<void> {
  const user = getUser(userId);
  if (!user) throw new NotFoundError('User not found.');
  if (user.id === actorId) throw new BadRequestError('You cannot delete your own account.');

  await deleteStoredBytes(listFilesOwnedBy(user.id));
  db.transaction(() => {
    deleteNodeRow(user.root_id); // cascades to the whole tree
    db.prepare('DELETE FROM nodes WHERE owner_id = ?').run(user.id); // anything stray
  })();
  for (const backend of listBackends(user.id)) removeBackend(backend);
  deleteUserRow(user.id);
  clearAuthCache();
}

/** Admin overview: every account with how much it stores and how many backends it has. */
export function userSummaries() {
  return listUsers().map((user) => {
    const backends = listBackends(user.id);
    const stats = ownerFileStats(user.id);
    return {
      ...publicUser(user),
      backendCount: backends.length,
      capacity: backends
        .filter((b) => b.enabled && b.status === 'connected')
        .reduce((sum, b) => sum + (b.quota_total ?? 0), 0),
      fileCount: stats.files,
      usedBytes: stats.bytes,
    };
  });
}
