import { Router } from 'express';
import { orgService } from './org.service';
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  createCompanySchema,
  updateCompanySchema,
  idParam,
} from './org.validation';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created } from '../../utils/apiResponse';

const router = Router();
router.use(authenticate);

const canView = requireAnyPermission('platform.users.view', 'platform.org.manage');
const canManage = requirePermission('platform.org.manage');

// ── Departments ──────────────────────────────────────────────────────────────
router.get('/departments', canView, asyncHandler(async (_req, res) => ok(res, await orgService.listDepartments())));
router.post(
  '/departments',
  canManage,
  validate({ body: createDepartmentSchema }),
  asyncHandler(async (req, res) => {
    const dep = await orgService.createDepartment(req.body);
    req.audit?.({ action: 'DEPARTMENT_CREATE', module: 'org', entityType: 'Department', entityId: dep.id, description: `Created department ${dep.name}` });
    return created(res, dep, 'Department created');
  }),
);
router.patch(
  '/departments/:id',
  canManage,
  validate({ params: idParam, body: updateDepartmentSchema }),
  asyncHandler(async (req, res) => {
    const dep = await orgService.updateDepartment(req.params.id, req.body);
    req.audit?.({ action: 'DEPARTMENT_UPDATE', module: 'org', entityType: 'Department', entityId: dep.id, description: `Updated department ${dep.name}` });
    return ok(res, dep, 'Department updated');
  }),
);
router.delete(
  '/departments/:id',
  canManage,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await orgService.removeDepartment(req.params.id);
    req.audit?.({ action: 'DEPARTMENT_DELETE', module: 'org', entityType: 'Department', entityId: req.params.id, description: `Deleted department ${req.params.id}` });
    return ok(res, null, 'Department deleted');
  }),
);

// ── Companies ────────────────────────────────────────────────────────────────
router.get('/companies', canView, asyncHandler(async (_req, res) => ok(res, await orgService.listCompanies())));
router.post(
  '/companies',
  canManage,
  validate({ body: createCompanySchema }),
  asyncHandler(async (req, res) => {
    const c = await orgService.createCompany(req.body);
    req.audit?.({ action: 'COMPANY_CREATE', module: 'org', entityType: 'Company', entityId: c.id, description: `Created company ${c.name}` });
    return created(res, c, 'Company created');
  }),
);
router.patch(
  '/companies/:id',
  canManage,
  validate({ params: idParam, body: updateCompanySchema }),
  asyncHandler(async (req, res) => {
    const c = await orgService.updateCompany(req.params.id, req.body);
    req.audit?.({ action: 'COMPANY_UPDATE', module: 'org', entityType: 'Company', entityId: c.id, description: `Updated company ${c.name}` });
    return ok(res, c, 'Company updated');
  }),
);
router.delete(
  '/companies/:id',
  canManage,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await orgService.removeCompany(req.params.id);
    req.audit?.({ action: 'COMPANY_DELETE', module: 'org', entityType: 'Company', entityId: req.params.id, description: `Deleted company ${req.params.id}` });
    return ok(res, null, 'Company deleted');
  }),
);

export default router;
