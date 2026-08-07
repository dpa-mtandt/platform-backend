import { Router } from 'express';
import { quizzesService } from './quizzes.service';
import { updateQuestionSchema, questionParam } from './quizzes.validation';
import { validate } from '../../../middleware/validate';
import { requirePermission } from '../../../middleware/authorize';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok } from '../../../utils/apiResponse';

const router = Router();
const canManage = requirePermission('lms.quiz.manage');

router.patch(
  '/:questionId',
  canManage,
  validate({ params: questionParam, body: updateQuestionSchema }),
  asyncHandler(async (req, res) => ok(res, await quizzesService.updateQuestion(req.params.questionId, req.body), 'Question updated')),
);

router.delete(
  '/:questionId',
  canManage,
  validate({ params: questionParam }),
  asyncHandler(async (req, res) => {
    await quizzesService.deleteQuestion(req.params.questionId);
    return ok(res, null, 'Question deleted');
  }),
);

export default router;
