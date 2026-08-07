import { Router } from 'express';
import { permissionsService } from './permissions.service';
import { authenticate } from '../../middleware/authenticate';
import { requireAnyPermission } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';

const router = Router();
router.use(authenticate);

// Visible to anyone who manages access (roles or per-user permissions).
const canView = requireAnyPermission('platform.roles.view', 'platform.roles.manage', 'platform.users.manage');

/**
 * @openapi
 * /permissions:
 *   get: { tags: [Permissions], summary: List all permissions, security: [{ bearerAuth: [] }], responses: { 200: { description: Permissions } } }
 */
router.get('/', canView, asyncHandler(async (_req, res) => ok(res, await permissionsService.list())));

/**
 * @openapi
 * /permissions/grouped:
 *   get: { tags: [Permissions], summary: Permissions grouped by module, security: [{ bearerAuth: [] }], responses: { 200: { description: Grouped permissions } } }
 */
router.get('/grouped', canView, asyncHandler(async (_req, res) => ok(res, await permissionsService.listGrouped())));

export default router;
