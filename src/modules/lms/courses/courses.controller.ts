import type { Request, Response } from 'express';
import { coursesService, type Viewer } from './courses.service';
import { ok, created } from '../../../utils/apiResponse';

function viewer(req: Request): Viewer {
  const u = req.user!;
  return { id: u.id, isSuperAdmin: u.isSuperAdmin, canManage: u.isSuperAdmin || u.permissions.has('lms.course.manage') };
}

export const coursesController = {
  async list(req: Request, res: Response) {
    const result = await coursesService.list(req.query as never, viewer(req));
    return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
  },

  async get(req: Request, res: Response) {
    return ok(res, await coursesService.getBySlug(req.params.slug, viewer(req)));
  },

  async learn(req: Request, res: Response) {
    return ok(res, await coursesService.getLearn(req.params.slug, viewer(req)));
  },

  async create(req: Request, res: Response) {
    const course = await coursesService.create(req.body, viewer(req));
    req.audit?.({ action: 'LMS_COURSE_CREATE', module: 'lms', entityType: 'Course', entityId: course.id, description: `Created course ${course.title}` });
    return created(res, course, 'Course created');
  },

  async update(req: Request, res: Response) {
    const course = await coursesService.update(req.params.id, req.body, viewer(req));
    req.audit?.({ action: 'LMS_COURSE_UPDATE', module: 'lms', entityType: 'Course', entityId: req.params.id, description: `Updated course ${course.title}` });
    return ok(res, course, 'Course updated');
  },

  async remove(req: Request, res: Response) {
    await coursesService.remove(req.params.id);
    req.audit?.({ action: 'LMS_COURSE_DELETE', module: 'lms', entityType: 'Course', entityId: req.params.id, description: `Deleted course ${req.params.id}` });
    return ok(res, null, 'Course deleted');
  },

  async assign(req: Request, res: Response) {
    const result = await coursesService.assign(req.params.id, req.body, req.user!.id);
    req.audit?.({ action: 'LMS_COURSE_ASSIGN', module: 'lms', entityType: 'Course', entityId: req.params.id, description: `Assigned course to ${result.assigned} user(s)` });
    return ok(res, result, `Assigned to ${result.assigned} user(s)`);
  },

  async listAssignments(req: Request, res: Response) {
    return ok(res, await coursesService.listAssignments(req.params.id));
  },

  async updateAssignment(req: Request, res: Response) {
    await coursesService.updateAssignment(req.params.id, req.params.userId, req.body);
    req.audit?.({ action: 'LMS_COURSE_ASSIGN_UPDATE', module: 'lms', entityType: 'Course', entityId: req.params.id, description: `Updated assignment for user ${req.params.userId}` });
    return ok(res, null, 'Assignment updated');
  },

  async unassign(req: Request, res: Response) {
    await coursesService.unassign(req.params.id, req.params.userId);
    req.audit?.({ action: 'LMS_COURSE_UNASSIGN', module: 'lms', entityType: 'Course', entityId: req.params.id, description: `Unassigned user ${req.params.userId} from course ${req.params.id}` });
    return ok(res, null, 'Unassigned');
  },
};
