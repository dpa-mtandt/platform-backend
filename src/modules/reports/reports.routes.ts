import { Router } from 'express';
import { z } from 'zod';
import { reportsService, getScope } from './reports.service';
import { toXlsx, toPdf } from './reports.export';
import { authenticate } from '../../middleware/authenticate';
import { requireModule, requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { ApiError } from '../../utils/apiError';

const router = Router();
router.use(authenticate, requireModule('REPORTS'));

const canView = requirePermission('reports.view');
const canExport = requirePermission('reports.export');
const typeParam = z.object({ type: z.string().min(1).max(60) });

/** Available report types (grouped in the UI) — only ones the user may access. */
router.get('/types', canView, asyncHandler(async (req, res) => ok(res, reportsService.listTypes(req.user!))));

/** Export a report as xlsx (default) or pdf. Declared before GET '/:type'. */
router.get(
  '/:type/export',
  canExport,
  validate({ params: typeParam }),
  asyncHandler(async (req, res) => {
    if (!reportsService.canAccessType(req.params.type, req.user!)) throw ApiError.forbidden('You do not have access to this report');
    const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
    const scope = await getScope(req.user!);
    const report = await reportsService.getReport(req.params.type, scope);
    req.audit?.({ action: 'REPORT_EXPORT', module: 'reports', description: `Exported "${report.title}" (${format})` });
    const filename = `${report.type}-${report.generatedAt.slice(0, 10)}.${format}`;
    if (format === 'pdf') {
      const buf = await toPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.end(buf);
    }
    const buf = await toXlsx(report);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.end(buf);
  }),
);

/** A report's data (on-screen). */
router.get(
  '/:type',
  canView,
  validate({ params: typeParam }),
  asyncHandler(async (req, res) => {
    if (!reportsService.canAccessType(req.params.type, req.user!)) throw ApiError.forbidden('You do not have access to this report');
    const scope = await getScope(req.user!);
    return ok(res, await reportsService.getReport(req.params.type, scope));
  }),
);

export default router;
