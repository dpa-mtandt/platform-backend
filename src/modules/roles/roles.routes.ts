import { Router } from 'express';
import { rolesController } from './roles.controller';
import { createRoleSchema, updateRoleSchema, setRolePermissionsSchema, idParam } from './roles.validation';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
router.use(authenticate);

const canView = requirePermission('platform.roles.view');
const canManage = requirePermission('platform.roles.manage');

/**
 * @openapi
 * /roles:
 *   get: { tags: [Roles], summary: List all roles, security: [{ bearerAuth: [] }], responses: { 200: { description: Roles } } }
 */
router.get('/', canView, asyncHandler(rolesController.list));
router.get('/:id', canView, validate({ params: idParam }), asyncHandler(rolesController.get));
router.post('/', canManage, validate({ body: createRoleSchema }), asyncHandler(rolesController.create));
router.patch('/:id', canManage, validate({ params: idParam, body: updateRoleSchema }), asyncHandler(rolesController.update));
router.delete('/:id', canManage, validate({ params: idParam }), asyncHandler(rolesController.remove));
router.put(
  '/:id/permissions',
  canManage,
  validate({ params: idParam, body: setRolePermissionsSchema }),
  asyncHandler(rolesController.setPermissions),
);

export default router;
