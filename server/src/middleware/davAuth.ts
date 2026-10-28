import type { Request, Response, NextFunction } from 'express';
import { authenticateDav } from '../services/users';

/**
 * HTTP Basic auth for the WebDAV endpoints. WebDAV clients authenticate on every request
 * rather than carrying the browser's cookie session, so this is separate from requireAuth.
 * Each user signs in with their own username and password and sees only their own files.
 */
export function davBasicAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    challenge(res);
    return;
  }
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  const username = sep >= 0 ? decoded.slice(0, sep) : decoded;
  const password = sep >= 0 ? decoded.slice(sep + 1) : '';
  authenticateDav(username, password).then((user) => {
    if (!user) {
      challenge(res);
      return;
    }
    req.user = user;
    next();
  }, next);
}

function challenge(res: Response): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="Combined Storage", charset="UTF-8"');
  res.status(401).send('Authentication required.');
}
