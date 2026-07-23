import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wrap an async route handler so a rejected promise is forwarded to Express's error
 * middleware (Express 4 does not catch async errors on its own).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
