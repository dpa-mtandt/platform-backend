import { prisma } from '../../config/prisma';

export const permissionsService = {
  /** Flat list of all permissions. */
  async list() {
    return prisma.permission.findMany({
      orderBy: [{ moduleKey: 'asc' }, { key: 'asc' }],
      select: { id: true, key: true, name: true, moduleKey: true, description: true },
    });
  },

  /** Permissions grouped by module (with module metadata) for permission-picker UIs. */
  async listGrouped() {
    const [modules, perms] = await Promise.all([
      prisma.module.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { key: true, name: true, icon: true, color: true, sortOrder: true, isActive: true },
      }),
      prisma.permission.findMany({
        orderBy: { key: 'asc' },
        select: { id: true, key: true, name: true, moduleKey: true, description: true },
      }),
    ]);

    const groups = new Map<string, { module: { key: string; name: string; icon?: string | null; color?: string | null; sortOrder: number }; permissions: typeof perms }>();
    for (const m of modules) groups.set(m.key, { module: { key: m.key, name: m.name, icon: m.icon, color: m.color, sortOrder: m.sortOrder }, permissions: [] });
    for (const p of perms) {
      if (!groups.has(p.moduleKey)) {
        groups.set(p.moduleKey, { module: { key: p.moduleKey, name: p.moduleKey, sortOrder: 999 }, permissions: [] });
      }
      groups.get(p.moduleKey)!.permissions.push(p);
    }
    return [...groups.values()].sort((a, b) => a.module.sortOrder - b.module.sortOrder);
  },
};
