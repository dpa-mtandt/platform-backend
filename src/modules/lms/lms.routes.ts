import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireModule } from '../../middleware/authorize';
import categoriesRoutes from './categories/categories.routes';
import coursesRoutes from './courses/courses.routes';
import sectionsRoutes from './sections/sections.routes';
import lessonsRoutes from './lessons/lessons.routes';
import enrollmentsRoutes from './enrollments/enrollments.routes';
import quizzesRoutes from './quizzes/quizzes.routes';
import questionsRoutes from './quizzes/questions.routes';
import certificatesRoutes from './certificates/certificates.routes';
import lmsDashboardRoutes from './dashboard/lms-dashboard.routes';

const router = Router();

// The whole LMS surface requires authentication AND access to the LMS module.
// (Fine-grained lms.* permission checks happen per-route inside each sub-router.)
router.use(authenticate, requireModule('LMS'));

router.get('/', (_req, res) =>
  res.json({
    success: true,
    message: 'MTANDT Platform — LMS module',
    endpoints: ['categories', 'courses', 'sections', 'lessons', 'enrollments', 'quizzes', 'questions', 'certificates', 'dashboard'],
  }),
);

router.use('/categories', categoriesRoutes);
router.use('/courses', coursesRoutes);
router.use('/sections', sectionsRoutes);
router.use('/lessons', lessonsRoutes);
router.use('/enrollments', enrollmentsRoutes);
router.use('/quizzes', quizzesRoutes);
router.use('/questions', questionsRoutes);
router.use('/certificates', certificatesRoutes);
router.use('/dashboard', lmsDashboardRoutes);

export default router;
