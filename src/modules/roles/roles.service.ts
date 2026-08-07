import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/apiError';

interface Actor {
  id: string;
  isSuperAdmin: boolean;
  permissions: string[]; // effective permission keys the actor holds
}

/** A non-super-admin can never grant a permission they do not themselves hold. */
function assertCanGrant(permissionKeys: string[], actor: Actor) {
  if (actor.isSuperAdmin) return;
  const held = new Set(actor.permissions);
  const missing = permissionKeys.filter((k) => !held.has(k));
  if (missing.length) {
    throw ApiError.forbidden(`You cannot grant permissions you do not hold: ${missing.join(', ')}`);
  }
}

export const rolesService = {
  async list() {
    const roles = await prisma.role.findMany({
      orderBy: [{ isSuperAdmin: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        isSuperAdmin: true,
        createdAt: true,
        _count: { select: { rolePermissions: true, userRoles: true } },
      },
    });
    return roles.map((r) => ({
      ...r,
      permissionCount: r._count.rolePermissions,
      userCount: r._count.userRoles,
      _count: undefined,
    }));
  },

  async get(id: string) {
    const role = await prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        isSuperAdmin: true,
        createdAt: true,
        rolePermissions: {
          select: { permission: { select: { id: true, key: true, name: true, moduleKey: true, description: true } } },
        },
        _count: { select: { userRoles: true } },
      },
    });
    if (!role) throw ApiError.notFound('Role not found');
    return {
      ...role,
      permissions: role.rolePermissions.map((rp) => rp.permission),
      userCount: role._count.userRoles,
      rolePermissions: undefined,
      _count: undefined,
    };
  },

  async create(
    input: { key: string; name: string; description?: string | null; isSuperAdmin?: boolean; permissionIds?: string[] },
    actor: Actor,
  ) {
    if (input.isSuperAdmin && !actor.isSuperAdmin) {
      throw ApiError.forbidden('Only a super administrator can create a super-administrator role');
    }
    const permissionIds = input.permissionIds ?? [];
    if (permissionIds.length) {
      const perms = await prisma.permission.findMany({ where: { id: { in: permissionIds } }, select: { key: true } });
      if (perms.length !== new Set(permissionIds).size) throw ApiError.badRequest('One or more permissions do not exist');
      assertCanGrant(perms.map((p) => p.key), actor);
    }
    const role = await prisma.role.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description || null,
        isSuperAdmin: input.isSuperAdmin ?? false,
        isSystem: false,
        rolePermissions: permissionIds.length ? { create: permissionIds.map((permissionId) => ({ permissionId })) } : undefined,
      },
      select: { id: true },
    });
    return this.get(role.id);
  },

  async update(id: string, input: { name?: string; description?: string | null }) {
    const role = await prisma.role.findUnique({ where: { id }, select: { id: true } });
    if (!role) throw ApiError.notFound('Role not found');
    await prisma.role.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      },
    });
    return this.get(id);
  },

  async remove(id: string) {
    const role = await prisma.role.findUnique({
      where: { id },
      select: { id: true, isSystem: true, _count: { select: { userRoles: true } } },
    });
    if (!role) throw ApiError.notFound('Role not found');
    if (role.isSystem) throw ApiError.badRequest('System roles cannot be deleted');
    if (role._count.userRoles > 0) {
      throw ApiError.conflict('This role is assigned to users. Reassign them before deleting it.');
    }
    await prisma.role.delete({ where: { id } });
  },

  async setPermissions(id: string, permissionIds: string[], actor: Actor) {
    const role = await prisma.role.findUnique({ where: { id }, select: { id: true, isSuperAdmin: true } });
    if (!role) throw ApiError.notFound('Role not found');
    if (role.isSuperAdmin && !actor.isSuperAdmin) {
      throw ApiError.forbidden('Only a super administrator can modify a super-administrator role');
    }
    if (permissionIds.length) {
      const perms = await prisma.permission.findMany({ where: { id: { in: permissionIds } }, select: { key: true } });
      if (perms.length !== new Set(permissionIds).size) throw ApiError.badRequest('One or more permissions do not exist');
      assertCanGrant(perms.map((p) => p.key), actor);
    }
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true,
      }),
    ]);
    return this.get(id);
  },
};
