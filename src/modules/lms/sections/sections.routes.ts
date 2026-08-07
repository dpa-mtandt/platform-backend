import { Router } from 'express';
import { z } from 'zod';
import { sectionsService } from './sections.service';
import { validate } from '../../../middleware/validate';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok, created } from '../../../utils/apiResponse';

const router = Router();
const canManage = requirePermission('lms.course.manage');

const idParam = z.object({ id: z.string().uuid() });
const createSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  orderIndex: z.coerce.number().int().min(0).optional(),
});
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  orderIndex: z.coerce.number().int().min(0).optional(),
});
const reorderSchema = z.object({ sectionIds: z.array(z.string().uuid()).min(1) });

router.post('/', canManage, validate({ body: createSchema }), asyncHandler(async (req, res) => created(res, await sectionsService.create(req.body), 'Section created')));
router.put('/reorder', canManage, validate({ body: reorderSchema }), asyncHandler(async (req, res) => ok(res, await sectionsService.reorder(req.body.sectionIds), 'Reordered')));
router.patch('/:id', canManage, validate({ params: idParam, body: updateSchema }), asyncHandler(async (req, res) => ok(res, await sectionsService.update(req.params.id, req.body), 'Section updated')));
router.delete('/:id', canManage, validate({ params: idParam }), asyncHandler(async (req, res) => {
  await sectionsService.remove(req.params.id);
  return ok(res, null, 'Section deleted');
}));

export default router;
