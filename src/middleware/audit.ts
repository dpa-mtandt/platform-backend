import type { Request, Response, NextFunction } from 'express';
import { recordAudit, clientIp } from '../utils/audit';

/**
 * Attach req.audit(entry) to every request. The actor identity (id/email/name/
 * roles) and request context (ip/user-agent) are auto-filled from req.user, so
 * controllers only describe WHAT happened.
 */
export function auditContext(req: Request, _res: Response, next: NextFunction): void {
  req.audit = (entry) => {
    void recordAudit({
      ...entry,
      userId: entry.userId ?? req.user?.id ?? null,
      userEmail: entry.userEmail ?? req.user?.email ?? null,
      userName: entry.userName ?? req.user?.name ?? null,
      userRoles: entry.userRoles ?? (req.user?.roles?.join(',') || null),
      ip: entry.ip ?? clientIp(req) ?? null,
      userAgent: entry.userAgent ?? req.get('user-agent') ?? null,
    });
  };
  next();
}
