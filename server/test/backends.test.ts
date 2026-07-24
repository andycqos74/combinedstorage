import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migrate } from '../src/db/migrate';
import { createBackend, findBackendByAccount } from '../src/models/backends';
import { resetDb } from './helpers';

describe('findBackendByAccount (reconnect dedupe)', () => {
  beforeAll(() => migrate());
  beforeEach(() => resetDb());

  it('matches a OneDrive backend by homeAccountId', () => {
    const b = createBackend({
      name: 'OneDrive (a)',
      type: 'onedrive',
      config: { homeAccountId: 'home-a', tokenCache: 'x' },
    });
    expect(findBackendByAccount('onedrive', 'home-a')?.id).toBe(b.id);
    expect(findBackendByAccount('onedrive', 'home-b')).toBeUndefined();
  });

  it('matches a Google Drive backend by accountId', () => {
    const b = createBackend({
      name: 'Google Drive (a)',
      type: 'googledrive',
      config: { accountId: 'sub-a', refreshToken: 'r' },
    });
    expect(findBackendByAccount('googledrive', 'sub-a')?.id).toBe(b.id);
  });

  it('lets two different accounts of the same type coexist', () => {
    const a = createBackend({ name: 'OneDrive (a)', type: 'onedrive', config: { homeAccountId: 'home-a' } });
    const b = createBackend({ name: 'OneDrive (b)', type: 'onedrive', config: { homeAccountId: 'home-b' } });
    expect(findBackendByAccount('onedrive', 'home-a')?.id).toBe(a.id);
    expect(findBackendByAccount('onedrive', 'home-b')?.id).toBe(b.id);
  });

  it('does not match across backend types', () => {
    createBackend({ name: 'OneDrive (a)', type: 'onedrive', config: { homeAccountId: 'shared-key' } });
    expect(findBackendByAccount('googledrive', 'shared-key')).toBeUndefined();
  });
});
