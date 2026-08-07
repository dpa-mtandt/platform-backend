import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

/** Fields safe to return for a user (never the password hash). */
export const listSelect = {
  id: true,
  employeeId: true,
  name: true,
  email: true,
  status: true,
  designation: true,
  phone: true,
  avatarUrl: true,
  departmentId: true,
  companyId: true,
  managerId: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true, code: true } },
  company: { select: { id: true, name: true } },
  userRoles: { select: { role: { select: { id: true, key: true, name: true, isSuperAdmin: true } } } },
} satisfies Prisma.UserSelect;

/** Detail select adds the user's direct permission grants. */
export const detailSelect = {
  ...listSelect,
  branchId: true,
  bio: true,
  manager: { select: { id: true, name: true, email: true } },
  userPermissions: {
    select: {
      id: true,
      effect: true,
      permission: { select: { id: true, key: true, name: true, moduleKey: true } },
    },
  },
} satisfies Prisma.UserSelect;

export const usersRepository = {
  findMany(args: {
    where: Prisma.UserWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.UserOrderByWithRelationInput;
  }) {
    return prisma.user.findMany({ ...args, select: listSelect });
  },
  count(where: Prisma.UserWhereInput) {
    return prisma.user.count({ where });
  },
  findDetail(id: string) {
    return prisma.user.findUnique({ where: { id }, select: detailSelect });
  },
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },
};
