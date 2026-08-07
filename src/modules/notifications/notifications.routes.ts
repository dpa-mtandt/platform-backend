import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { ApiError } from '../../utils/apiError';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination';

const router = Router();
router.use(authenticate);

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  filter: z.enum(['all', 'unread']).optional(),
});
const idParam = z.object({ id: z.string().uuid() });

/** List the current user's notifications (+ unread count). */
router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof listQuery>;
    const { page, limit, skip } = parsePagination(q, 20, 100);
    const where: Prisma.NotificationWhereInput = { userId: req.user!.id, ...(q.filter === 'unread' ? { isRead: false } : {}) };
    const [rows, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
    ]);
    return res.status(200).json({ success: true, data: rows, unreadCount, pagination: buildPaginationMeta(total, page, limit) });
  }),
);

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const unreadCount = await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } });
    return ok(res, { unreadCount });
  }),
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true, readAt: new Date() } });
    return ok(res, null, 'All notifications marked read');
  }),
);

router.patch(
  '/:id/read',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { isRead: true, readAt: new Date() },
    });
    if (result.count === 0) throw ApiError.notFound('Notification not found');
    return ok(res, null, 'Marked read');
  }),
);

router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    if (result.count === 0) throw ApiError.notFound('Notification not found');
    return ok(res, null, 'Deleted');
  }),
);

export default router;
