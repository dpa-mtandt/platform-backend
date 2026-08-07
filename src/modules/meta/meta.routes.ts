import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { requireAnyPermission } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';

/**
 * Lightweight reference data for populating admin dropdowns (roles, modules,
 * departments, companies, potential managers). Read-only.
 */
const router = Router();
router.use(authenticate);

const canRead = requireAnyPermission(
  'platform.users.view',
  'platform.users.manage',
  'platform.roles.view',
  'platform.org.manage',
);

router.get(
  '/roles',
  canRead,
  asyncHandler(async (_req, res) =>
    ok(res, await prisma.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, key: true, name: true, isSuperAdmin: true } })),
  ),
);

router.get(
  '/modules',
  canRead,
  asyncHandler(async (_req, res) =>
    ok(
      res,
      await prisma.module.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { id: true, key: true, name: true, icon: true, color: true, path: true, isActive: true },
      }),
    ),
  ),
);

router.get(
  '/departments',
  canRead,
  asyncHandler(async (_req, res) =>
    ok(res, await prisma.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } })),
  ),
);

router.get(
  '/companies',
  canRead,
  asyncHandler(async (_req, res) =>
    ok(res, await prisma.company.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })),
  ),
);

router.get(
  '/managers',
  canRead,
  asyncHandler(async (_req, res) =>
    ok(
      res,
      await prisma.user.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        take: 500,
        select: { id: true, name: true, email: true },
      }),
    ),
  ),
);

export default router;
