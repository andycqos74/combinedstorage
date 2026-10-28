import type { UserRow } from '../models/users';

declare global {
  namespace Express {
    interface Request {
      /** The authenticated user, set by requireAuth (web session) or davBasicAuth (WebDAV). */
      user?: UserRow;
    }
  }
}

export {};
