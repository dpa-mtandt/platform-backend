import { Router } from 'express';
import { modulesService } from './modules.service';
import { createModuleSchema, updateModuleSchema, idParam } from './modules.validation';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created } from '../../utils/apiResponse';

const router = Router();
router.use(authenticate);

const canView = requirePermission('platform.modules.view');
const canManage = requirePermission('platform.modules.manage');

/**
 * @openapi
 * /modules:
 *   get: { tags: [Modules], summary: List the module registry, security: [{ bearerAuth: [] }], responses: { 200: { description: Modules } } }
 */
router.get('/', canView, asyncHandler(async (_req, res) => ok(res, await modulesService.list())));

router.post(
  '/',
  canManage,
  validate({ body: createModuleSchema }),
  asyncHandler(async (req, res) => {
    const module = await modulesService.create(req.body);
    req.audit?.({ action: 'MODULE_CREATE', module: 'modules', entityType: 'Module', entityId: module.id, description: `Created module ${module.key}` });
    return created(res, module, 'Module created');
  }),
);

router.patch(
  '/:id',
  canManage,
  validate({ params: idParam, body: updateModuleSchema }),
  asyncHandler(async (req, res) => {
    const module = await modulesService.update(req.params.id, req.body);
    req.audit?.({ action: 'MODULE_UPDATE', module: 'modules', entityType: 'Module', entityId: module.id, description: `Updated module ${module.key}` });
    return ok(res, module, 'Module updated');
  }),
);

router.delete(
  '/:id',
  canManage,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await modulesService.remove(req.params.id);
    req.audit?.({ action: 'MODULE_DELETE', module: 'modules', entityType: 'Module', entityId: req.params.id, description: `Deleted module ${req.params.id}` });
    return ok(res, null, 'Module deleted');
  }),
);

export default router;
