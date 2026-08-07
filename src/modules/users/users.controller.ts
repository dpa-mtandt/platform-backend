import type { Request, Response } from 'express';
import { usersService } from './users.service';
import { ok, created } from '../../utils/apiResponse';
import { ApiError } from '../../utils/apiError';
import { buildImportTemplate, importUsersFromXlsx } from './users.import';

function actor(req: Request) {
  return { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin, permissions: [...req.user!.permissions] };
}

export const usersController = {
  async list(req: Request, res: Response) {
    const result = await usersService.list(req.query as never);
    return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
  },

  async get(req: Request, res: Response) {
    const user = await usersService.get(req.params.id);
    return ok(res, user);
  },

  async create(req: Request, res: Response) {
    const user = await usersService.create(req.body, actor(req));
    req.audit?.({
      action: 'USER_CREATE',
      module: 'users',
      entityType: 'User',
      entityId: user.id,
      description: `Created user ${user.email}`,
      newValue: { email: user.email, roles: user.access?.roles },
    });
    return created(res, user, 'User created');
  },

  async importTemplate(_req: Request, res: Response) {
    const buf = await buildImportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="mtandt-users-import-template.xlsx"');
    return res.end(buf);
  },

  async importUsers(req: Request, res: Response) {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw ApiError.badRequest('No file uploaded. Attach the filled .xlsx template.');
    const summary = await importUsersFromXlsx(body, actor(req));
    req.audit?.({
      action: 'USER_IMPORT',
      module: 'users',
      description: `Bulk user import: ${summary.created} created, ${summary.failed} failed of ${summary.total}`,
    });
    return ok(res, summary, `Imported ${summary.created} of ${summary.total} user(s)`);
  },

  async update(req: Request, res: Response) {
    const user = await usersService.update(req.params.id, req.body, actor(req));
    req.audit?.({
      action: 'USER_UPDATE',
      module: 'users',
      entityType: 'User',
      entityId: req.params.id,
      description: `Updated user ${user.email}`,
    });
    return ok(res, user, 'User updated');
  },

  async remove(req: Request, res: Response) {
    await usersService.remove(req.params.id, actor(req));
    req.audit?.({
      action: 'USER_DELETE',
      module: 'users',
      entityType: 'User',
      entityId: req.params.id,
      description: `Deleted user ${req.params.id}`,
    });
    return ok(res, null, 'User deleted');
  },

  async resetPassword(req: Request, res: Response) {
    await usersService.resetPassword(req.params.id, req.body.newPassword, actor(req));
    req.audit?.({
      action: 'USER_RESET_PASSWORD',
      module: 'users',
      entityType: 'User',
      entityId: req.params.id,
      description: `Reset password for user ${req.params.id}`,
    });
    return ok(res, null, 'Password reset');
  },

  async setRoles(req: Request, res: Response) {
    const user = await usersService.setRoles(req.params.id, req.body.roleIds, actor(req));
    req.audit?.({
      action: 'USER_SET_ROLES',
      module: 'users',
      entityType: 'User',
      entityId: req.params.id,
      description: `Set roles for ${user.email}`,
      newValue: { roles: user.access?.roles },
    });
    return ok(res, user, 'Roles updated');
  },

  async setPermissions(req: Request, res: Response) {
    const user = await usersService.setPermissions(req.params.id, req.body.permissions, actor(req));
    req.audit?.({
      action: 'USER_SET_PERMISSIONS',
      module: 'users',
      entityType: 'User',
      entityId: req.params.id,
      description: `Set direct permissions for ${user.email}`,
    });
    return ok(res, user, 'Permissions updated');
  },
};
