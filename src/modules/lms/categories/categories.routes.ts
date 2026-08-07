import { Router } from 'express';
import { z } from 'zod';
import { categoriesService } from './categories.service';
import { validate } from '../../../middleware/validate';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok, created } from '../../../utils/apiResponse';

const router = Router();

const canView = requirePermission('lms.course.view');
const canManage = requirePermission('lms.course.manage');

const idParam = z.object({ id: z.string().uuid() });
const createSchema = z.object({ name: z.string().min(2).max(80), description: z.string().max(300).nullable().optional() });
const updateSchema = createSchema.partial();

router.get('/', canView, asyncHandler(async (_req, res) => ok(res, await categoriesService.list())));

router.post(
  '/',
  canManage,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const c = await categoriesService.create(req.body);
    req.audit?.({ action: 'LMS_CATEGORY_CREATE', module: 'lms', entityType: 'Category', entityId: c.id, description: `Created category ${c.name}` });
    return created(res, c, 'Category created');
  }),
);

router.patch(
  '/:id',
  canManage,
  validate({ params: idParam, body: updateSchema }),
  asyncHandler(async (req, res) => ok(res, await categoriesService.update(req.params.id, req.body), 'Category updated')),
);

router.delete(
  '/:id',
  canManage,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await categoriesService.remove(req.params.id);
    return ok(res, null, 'Category deleted');
  }),
);

export default router;
