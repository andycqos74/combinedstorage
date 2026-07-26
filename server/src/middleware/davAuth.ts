import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { safeEqual } from '../util/auth';

/**
 * HTTP Basic auth for the WebDAV endpoints. WebDAV clients authenticate on every request
 * rather than carrying the browser's cookie session, so this is separate from requireAuth.
 */
export function davBasicAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
    const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
    if (safeEqual(user, config.dav.username) && safeEqual(pass, config.dav.password)) {
      next();
      return;
    }
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Combined Storage", charset="UTF-8"');
  res.status(401).send('Authentication required.');
}
