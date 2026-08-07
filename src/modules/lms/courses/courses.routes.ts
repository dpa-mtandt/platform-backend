import { Router } from 'express';
import { coursesController } from './courses.controller';
import { createCourseSchema, updateCourseSchema, listCoursesQuery, idParam, slugParam, assignCourseSchema, assignmentParam, updateAssignmentSchema } from './courses.validation';
import { validate } from '../../../middleware/validate';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';

const router = Router();

const canView = requirePermission('lms.course.view');
const canManage = requirePermission('lms.course.manage');

// Browse the catalog (learners see only published courses).
router.get('/', canView, validate({ query: listCoursesQuery }), asyncHandler(coursesController.list));

// Authoring (declared before GET /:slug so they aren't shadowed by the slug route).
router.post('/', canManage, validate({ body: createCourseSchema }), asyncHandler(coursesController.create));
router.patch('/:id', canManage, validate({ params: idParam, body: updateCourseSchema }), asyncHandler(coursesController.update));
router.delete('/:id', canManage, validate({ params: idParam }), asyncHandler(coursesController.remove));
router.post('/:id/assign', canManage, validate({ params: idParam, body: assignCourseSchema }), asyncHandler(coursesController.assign));
router.get('/:id/assignments', canManage, validate({ params: idParam }), asyncHandler(coursesController.listAssignments));
router.patch('/:id/assignments/:userId', canManage, validate({ params: assignmentParam, body: updateAssignmentSchema }), asyncHandler(coursesController.updateAssignment));
router.delete('/:id/assignments/:userId', canManage, validate({ params: assignmentParam }), asyncHandler(coursesController.unassign));

// Course player bootstrap + detail (by slug).
router.get('/:slug/learn', canView, validate({ params: slugParam }), asyncHandler(coursesController.learn));
router.get('/:slug', canView, validate({ params: slugParam }), asyncHandler(coursesController.get));

export default router;
