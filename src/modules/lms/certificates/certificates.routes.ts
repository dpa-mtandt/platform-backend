import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../config/prisma';
import { ApiError } from '../../../utils/apiError';
import { validate } from '../../../middleware/validate';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok } from '../../../utils/apiResponse';

const router = Router();
const canView = requirePermission('lms.course.view');
const certParam = z.object({ certificateNo: z.string().min(3).max(120) });

/** The current user's certificates. */
router.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const rows = await prisma.certificate.findMany({
      where: { userId: req.user!.id },
      orderBy: { issuedAt: 'desc' },
      select: { id: true, certificateNo: true, completionDate: true, issuedAt: true, course: { select: { id: true, title: true, slug: true, category: { select: { name: true } } } } },
    });
    return ok(res, rows);
  }),
);

/** A single certificate (owner, or an LMS manager). */
router.get(
  '/:certificateNo',
  canView,
  validate({ params: certParam }),
  asyncHandler(async (req, res) => {
    const cert = await prisma.certificate.findUnique({
      where: { certificateNo: req.params.certificateNo },
      select: {
        certificateNo: true,
        completionDate: true,
        issuedAt: true,
        user: { select: { id: true, name: true, email: true } },
        course: { select: { title: true, slug: true, category: { select: { name: true } } } },
      },
    });
    if (!cert) throw ApiError.notFound('Certificate not found');
    const canManage = req.user!.isSuperAdmin || req.user!.permissions.has('lms.course.manage') || req.user!.permissions.has('lms.report.view');
    if (cert.user.id !== req.user!.id && !canManage) throw ApiError.notFound('Certificate not found');
    return ok(res, {
      certificateNo: cert.certificateNo,
      holderName: cert.user.name,
      courseTitle: cert.course.title,
      courseCategory: cert.course.category?.name ?? null,
      completionDate: cert.completionDate,
      issuedAt: cert.issuedAt,
    });
  }),
);

export default router;
