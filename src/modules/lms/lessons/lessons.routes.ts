import { Router } from 'express';
import { lessonsService } from './lessons.service';
import { createLessonSchema, updateLessonSchema, reorderLessonsSchema, progressSchema, idParam } from './lessons.validation';
import { validate } from '../../../middleware/validate';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok, created } from '../../../utils/apiResponse';
import { lmsViewer } from '../lms.context';

const router = Router();
const canView = requirePermission('lms.course.view');
const canManage = requirePermission('lms.course.manage');

// Authoring — literal path first so it isn't shadowed by GET/PUT '/:id'.
router.put('/reorder', canManage, validate({ body: reorderLessonsSchema }), asyncHandler(async (req, res) => ok(res, await lessonsService.reorder(req.body.lessonIds), 'Reordered')));
router.post('/', canManage, validate({ body: createLessonSchema }), asyncHandler(async (req, res) => created(res, await lessonsService.create(req.body), 'Lesson created')));
router.patch('/:id', canManage, validate({ params: idParam, body: updateLessonSchema }), asyncHandler(async (req, res) => ok(res, await lessonsService.update(req.params.id, req.body), 'Lesson updated')));
router.delete('/:id', canManage, validate({ params: idParam }), asyncHandler(async (req, res) => {
  await lessonsService.remove(req.params.id);
  return ok(res, null, 'Lesson deleted');
}));

// Player — view a lesson + record progress.
router.get('/:id', canView, validate({ params: idParam }), asyncHandler(async (req, res) => ok(res, await lessonsService.get(req.params.id, lmsViewer(req)))));
router.put('/:id/progress', canView, validate({ params: idParam, body: progressSchema }), asyncHandler(async (req, res) => ok(res, await lessonsService.updateProgress(req.params.id, lmsViewer(req), req.body), 'Progress saved')));

export default router;
