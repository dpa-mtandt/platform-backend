import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';

/**
 * RBAC guards. All of them are BYPASSED for a super admin, and all of them read
 * exclusively from req.user (populated by `authenticate` from the database), so
 * they are the authoritative gate — the UI hiding a control is only cosmetic.
 */

/** Require a specific permission key. */
export function requirePermission(permissionKey: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.isSuperAdmin) return next();
    if (!req.user.permissions.has(permissionKey)) {
      throw ApiError.forbidden(`Missing permission: ${permissionKey}`);
    }
    next();
  };
}

/** Require AT LEAST ONE of the given permission keys. */
export function requireAnyPermission(...permissionKeys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.isSuperAdmin) return next();
    if (!permissionKeys.some((k) => req.user!.permissions.has(k))) {
      throw ApiError.forbidden('You do not have permission to perform this action');
    }
    next();
  };
}

/** Require ALL of the given permission keys. */
export function requireAllPermissions(...permissionKeys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.isSuperAdmin) return next();
    if (!permissionKeys.every((k) => req.user!.permissions.has(k))) {
      throw ApiError.forbidden('You do not have permission to perform this action');
    }
    next();
  };
}

/** Require access to a whole module (e.g. LMS, DASHBOARD, FEEDBACK). */
export function requireModule(moduleKey: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.isSuperAdmin) return next();
    if (!req.user.modules.has(moduleKey)) {
      throw ApiError.forbidden('You do not have access to this module');
    }
    next();
  };
}

/** Require the caller to be a super admin. */
export function requireSuperAdmin() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw ApiError.unauthorized();
    if (!req.user.isSuperAdmin) throw ApiError.forbidden('Super administrator access required');
    next();
  };
}
