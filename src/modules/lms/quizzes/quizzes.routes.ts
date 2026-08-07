import { Router } from 'express';
import { quizzesService } from './quizzes.service';
import {
  listQuizzesQuery,
  submitAttemptSchema,
  createQuizSchema,
  updateQuizSchema,
  createQuestionSchema,
  reorderQuestionsSchema,
  idParam,
  attemptParam,
} from './quizzes.validation';
import { validate } from '../../../middleware/validate';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok, created } from '../../../utils/apiResponse';
import { lmsViewer } from '../lms.context';

const router = Router();
const canView = requirePermission('lms.course.view');
const canManage = requirePermission('lms.quiz.manage');

// ── Authoring (specific paths declared before the generic GET '/:id') ────────
router.get('/manage', canManage, asyncHandler(async (_req, res) => ok(res, await quizzesService.listManage())));
router.post('/', canManage, validate({ body: createQuizSchema }), asyncHandler(async (req, res) => {
  const quiz = await quizzesService.createQuiz(req.body, req.user!.id);
  req.audit?.({ action: 'LMS_QUIZ_CREATE', module: 'lms', entityType: 'Quiz', entityId: quiz.id, description: `Created quiz ${quiz.title}` });
  return created(res, quiz, 'Quiz created');
}));
router.get('/:id/full', canManage, validate({ params: idParam }), asyncHandler(async (req, res) => ok(res, await quizzesService.getFull(req.params.id))));
router.patch('/:id', canManage, validate({ params: idParam, body: updateQuizSchema }), asyncHandler(async (req, res) => ok(res, await quizzesService.updateQuiz(req.params.id, req.body), 'Quiz updated')));
router.delete('/:id', canManage, validate({ params: idParam }), asyncHandler(async (req, res) => {
  await quizzesService.deleteQuiz(req.params.id);
  return ok(res, null, 'Quiz deleted');
}));
router.post('/:id/questions', canManage, validate({ params: idParam, body: createQuestionSchema }), asyncHandler(async (req, res) => created(res, await quizzesService.addQuestion(req.params.id, req.body), 'Question added')));
router.put('/:id/questions/reorder', canManage, validate({ params: idParam, body: reorderQuestionsSchema }), asyncHandler(async (req, res) => ok(res, await quizzesService.reorderQuestions(req.params.id, req.body.questionIds), 'Reordered')));

// ── Learner attempt lifecycle ────────────────────────────────────────────────
router.post('/:id/attempts', canView, validate({ params: idParam }), asyncHandler(async (req, res) => created(res, await quizzesService.startAttempt(req.params.id, lmsViewer(req)), 'Attempt started')));
router.post('/attempts/:attemptId/submit', canView, validate({ params: attemptParam, body: submitAttemptSchema }), asyncHandler(async (req, res) => ok(res, await quizzesService.submit(req.params.attemptId, lmsViewer(req), req.body), 'Submitted')));
router.get('/attempts/:attemptId', canView, validate({ params: attemptParam }), asyncHandler(async (req, res) => ok(res, await quizzesService.getResult(req.params.attemptId, lmsViewer(req)))));

// ── Learner quiz info (generic GET last) ─────────────────────────────────────
router.get('/', canView, validate({ query: listQuizzesQuery }), asyncHandler(async (req, res) => {
  const result = await quizzesService.list(req.user!.id, req.query as never);
  return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}));
router.get('/:id', canView, validate({ params: idParam }), asyncHandler(async (req, res) => ok(res, await quizzesService.getInfo(req.params.id, lmsViewer(req)))));

export default router;
