import { Router } from 'express';
import { prisma } from '../../../config/prisma';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok } from '../../../utils/apiResponse';

const router = Router();
const canView = requirePermission('lms.course.view');

/**
 * The current user's enrollments + summary stats ("My Learning").
 *
 * There is intentionally no self-enroll endpoint: course access is assignment-gated,
 * so learners only ever have enrollments that a manager assigned to them.
 */
router.get(
  '/mine',
  canView,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const rows = await prisma.enrollment.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { lastAccessedAt: 'desc' }],
      include: {
        course: {
          select: { id: true, title: true, slug: true, summary: true, thumbnailUrl: true, difficulty: true, estimatedMinutes: true, category: { select: { name: true } } },
        },
      },
    });
    const stats = {
      enrolled: rows.length,
      inProgress: rows.filter((e) => e.status === 'IN_PROGRESS').length,
      completed: rows.filter((e) => e.status === 'COMPLETED').length,
      assigned: rows.filter((e) => e.status === 'ASSIGNED').length,
    };
    return ok(res, { stats, enrollments: rows });
  }),
);

export default router;
