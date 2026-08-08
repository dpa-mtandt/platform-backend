import { Router } from 'express';
import { dashboardController } from './dashboard.controller';
import { createDashboardSchema, updateDashboardSchema, setAccessSchema, idParam } from './dashboard.validation';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { requireModule, requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// The whole Dashboard surface requires auth AND access to the DASHBOARD module.
router.use(authenticate, requireModule('DASHBOARD'));

const canView = requirePermission('dashboard.view');
const canManage = requirePermission('dashboard.manage');

// Viewer
router.get('/', canView, asyncHandler(dashboardController.list));

// Admin — literal paths declared before the generic '/:id/*' routes.
router.get('/manage', canManage, asyncHandler(dashboardController.listAll));
router.get('/users', canManage, asyncHandler(dashboardController.users));
router.post('/', canManage, validate({ body: createDashboardSchema }), asyncHandler(dashboardController.create));

// Viewer embed (authorization inside: unassigned → 403 even by direct URL)
router.get('/:id/embed', canView, validate({ params: idParam }), asyncHandler(dashboardController.embed));

// Admin per-dashboard access + edits
router.get('/:id/access', canManage, validate({ params: idParam }), asyncHandler(dashboardController.getAccess));
router.put('/:id/access', canManage, validate({ params: idParam, body: setAccessSchema }), asyncHandler(dashboardController.setAccess));
router.patch('/:id', canManage, validate({ params: idParam, body: updateDashboardSchema }), asyncHandler(dashboardController.update));
router.delete('/:id', canManage, validate({ params: idParam }), asyncHandler(dashboardController.remove));

export default router;
