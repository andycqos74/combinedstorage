import { describe, it, expect } from 'vitest';
import { getGoogleAuthorizeUrl } from '../src/storage/googledrive';

describe('Google Drive OAuth', () => {
  it('builds an authorize URL with the params Google needs for a refresh token', () => {
    const url = new URL(getGoogleAuthorizeUrl('state-123'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');

    const p = url.searchParams;
    expect(p.get('client_id')).toBe('test-google-client');
    expect(p.get('redirect_uri')).toContain('/api/oauth/google/callback');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('access_type')).toBe('offline'); // required to receive a refresh token
    expect(p.get('prompt')).toContain('consent'); // refresh token
    expect(p.get('prompt')).toContain('select_account'); // lets a different account be added
    expect(p.get('scope')).toContain('drive.file');
    expect(p.get('state')).toBe('state-123');
  });
});
