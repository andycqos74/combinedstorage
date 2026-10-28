import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migrate } from '../src/db/migrate';
import { createBackend, findBackendByAccount } from '../src/models/backends';
import { resetDb, adminId } from './helpers';

function onedrive(name: string, homeAccountId: string, ownerId = adminId()) {
  return createBackend({ ownerId, name, type: 'onedrive', config: { homeAccountId } });
}

describe('findBackendByAccount (reconnect dedupe)', () => {
  beforeAll(() => migrate());
  beforeEach(() => resetDb());

  it('matches a OneDrive backend by homeAccountId', () => {
    const b = createBackend({
      ownerId: adminId(),
      name: 'OneDrive (a)',
      type: 'onedrive',
      config: { homeAccountId: 'home-a', tokenCache: 'x' },
    });
    expect(findBackendByAccount(adminId(), 'onedrive', 'home-a')?.id).toBe(b.id);
    expect(findBackendByAccount(adminId(), 'onedrive', 'home-b')).toBeUndefined();
  });

  it('matches a Google Drive backend by accountId', () => {
    const b = createBackend({
      ownerId: adminId(),
      name: 'Google Drive (a)',
      type: 'googledrive',
      config: { accountId: 'sub-a', refreshToken: 'r' },
    });
    expect(findBackendByAccount(adminId(), 'googledrive', 'sub-a')?.id).toBe(b.id);
  });

  it('lets two different accounts of the same type coexist', () => {
    const a = onedrive('OneDrive (a)', 'home-a');
    const b = onedrive('OneDrive (b)', 'home-b');
    expect(findBackendByAccount(adminId(), 'onedrive', 'home-a')?.id).toBe(a.id);
    expect(findBackendByAccount(adminId(), 'onedrive', 'home-b')?.id).toBe(b.id);
  });

  it('does not match across backend types', () => {
    onedrive('OneDrive (a)', 'shared-key');
    expect(findBackendByAccount(adminId(), 'googledrive', 'shared-key')).toBeUndefined();
  });
});
