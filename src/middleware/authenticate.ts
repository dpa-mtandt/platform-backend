import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { ApiError } from '../utils/apiError';
import { asyncHandler } from '../utils/asyncHandler';
import { resolveUserAccess } from '../utils/rbac';

/**
 * Require a valid access token, then re-resolve the user's roles, permissions
 * and module access FROM THE DATABASE on this request. Because access is never
 * read from the token itself, disabling a user or revoking a permission takes
 * effect immediately (no waiting for the 15-minute access token to expire).
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing or malformed Authorization header');
  }
  const token = header.slice(7).trim();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }

  const access = await resolveUserAccess(payload.sub);
  if (!access) throw ApiError.unauthorized('Account no longer exists');
  if (access.status !== 'ACTIVE') throw ApiError.forbidden('Your account is not active. Contact an administrator.');

  req.user = access;
  next();
});

/** Attach req.user if a valid token resolves, but never reject. */
export const optionalAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7).trim());
      const access = await resolveUserAccess(payload.sub);
      if (access && access.status === 'ACTIVE') req.user = access;
    } catch {
      /* ignore — anonymous */
    }
  }
  next();
});
