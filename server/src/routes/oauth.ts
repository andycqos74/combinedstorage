import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { asyncHandler } from '../util/asyncHandler';
import { getAuthorizeUrl, connectFromCode } from '../storage/onedrive';
import { createBackend } from '../models/backends';

export const oauthRouter = Router();

// Begin the OneDrive connect flow (admin only). Full-page redirect to Microsoft.
oauthRouter.get(
  '/onedrive/start',
  asyncHandler(async (req, res) => {
    if (!config.microsoft) {
      res
        .status(501)
        .send('OneDrive is not configured. Set MS_CLIENT_ID / MS_CLIENT_SECRET in the server .env.');
      return;
    }
    if (!req.session.user) {
      res.redirect('/'); // not signed in -> back to the app (login)
      return;
    }
    const state = randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(await getAuthorizeUrl(state));
  }),
);

// Microsoft redirects back here with an auth code. Exchange it and register the backend.
oauthRouter.get(
  '/onedrive/callback',
  asyncHandler(async (req, res) => {
    if (!config.microsoft) {
      res.status(501).send('OneDrive is not configured.');
      return;
    }
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) {
      res.status(400).send(`OneDrive authorization failed: ${errorDescription || error}`);
      return;
    }
    if (typeof code !== 'string') {
      res.status(400).send('Missing authorization code.');
      return;
    }
    if (typeof state !== 'string' || state !== req.session.oauthState) {
      res.status(400).send('Invalid OAuth state. Please try connecting again.');
      return;
    }
    delete req.session.oauthState;

    const { backendName, config: cfg } = await connectFromCode(code);
    createBackend({ name: backendName, type: 'onedrive', config: cfg });
    res.redirect('/?connected=onedrive');
  }),
);
