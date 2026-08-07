import type { Request, Response } from 'express';
import { feedbackService } from './feedback.service';
import { ok, created } from '../../utils/apiResponse';

export const feedbackController = {
  // Competencies
  async listCompetencies(req: Request, res: Response) {
    const canManage = req.user!.isSuperAdmin || req.user!.permissions.has('feedback.manage');
    return ok(res, await feedbackService.listCompetencies(!canManage));
  },
  async createCompetency(req: Request, res: Response) {
    const c = await feedbackService.createCompetency(req.body);
    req.audit?.({ action: 'FEEDBACK_COMPETENCY_CREATE', module: 'feedback', entityType: 'Competency', entityId: c.id, description: `Created competency ${c.name}` });
    return created(res, c, 'Competency created');
  },
  async updateCompetency(req: Request, res: Response) {
    return ok(res, await feedbackService.updateCompetency(req.params.id, req.body), 'Competency updated');
  },
  async removeCompetency(req: Request, res: Response) {
    await feedbackService.removeCompetency(req.params.id);
    return ok(res, null, 'Competency deleted');
  },

  // Submit + history
  async recipients(req: Request, res: Response) {
    return ok(res, await feedbackService.listRecipients(req.user!.id));
  },
  async submit(req: Request, res: Response) {
    const fb = await feedbackService.submit(req.user!.id, req.body);
    // Anonymous submissions must NEVER create an actor↔feedback audit link — a
    // holder of platform.audit.view could otherwise join the audit trail (which
    // carries the giver's identity + the feedback id) back to the anonymous
    // record and de-anonymize the giver. Only audit named (non-anonymous) feedback.
    if (!req.body.isAnonymous) {
      req.audit?.({ action: 'FEEDBACK_SUBMIT', module: 'feedback', entityType: 'Feedback', entityId: fb.id, description: `Submitted feedback (${fb.periodMonth})` });
    }
    return created(res, fb, 'Feedback submitted');
  },
  async mine(req: Request, res: Response) {
    return ok(res, await feedbackService.myGiven(req.user!.id));
  },

  // Reports
  async reports(_req: Request, res: Response) {
    return ok(res, await feedbackService.reports());
  },
  async recipientReport(req: Request, res: Response) {
    return ok(res, await feedbackService.recipientReport(req.params.userId));
  },

  // Management
  async manageList(req: Request, res: Response) {
    const result = await feedbackService.manageList(req.query as never);
    return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
  },
  async manageGet(req: Request, res: Response) {
    return ok(res, await feedbackService.manageGet(req.params.id));
  },
  async manageUpdate(req: Request, res: Response) {
    const f = await feedbackService.manageUpdate(req.params.id, req.body);
    req.audit?.({ action: 'FEEDBACK_UPDATE', module: 'feedback', entityType: 'Feedback', entityId: req.params.id, description: 'Edited feedback (moderation)' });
    return ok(res, f, 'Feedback updated');
  },
  async manageDelete(req: Request, res: Response) {
    await feedbackService.manageDelete(req.params.id);
    req.audit?.({ action: 'FEEDBACK_DELETE', module: 'feedback', entityType: 'Feedback', entityId: req.params.id, description: 'Deleted feedback (moderation)' });
    return ok(res, null, 'Feedback deleted');
  },
};
