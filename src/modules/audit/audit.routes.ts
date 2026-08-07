import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination';

const router = Router();
router.use(authenticate);

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  module: z.string().optional(),
  action: z.string().optional(),
  status: z.enum(['SUCCESS', 'FAILURE']).optional(),
  userId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

/**
 * @openapi
 * /audit:
 *   get: { tags: [Audit], summary: List audit log entries (paginated, filterable), security: [{ bearerAuth: [] }], responses: { 200: { description: Audit entries } } }
 */
router.get(
  '/',
  requirePermission('platform.audit.view'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof listQuery>;
    const { page, limit, skip } = parsePagination(q, 25, 100);

    const and: Prisma.AuditLogWhereInput[] = [];
    if (q.module) and.push({ module: q.module });
    if (q.action) and.push({ action: q.action });
    if (q.status) and.push({ status: q.status });
    if (q.userId) and.push({ userId: q.userId });
    if (q.search) {
      const s = q.search;
      and.push({
        OR: [
          { description: { contains: s, mode: 'insensitive' } },
          { userEmail: { contains: s, mode: 'insensitive' } },
          { userName: { contains: s, mode: 'insensitive' } },
          { action: { contains: s, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.AuditLogWhereInput = and.length ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.auditLog.count({ where }),
    ]);

    return res.status(200).json({ success: true, data: rows, pagination: buildPaginationMeta(total, page, limit) });
  }),
);

export default router;
