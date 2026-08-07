import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/apiError';

export const modulesService = {
  async list() {
    const modules = await prisma.module.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        icon: true,
        path: true,
        color: true,
        sortOrder: true,
        isActive: true,
        isCore: true,
        isExternal: true,
        externalUrl: true,
        createdAt: true,
        _count: { select: { permissions: true } },
      },
    });
    return modules.map((m) => ({ ...m, permissionCount: m._count.permissions, _count: undefined }));
  },

  async create(input: {
    key: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    path?: string | null;
    color?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    return prisma.module.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description || null,
        icon: input.icon || null,
        path: input.path || null,
        color: input.color || null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
        isCore: false,
      },
    });
  },

  async update(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      icon?: string | null;
      path?: string | null;
      color?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      isExternal?: boolean;
      externalUrl?: string | null;
    },
  ) {
    const module = await prisma.module.findUnique({ where: { id }, select: { id: true, isCore: true } });
    if (!module) throw ApiError.notFound('Module not found');
    // Core modules (the admin console) can never be deactivated.
    if (module.isCore && input.isActive === false) {
      throw ApiError.badRequest('A core module cannot be deactivated');
    }
    return prisma.module.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.icon !== undefined ? { icon: input.icon || null } : {}),
        ...(input.path !== undefined ? { path: input.path || null } : {}),
        ...(input.color !== undefined ? { color: input.color || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isExternal !== undefined ? { isExternal: input.isExternal } : {}),
        ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl || null } : {}),
      },
    });
  },

  async remove(id: string) {
    const module = await prisma.module.findUnique({ where: { id }, select: { id: true, isCore: true } });
    if (!module) throw ApiError.notFound('Module not found');
    if (module.isCore) throw ApiError.badRequest('A core module cannot be deleted');
    await prisma.module.delete({ where: { id } });
  },
};
