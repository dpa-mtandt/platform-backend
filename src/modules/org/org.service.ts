import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/apiError';

export const orgService = {
  // ── Departments ──────────────────────────────────────────────────────────
  async listDepartments() {
    const rows = await prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        companyId: true,
        managerId: true,
        company: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true, email: true } },
        _count: { select: { users: true } },
      },
    });
    return rows.map((d) => ({ ...d, userCount: d._count.users, _count: undefined }));
  },

  async createDepartment(input: { name: string; code?: string | null; description?: string | null; managerId?: string | null; companyId?: string | null }) {
    return prisma.department.create({
      data: {
        name: input.name,
        code: input.code || null,
        description: input.description || null,
        ...(input.managerId ? { manager: { connect: { id: input.managerId } } } : {}),
        ...(input.companyId ? { company: { connect: { id: input.companyId } } } : {}),
      },
    });
  },

  async updateDepartment(id: string, input: { name?: string; code?: string | null; description?: string | null; managerId?: string | null; companyId?: string | null }) {
    const dep = await prisma.department.findUnique({ where: { id }, select: { id: true } });
    if (!dep) throw ApiError.notFound('Department not found');
    return prisma.department.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code || null } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.managerId !== undefined ? (input.managerId ? { manager: { connect: { id: input.managerId } } } : { manager: { disconnect: true } }) : {}),
        ...(input.companyId !== undefined ? (input.companyId ? { company: { connect: { id: input.companyId } } } : { company: { disconnect: true } }) : {}),
      },
    });
  },

  async removeDepartment(id: string) {
    const dep = await prisma.department.findUnique({ where: { id }, select: { id: true } });
    if (!dep) throw ApiError.notFound('Department not found');
    // Members are detached (User.departmentId → SetNull) rather than deleted.
    await prisma.department.delete({ where: { id } });
  },

  // ── Companies ────────────────────────────────────────────────────────────
  async listCompanies() {
    const rows = await prisma.company.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, description: true, _count: { select: { users: true, departments: true, branches: true } } },
    });
    return rows.map((c) => ({ ...c, userCount: c._count.users, departmentCount: c._count.departments, branchCount: c._count.branches, _count: undefined }));
  },

  async createCompany(input: { name: string; code?: string | null; description?: string | null }) {
    return prisma.company.create({ data: { name: input.name, code: input.code || null, description: input.description || null } });
  },

  async updateCompany(id: string, input: { name?: string; code?: string | null; description?: string | null }) {
    const c = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw ApiError.notFound('Company not found');
    return prisma.company.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code || null } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      },
    });
  },

  async removeCompany(id: string) {
    const c = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw ApiError.notFound('Company not found');
    await prisma.company.delete({ where: { id } });
  },
};
