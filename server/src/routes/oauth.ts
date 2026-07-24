import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { asyncHandler } from '../util/asyncHandler';
import { getAuthorizeUrl as oneDriveAuthorizeUrl, connectFromCode as connectOneDrive } from '../storage/onedrive';
import { getGoogleAuthorizeUrl, connectFromCode as connectGoogle } from '../storage/googledrive';
import { createBackend } from '../models/backends';

export const oauthRouter = Router();

/** Validate an OAuth callback and return the auth code, or respond with an error and return null. */
function callbackCode(req: Request, res: Response): string | null {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    res.status(400).send(`Authorization failed: ${errorDescription || error}`);
    return null;
  }
  if (typeof code !== 'string') {
    res.status(400).send('Missing authorization code.');
    return null;
  }
  if (typeof state !== 'string' || state !== req.session.oauthState) {
    res.status(400).send('Invalid OAuth state. Please try connecting again.');
    return null;
  }
  delete req.session.oauthState;
  return code;
}

// ---- OneDrive --------------------------------------------------------------

oauthRouter.get(
  '/onedrive/start',
  asyncHandler(async (req, res) => {
    if (!config.microsoft) {
      res.status(501).send('OneDrive is not configured. Set MS_CLIENT_ID / MS_CLIENT_SECRET in the server .env.');
      return;
    }
    if (!req.session.user) {
      res.redirect('/'); // not signed in -> back to the app (login)
      return;
    }
    const state = randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(await oneDriveAuthorizeUrl(state));
  }),
);

oauthRouter.get(
  '/onedrive/callback',
  asyncHandler(async (req, res) => {
    if (!config.microsoft) {
      res.status(501).send('OneDrive is not configured.');
      return;
    }
    const code = callbackCode(req, res);
    if (!code) return;
    const { backendName, config: cfg } = await connectOneDrive(code);
    createBackend({ name: backendName, type: 'onedrive', config: cfg });
    res.redirect('/?connected=onedrive');
  }),
);

// ---- Google Drive ----------------------------------------------------------

oauthRouter.get(
  '/google/start',
  asyncHandler(async (req, res) => {
    if (!config.google) {
      res.status(501).send('Google Drive is not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the server .env.');
      return;
    }
    if (!req.session.user) {
      res.redirect('/');
      return;
    }
    const state = randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(getGoogleAuthorizeUrl(state));
  }),
);

oauthRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    if (!config.google) {
      res.status(501).send('Google Drive is not configured.');
      return;
    }
    const code = callbackCode(req, res);
    if (!code) return;
    const { backendName, config: cfg } = await connectGoogle(code);
    createBackend({ name: backendName, type: 'googledrive', config: cfg });
    res.redirect('/?connected=googledrive');
  }),
);
