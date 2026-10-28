import express, { Router } from 'express';
import { getSettings, updateSettings } from '../models/settings';
import { requireAdmin } from '../middleware/auth';

/** Site-wide settings: anyone signed in can read them, only admins can change them. */
export const settingsRouter = Router();
const json = express.json();

settingsRouter.get('/', (_req, res) => {
  res.json(getSettings());
});

settingsRouter.patch('/', requireAdmin, json, (req, res) => {
  res.json(updateSettings(req.body ?? {}));
});
