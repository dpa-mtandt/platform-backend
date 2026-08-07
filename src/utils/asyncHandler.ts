import type { NextFunction, Request, Response, RequestHandler } from 'express';

/**
 * Wrap an async route handler so rejected promises are forwarded to the
 * Express error middleware instead of crashing the process.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
