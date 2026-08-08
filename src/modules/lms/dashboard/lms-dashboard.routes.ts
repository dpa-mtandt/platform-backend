import { Router } from 'express';
import { prisma } from '../../../config/prisma';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok } from '../../../utils/apiResponse';

const router = Router();

/**
 * LMS dashboard: everyone gets their personal training stats; users who can view
 * LMS reports (lms.report.view) additionally get org-wide analytics.
 */
router.get(
  '/',
  requirePermission('lms.course.view'),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const [enrollments, certificates] = await Promise.all([
      prisma.enrollment.findMany({ where: { userId }, select: { status: true } }),
      prisma.certificate.count({ where: { userId } }),
    ]);
    const myStats = {
      enrolled: enrollments.length,
      inProgress: enrollments.filter((e) => e.status === 'IN_PROGRESS').length,
      completed: enrollments.filter((e) => e.status === 'COMPLETED').length,
      assigned: enrollments.filter((e) => e.status === 'ASSIGNED').length,
      certificates,
    };

    const canReport = req.user!.isSuperAdmin || req.user!.permissions.has('lms.report.view');
    let analytics: unknown = null;
    if (canReport) {
      const [totalCourses, publishedCourses, totalEnrollments, completedEnrollments, certificatesIssued] = await Promise.all([
        prisma.course.count(),
        prisma.course.count({ where: { status: 'PUBLISHED' } }),
        prisma.enrollment.count(),
        prisma.enrollment.count({ where: { status: 'COMPLETED' } }),
        prisma.certificate.count(),
      ]);
      analytics = {
        totalCourses,
        publishedCourses,
        totalEnrollments,
        completedEnrollments,
        completionRate: totalEnrollments ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0,
        certificatesIssued,
      };
    }
    return ok(res, { myStats, analytics });
  }),
);

export default router;
