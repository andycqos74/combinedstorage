import express, { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export const authRouter = Router();
const json = express.json();

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

authRouter.post('/login', json, (req, res) => {
  const username = String(req.body?.username ?? '');
  const password = String(req.body?.password ?? '');
  const ok = safeEqual(username, config.admin.username) && safeEqual(password, config.admin.password);
  if (!ok) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }
  req.session.user = username;
  res.json({ ok: true, username });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/me', (req, res) => {
  const user = req.session?.user ?? null;
  res.json({ authenticated: !!user, username: user });
});
