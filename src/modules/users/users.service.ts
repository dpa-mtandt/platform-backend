import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/apiError';
import { hashPassword } from '../../utils/password';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination';
import { resolveUserAccess } from '../../utils/rbac';
import { usersRepository, listSelect, detailSelect } from './users.repository';
import type { CreateUserInput, UpdateUserInput } from './users.validation';

interface Actor {
  id: string;
  isSuperAdmin: boolean;
  permissions: string[]; // the actor's own effective permission keys
}

interface ListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  role?: string;
  module?: string;
  departmentId?: string;
}

/**
 * Guard role assignment against privilege amplification. A super admin may
 * assign anything. A non-super-admin may NOT:
 *   (a) assign a super-admin role, nor
 *   (b) assign a role that grants any permission the actor does not themselves
 *       hold — otherwise a user with only `platform.users.manage` could hand
 *       themselves a powerful (non-super-admin) role and escalate.
 */
async function assertRolesAssignable(roleIds: string[], actor: Actor) {
  if (roleIds.length === 0) return;
  const roles = await prisma.role.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, isSuperAdmin: true, rolePermissions: { select: { permission: { select: { key: true } } } } },
  });
  if (roles.length !== new Set(roleIds).size) throw ApiError.badRequest('One or more roles do not exist');
  if (actor.isSuperAdmin) return;

  if (roles.some((r) => r.isSuperAdmin)) {
    throw ApiError.forbidden('Only a super administrator can grant a super-administrator role');
  }
  const held = new Set(actor.permissions);
  const missing = new Set<string>();
  for (const r of roles) {
    for (const rp of r.rolePermissions) {
      if (!held.has(rp.permission.key)) missing.add(rp.permission.key);
    }
  }
  if (missing.size) {
    throw ApiError.forbidden(`You cannot assign a role that grants permissions you do not hold: ${[...missing].join(', ')}`);
  }
}

/** A non-super-admin may never modify, delete, reset, or re-role a super-admin account. */
async function assertCanManageTarget(targetUserId: string, actor: Actor) {
  if (actor.isSuperAdmin) return;
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { userRoles: { select: { role: { select: { isSuperAdmin: true } } } } },
  });
  if (target?.userRoles.some((ur) => ur.role.isSuperAdmin)) {
    throw ApiError.forbidden('Only a super administrator can manage a super-administrator account');
  }
}

async function attachAccess<T extends { id: string }>(user: T) {
  const access = await resolveUserAccess(user.id);
  return {
    ...user,
    access: access
      ? {
          isSuperAdmin: access.isSuperAdmin,
          roles: access.roles,
          permissions: [...access.permissions],
          modules: [...access.modules],
        }
      : null,
  };
}

