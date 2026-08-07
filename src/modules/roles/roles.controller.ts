import type { Request, Response } from 'express';
import { rolesService } from './roles.service';
import { ok, created } from '../../utils/apiResponse';

function actor(req: Request) {
  return { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin, permissions: [...req.user!.permissions] };
}

export const rolesController = {
  async list(_req: Request, res: Response) {
    return ok(res, await rolesService.list());
  },
  async get(req: Request, res: Response) {
    return ok(res, await rolesService.get(req.params.id));
  },
  async create(req: Request, res: Response) {
    const role = await rolesService.create(req.body, actor(req));
    req.audit?.({ action: 'ROLE_CREATE', module: 'roles', entityType: 'Role', entityId: role.id, description: `Created role ${role.key}` });
    return created(res, role, 'Role created');
  },
  async update(req: Request, res: Response) {
    const role = await rolesService.update(req.params.id, req.body);
    req.audit?.({ action: 'ROLE_UPDATE', module: 'roles', entityType: 'Role', entityId: req.params.id, description: `Updated role ${role.key}` });
    return ok(res, role, 'Role updated');
  },
  async remove(req: Request, res: Response) {
    await rolesService.remove(req.params.id);
    req.audit?.({ action: 'ROLE_DELETE', module: 'roles', entityType: 'Role', entityId: req.params.id, description: `Deleted role ${req.params.id}` });
    return ok(res, null, 'Role deleted');
  },
  async setPermissions(req: Request, res: Response) {
    const role = await rolesService.setPermissions(req.params.id, req.body.permissionIds, actor(req));
    req.audit?.({
      action: 'ROLE_SET_PERMISSIONS',
      module: 'roles',
      entityType: 'Role',
      entityId: req.params.id,
      description: `Set permissions for role ${role.key}`,
    });
    return ok(res, role, 'Role permissions updated');
  },
};
