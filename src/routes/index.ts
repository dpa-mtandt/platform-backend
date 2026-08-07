import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import usersRoutes from '../modules/users/users.routes';
import rolesRoutes from '../modules/roles/roles.routes';
import permissionsRoutes from '../modules/permissions/permissions.routes';
import modulesRoutes from '../modules/modules/modules.routes';
import orgRoutes from '../modules/org/org.routes';
import metaRoutes from '../modules/meta/meta.routes';
import auditRoutes from '../modules/audit/audit.routes';
import notificationsRoutes from '../modules/notifications/notifications.routes';
import settingsRoutes from '../modules/settings/settings.routes';
import lmsRoutes from '../modules/lms/lms.routes';
import mediaRoutes from '../modules/lms/media/media.routes';
import dashboardModuleRoutes from '../modules/dashboard/dashboard.routes';
import feedbackRoutes from '../modules/feedback/feedback.routes';
import reportsRoutes from '../modules/reports/reports.routes';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'MTANDT Enterprise Platform API v1',
    modules: ['auth', 'users', 'roles', 'permissions', 'modules', 'org', 'meta', 'audit', 'notifications', 'settings', 'lms', 'dashboard', 'feedback', 'reports'],
    docs: '/api/docs',
  });
});

// ── Core (Phase 0) ───────────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/permissions', permissionsRoutes);
router.use('/modules', modulesRoutes);
router.use('/org', orgRoutes);
router.use('/meta', metaRoutes);
router.use('/audit', auditRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/settings', settingsRoutes);

// ── Business modules ─────────────────────────────────────────────────────────
router.use('/lms', lmsRoutes); // Phase 1 — LMS
// Protected media lives OUTSIDE the LMS Bearer gate: <video>/<iframe> stream via a
// short-lived URL token, while its authenticated routes guard themselves per-route.
router.use('/media', mediaRoutes);
router.use('/dashboard', dashboardModuleRoutes); // Phase 2 — Dashboards
router.use('/feedback', feedbackRoutes); // Phase 3 — Feedback
router.use('/reports', reportsRoutes); // Phase 4 — Reports

export default router;
