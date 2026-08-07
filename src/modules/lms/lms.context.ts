import type { Request } from 'express';
import type { Viewer } from './courses/courses.service';

/** Build the LMS viewer context from the authenticated principal. */
export function lmsViewer(req: Request): Viewer {
  const u = req.user!;
  return { id: u.id, isSuperAdmin: u.isSuperAdmin, canManage: u.isSuperAdmin || u.permissions.has('lms.course.manage') };
}
