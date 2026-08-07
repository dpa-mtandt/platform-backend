import { Router } from 'express';
import { feedbackController } from './feedback.controller';
import {
  submitFeedbackSchema,
  updateFeedbackSchema,
  listManageQuery,
  createCompetencySchema,
  updateCompetencySchema,
  idParam,
  userIdParam,
} from './feedback.validation';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { requireModule, requirePermission, requireAnyPermission } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// Whole surface requires auth + FEEDBACK module access.
router.use(authenticate, requireModule('FEEDBACK'));

const canSubmit = requirePermission('feedback.submit');
const canView = requirePermission('feedback.view');
const canManage = requirePermission('feedback.manage');
const anyFeedback = requireAnyPermission('feedback.submit', 'feedback.view', 'feedback.manage');

// ── Competencies ─────────────────────────────────────────────────────────────
router.get('/competencies', anyFeedback, asyncHandler(feedbackController.listCompetencies));
router.post('/competencies', canManage, validate({ body: createCompetencySchema }), asyncHandler(feedbackController.createCompetency));
router.patch('/competencies/:id', canManage, validate({ params: idParam, body: updateCompetencySchema }), asyncHandler(feedbackController.updateCompetency));
router.delete('/competencies/:id', canManage, validate({ params: idParam }), asyncHandler(feedbackController.removeCompetency));

// ── Submit + own history ─────────────────────────────────────────────────────
router.get('/recipients', canSubmit, asyncHandler(feedbackController.recipients));
router.get('/mine', canSubmit, asyncHandler(feedbackController.mine));
router.post('/', canSubmit, validate({ body: submitFeedbackSchema }), asyncHandler(feedbackController.submit));

// ── Reports (analytics) ──────────────────────────────────────────────────────
router.get('/reports', canView, asyncHandler(feedbackController.reports));
router.get('/reports/:userId', canView, validate({ params: userIdParam }), asyncHandler(feedbackController.recipientReport));

// ── Management (moderation) ──────────────────────────────────────────────────
router.get('/manage', canManage, validate({ query: listManageQuery }), asyncHandler(feedbackController.manageList));
router.get('/manage/:id', canManage, validate({ params: idParam }), asyncHandler(feedbackController.manageGet));
router.patch('/manage/:id', canManage, validate({ params: idParam, body: updateFeedbackSchema }), asyncHandler(feedbackController.manageUpdate));
router.delete('/manage/:id', canManage, validate({ params: idParam }), asyncHandler(feedbackController.manageDelete));

export default router;
