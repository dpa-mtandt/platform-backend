import type { Request, Response } from 'express';
import { dashboardService, type Viewer } from './dashboard.service';
import { diagnose } from './powerbi.service';
import { ok, created } from '../../utils/apiResponse';

function viewer(req: Request): Viewer {
  const u = req.user!;
  return { id: u.id, isSuperAdmin: u.isSuperAdmin, canManage: u.isSuperAdmin || u.permissions.has('dashboard.manage') };
}

export const dashboardController = {
  async list(req: Request, res: Response) {
    return ok(res, await dashboardService.listAccessible(viewer(req)));
  },

  async embed(req: Request, res: Response) {
    const result = await dashboardService.getEmbed(req.params.id, viewer(req));
    req.audit?.({
      action: 'VIEW_DASHBOARD',
      module: 'dashboard',
      entityType: 'Dashboard',
      entityId: req.params.id,
      description: `Viewed dashboard ${result.dashboard.name}`,
    });
    return ok(res, result);
  },

  async status(_req: Request, res: Response) {
    return ok(res, await diagnose());
  },

  async listAll(_req: Request, res: Response) {
    return ok(res, await dashboardService.listAll());
  },

  async users(_req: Request, res: Response) {
    return ok(res, await dashboardService.listUsers());
  },

  async create(req: Request, res: Response) {
    const d = await dashboardService.create(req.body);
    req.audit?.({ action: 'DASHBOARD_CREATE', module: 'dashboard', entityType: 'Dashboard', entityId: d.id, description: `Created dashboard ${d.name}` });
    return created(res, d, 'Dashboard created');
  },

  async update(req: Request, res: Response) {
    const d = await dashboardService.update(req.params.id, req.body);
    req.audit?.({ action: 'DASHBOARD_UPDATE', module: 'dashboard', entityType: 'Dashboard', entityId: d.id, description: `Updated dashboard ${d.name}` });
    return ok(res, d, 'Dashboard updated');
  },

  async remove(req: Request, res: Response) {
    await dashboardService.remove(req.params.id);
    req.audit?.({ action: 'DASHBOARD_DELETE', module: 'dashboard', entityType: 'Dashboard', entityId: req.params.id, description: `Deleted dashboard ${req.params.id}` });
    return ok(res, null, 'Dashboard deleted');
  },

  async getAccess(req: Request, res: Response) {
    return ok(res, await dashboardService.getAccess(req.params.id));
  },

  async setAccess(req: Request, res: Response) {
    const result = await dashboardService.setAccess(req.params.id, req.body.userIds, req.user!.id);
    req.audit?.({
      action: 'DASHBOARD_ASSIGN',
      module: 'dashboard',
      entityType: 'Dashboard',
      entityId: req.params.id,
      description: `Set dashboard access to ${result.assignedUserIds.length} user(s)`,
    });
    return ok(res, result, 'Access updated');
  },
};
