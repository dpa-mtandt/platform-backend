import express, { Router } from 'express';
import { usersController } from './users.controller';
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuery,
  idParam,
  resetPasswordSchema,
  setRolesSchema,
  setPermissionsSchema,
} from './users.validation';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission, requireSuperAdmin } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// Every user-management route requires authentication.
router.use(authenticate);

const canView = requirePermission('platform.users.view');
const canManage = requirePermission('platform.users.manage');

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users (paginated, filterable by search/status/role/module/department)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Paginated users } }
 */
router.get('/', canView, validate({ query: listUsersQuery }), asyncHandler(usersController.list));

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user with roles, direct permissions and effective access
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: User }, 404: { description: Not found } }
 */
router.get('/:id', canView, validate({ params: idParam }), asyncHandler(usersController.get));

/**
 * @openapi
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Create a user (optionally assigning roles)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created }, 409: { description: Email exists } }
 */
router.post('/', canManage, validate({ body: createUserSchema }), asyncHandler(usersController.create));

// ── Bulk import (declared before '/:id' so they aren't shadowed) ──────────────
router.get('/import/template', canManage, asyncHandler(usersController.importTemplate));
router.post('/import', canManage, express.raw({ type: () => true, limit: '15mb' }), asyncHandler(usersController.importUsers));

/**
 * @openapi
 * /users/{id}:
 *   patch:
 *     tags: [Users]
 *     summary: Update a user (and optionally replace their roles)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Updated } }
 */
router.patch('/:id', canManage, validate({ params: idParam, body: updateUserSchema }), asyncHandler(usersController.update));

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete a user
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Deleted } }
 */
router.delete('/:id', canManage, validate({ params: idParam }), asyncHandler(usersController.remove));

/**
 * @openapi
 * /users/{id}/reset-password:
 *   post:
 *     tags: [Users]
 *     summary: Admin-set a new password for a user (revokes their sessions)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Password reset } }
 */
router.post(
  '/:id/reset-password',
  canManage,
  validate({ params: idParam, body: resetPasswordSchema }),
  asyncHandler(usersController.resetPassword),
);

/**
 * @openapi
 * /users/{id}/roles:
 *   put:
 *     tags: [Users]
 *     summary: Replace the set of roles assigned to a user
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Roles updated } }
 */
router.put('/:id/roles', canManage, validate({ params: idParam, body: setRolesSchema }), asyncHandler(usersController.setRoles));

/**
 * @openapi
 * /users/{id}/permissions:
 *   put:
 *     tags: [Users]
 *     summary: Replace a user's direct permission grants (super admin only)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Permissions updated } }
 */
router.put(
  '/:id/permissions',
  requireSuperAdmin(),
  validate({ params: idParam, body: setPermissionsSchema }),
  asyncHandler(usersController.setPermissions),
);

export default router;
