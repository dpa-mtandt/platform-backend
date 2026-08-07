import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

export interface AuditEntry {
  action: string;
  module: string;
  status?: 'SUCCESS' | 'FAILURE';
  description?: string;
  entityType?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  userRoles?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Entry shape passed to req.audit() — actor + request context are auto-filled. */
export type RequestAuditEntry = Omit<AuditEntry, 'userId' | 'userEmail' | 'userName' | 'userRoles' | 'ip' | 'userAgent'> & {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  userRoles?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Client IP for audit records. Uses only Express's computed req.ip, which honours
 * the `trust proxy` setting (configured in prod). We never hand-parse
 * X-Forwarded-For — a client can spoof it to forge/frame audit-log IPs.
 */
export function clientIp(req: Request): string | undefined {
  return req.ip;
}

function parseUA(ua?: string | null): { browser?: string; device?: string } {
  if (!ua) return {};
  const browser = /edg/i.test(ua)
    ? 'Edge'
    : /chrome|crios/i.test(ua)
      ? 'Chrome'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /safari/i.test(ua)
          ? 'Safari'
          : 'Other';
  const device = /windows/i.test(ua)
    ? 'Windows'
    : /mac os/i.test(ua)
      ? 'macOS'
      : /android/i.test(ua)
        ? 'Android'
        : /iphone|ipad|ipod/i.test(ua)
          ? 'iOS'
          : /linux/i.test(ua)
            ? 'Linux'
            : 'Unknown';
  return { browser, device };
}

/** Fire-and-forget: writes an immutable audit record. Never throws to the caller. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const { browser, device } = parseUA(entry.userAgent);
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        module: entry.module,
        status: entry.status ?? 'SUCCESS',
        description: entry.description ?? undefined,
        entityType: entry.entityType ?? undefined,
        entityId: entry.entityId ?? undefined,
        oldValue: (entry.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
        newValue: (entry.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ip ?? undefined,
        userAgent: entry.userAgent ?? undefined,
        browser,
        device,
        userId: entry.userId ?? undefined,
        userEmail: entry.userEmail ?? undefined,
        userName: entry.userName ?? undefined,
        userRoles: entry.userRoles ?? undefined,
      },
    });
  } catch (err) {
    logger.error('Failed to write audit log', err);
  }
}