export const usersService = {
  async list(query: ListQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 100);

    const and: Prisma.UserWhereInput[] = [];
    if (query.search) {
      const s = query.search.trim();
      and.push({
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { employeeId: { contains: s, mode: 'insensitive' } },
        ],
      });
    }
    if (query.status) and.push({ status: query.status });
    if (query.departmentId) and.push({ departmentId: query.departmentId });
    if (query.role) and.push({ userRoles: { some: { role: { key: query.role } } } });
    if (query.module) {
      // Users who can access a module via any role that grants a permission in it.
      and.push({
        userRoles: { some: { role: { rolePermissions: { some: { permission: { moduleKey: query.module } } } } } },
      });
    }
    const where: Prisma.UserWhereInput = and.length ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      usersRepository.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      usersRepository.count(where),
    ]);

    return { data: rows, pagination: buildPaginationMeta(total, page, limit) };
  },

  async get(id: string) {
    const user = await usersRepository.findDetail(id);
    if (!user) throw ApiError.notFound('User not found');
    return attachAccess(user);
  },

  async create(input: CreateUserInput, actor: Actor) {
    const roleIds = input.roleIds ?? [];
    await assertRolesAssignable(roleIds, actor);

    const passwordHash = await hashPassword(input.password);
    const data: Prisma.UserCreateInput = {
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      employeeId: input.employeeId || null,
      designation: input.designation || null,
      phone: input.phone || null,
      status: input.status ?? 'ACTIVE',
      ...(input.departmentId ? { department: { connect: { id: input.departmentId } } } : {}),
      ...(input.companyId ? { company: { connect: { id: input.companyId } } } : {}),
      ...(input.managerId ? { manager: { connect: { id: input.managerId } } } : {}),
      ...(roleIds.length
        ? { userRoles: { create: roleIds.map((roleId) => ({ role: { connect: { id: roleId } }, assignedBy: { connect: { id: actor.id } } })) } }
        : {}),
    };
    const created = await prisma.user.create({ data, select: detailSelect });
    return attachAccess(created);
  },

  async update(id: string, input: UpdateUserInput, actor: Actor) {
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw ApiError.notFound('User not found');
    await assertCanManageTarget(id, actor);

    const data: Prisma.UserUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.employeeId !== undefined ? { employeeId: input.employeeId || null } : {}),
      ...(input.designation !== undefined ? { designation: input.designation || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.departmentId !== undefined
        ? input.departmentId
          ? { department: { connect: { id: input.departmentId } } }
          : { department: { disconnect: true } }
        : {}),
      ...(input.companyId !== undefined
        ? input.companyId
          ? { company: { connect: { id: input.companyId } } }
          : { company: { disconnect: true } }
        : {}),
      ...(input.managerId !== undefined
        ? input.managerId
          ? { manager: { connect: { id: input.managerId } } }
          : { manager: { disconnect: true } }
        : {}),
    };

    if (input.roleIds !== undefined) {
      await assertRolesAssignable(input.roleIds, actor);
      await prisma.$transaction([
        prisma.userRole.deleteMany({ where: { userId: id } }),
        prisma.userRole.createMany({
          data: input.roleIds.map((roleId) => ({ userId: id, roleId, assignedById: actor.id })),
          skipDuplicates: true,
        }),
        prisma.user.update({ where: { id }, data }),
      ]);
    } else {
      await prisma.user.update({ where: { id }, data });
    }

    return this.get(id);
  },

  async remove(id: string, actor: Actor) {
    if (id === actor.id) throw ApiError.badRequest('You cannot delete your own account');
    await assertCanManageTarget(id, actor);
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, userRoles: { select: { role: { select: { isSuperAdmin: true } } } } },
    });
    if (!user) throw ApiError.notFound('User not found');

    // Never delete the last remaining super admin.
    const isSuper = user.userRoles.some((ur) => ur.role.isSuperAdmin);
    if (isSuper) {
      const superAdmins = await prisma.user.count({ where: { userRoles: { some: { role: { isSuperAdmin: true } } } } });
      if (superAdmins <= 1) throw ApiError.badRequest('Cannot delete the last super administrator');
    }

    await prisma.user.delete({ where: { id } });
  },

  async resetPassword(id: string, newPassword: string, actor: Actor) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw ApiError.notFound('User not found');
    await assertCanManageTarget(id, actor);
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    // Revoke active sessions so the old password can't linger.
    await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  async setRoles(id: string, roleIds: string[], actor: Actor) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw ApiError.notFound('User not found');
    await assertCanManageTarget(id, actor);
    await assertRolesAssignable(roleIds, actor);
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: id } }),
      prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId: id, roleId, assignedById: actor.id })),
        skipDuplicates: true,
      }),
    ]);
    return this.get(id);
  },

  async setPermissions(id: string, permissions: { permissionId: string; effect: 'ALLOW' | 'DENY' }[], actor: Actor) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw ApiError.notFound('User not found');
    if (permissions.length) {
      const ids = permissions.map((p) => p.permissionId);
      const found = await prisma.permission.count({ where: { id: { in: ids } } });
      if (found !== new Set(ids).size) throw ApiError.badRequest('One or more permissions do not exist');
    }
    await prisma.$transaction([
      prisma.userPermission.deleteMany({ where: { userId: id } }),
      prisma.userPermission.createMany({
        data: permissions.map((p) => ({ userId: id, permissionId: p.permissionId, effect: p.effect, assignedById: actor.id })),
        skipDuplicates: true,
      }),
    ]);
    return this.get(id);
  },
};
