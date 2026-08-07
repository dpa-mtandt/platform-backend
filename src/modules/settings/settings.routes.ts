import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { ApiError } from '../../utils/apiError';

const router = Router();
router.use(authenticate);

const canManage = requirePermission('platform.settings.manage');
const keyParam = z.object({ key: z.string().min(1).max(80) });
const upsertBody = z.object({ value: z.any() });

/** All settings as a { key: value } map. */
router.get(
  '/',
  canManage,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.setting.findMany();
    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value;
    return ok(res, map);
  }),
);

router.get(
  '/:key',
  canManage,
  validate({ params: keyParam }),
  asyncHandler(async (req, res) => {
    const row = await prisma.setting.findUnique({ where: { key: req.params.key } });
    if (!row) throw ApiError.notFound('Setting not found');
    return ok(res, row.value);
  }),
);

router.put(
  '/:key',
  canManage,
  validate({ params: keyParam, body: upsertBody }),
  asyncHandler(async (req, res) => {
    const value = req.body.value;
    const row = await prisma.setting.upsert({
      where: { key: req.params.key },
      update: { value },
      create: { key: req.params.key, value },
    });
    req.audit?.({ action: 'SETTING_UPDATE', module: 'settings', entityType: 'Setting', entityId: req.params.key, description: `Updated setting ${req.params.key}` });
    return ok(res, row.value, 'Setting saved');
  }),
);

export default router;
