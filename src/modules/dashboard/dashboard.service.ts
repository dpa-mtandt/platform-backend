import type { Dashboard, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/apiError';
import { uniqueSlug } from '../../utils/slug';
import { generateEmbedConfig } from './powerbi.service';
import { normalizeSecureEmbedUrl } from './powerbiUrl';

export interface Viewer {
  id: string;
  isSuperAdmin: boolean;
  canManage: boolean;
}

/** Fields safe to return to a viewer (no Power BI wiring). */
const cardSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  category: true,
  icon: true,
  color: true,
  isActive: true,
  allowExport: true,
  sortOrder: true,
} satisfies Prisma.DashboardSelect;

function connectionOf(d: { workspaceId: string | null; reportId: string | null; secureEmbedUrl: string | null }) {
  if (d.workspaceId && d.reportId) return 'real';
  if (d.secureEmbedUrl) return 'secure';
  return 'mock';
}

function adminView(d: Dashboard & { _count?: { access: number } }) {
  return {
    id: d.id,
    key: d.key,
    name: d.name,
    description: d.description,
    category: d.category,
    icon: d.icon,
    color: d.color,
    secureEmbedUrl: d.secureEmbedUrl,
    workspaceId: d.workspaceId,
    reportId: d.reportId,
    embedUrl: d.embedUrl,
    isActive: d.isActive,
    allowExport: d.allowExport,
    sortOrder: d.sortOrder,
    connection: connectionOf(d),
    assignedCount: d._count?.access ?? 0,
  };
}

interface DashboardInput {
  name: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  color?: string | null;
  secureEmbedUrl?: string | null;
  workspaceId?: string | null;
  reportId?: string | null;
  embedUrl?: string | null;
  isActive?: boolean;
  allowExport?: boolean;
  sortOrder?: number;
}

export const dashboardService = {
  /** Dashboards the current user may open (managers/super-admins see all active). */
  async listAccessible(viewer: Viewer) {
    if (viewer.canManage) {
      return prisma.dashboard.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: cardSelect });
    }
    const rows = await prisma.dashboardAccess.findMany({
      where: { userId: viewer.id, dashboard: { isActive: true } },
      orderBy: { dashboard: { sortOrder: 'asc' } },
      select: { dashboard: { select: cardSelect } },
    });
    return rows.map((r) => r.dashboard);
  },

  /** Authorize + produce an embed config. Unassigned access → 403 even by URL. */
  async getEmbed(id: string, viewer: Viewer) {
    const dash = await prisma.dashboard.findUnique({ where: { id } });
    if (!dash || (!dash.isActive && !viewer.canManage)) throw ApiError.notFound('Dashboard not found');
    if (!viewer.canManage) {
      const link = await prisma.dashboardAccess.findUnique({ where: { userId_dashboardId: { userId: viewer.id, dashboardId: id } } });
      if (!link) throw ApiError.forbidden('You are not assigned to this dashboard');
    }
    const embed = await generateEmbedConfig({ reportId: dash.reportId, embedUrl: dash.embedUrl, secureEmbedUrl: dash.secureEmbedUrl, workspaceId: dash.workspaceId, allowExport: dash.allowExport });
    return {
      dashboard: { id: dash.id, key: dash.key, name: dash.name, description: dash.description, category: dash.category, icon: dash.icon, color: dash.color, allowExport: dash.allowExport },
      embed,
    };
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  async listAll() {
    const rows = await prisma.dashboard.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { access: true } } } });
    return rows.map(adminView);
  },

  async create(input: DashboardInput) {
    const key = await uniqueSlug(input.name, async (s) => !!(await prisma.dashboard.findUnique({ where: { key: s }, select: { id: true } })));
    const secureEmbedUrl = input.secureEmbedUrl ? normalizeSecureEmbedUrl(input.secureEmbedUrl) : null;
    const d = await prisma.dashboard.create({
      data: {
        key,
        name: input.name,
        description: input.description || null,
        category: input.category || null,
        icon: input.icon || null,
        color: input.color || null,
        secureEmbedUrl,
        workspaceId: input.workspaceId || null,
        reportId: input.reportId || null,
        embedUrl: input.embedUrl || null,
        isActive: input.isActive ?? true,
        allowExport: input.allowExport ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return adminView(d);
  },

  async update(id: string, input: Partial<DashboardInput>) {
    const existing = await prisma.dashboard.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw ApiError.notFound('Dashboard not found');
    const data: Prisma.DashboardUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.category !== undefined ? { category: input.category || null } : {}),
      ...(input.icon !== undefined ? { icon: input.icon || null } : {}),
      ...(input.color !== undefined ? { color: input.color || null } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId || null } : {}),
      ...(input.reportId !== undefined ? { reportId: input.reportId || null } : {}),
      ...(input.embedUrl !== undefined ? { embedUrl: input.embedUrl || null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.allowExport !== undefined ? { allowExport: input.allowExport } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    };
    if (input.secureEmbedUrl !== undefined) {
      data.secureEmbedUrl = input.secureEmbedUrl ? normalizeSecureEmbedUrl(input.secureEmbedUrl) : null;
    }
    const d = await prisma.dashboard.update({ where: { id }, data, include: { _count: { select: { access: true } } } });
    return adminView(d);
  },

  async remove(id: string) {
    const d = await prisma.dashboard.findUnique({ where: { id }, select: { id: true } });
    if (!d) throw ApiError.notFound('Dashboard not found');
    await prisma.dashboard.delete({ where: { id } });
  },

  /** Active users a dashboard manager can assign dashboards to. */
  async listUsers() {
    return prisma.user.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      take: 1000,
      select: { id: true, name: true, email: true, department: { select: { name: true } } },
    });
  },

  async getAccess(id: string) {
    const d = await prisma.dashboard.findUnique({ where: { id }, select: { id: true } });
    if (!d) throw ApiError.notFound('Dashboard not found');
    const rows = await prisma.dashboardAccess.findMany({ where: { dashboardId: id }, select: { userId: true } });
    return { assignedUserIds: rows.map((r) => r.userId) };
  },

  async setAccess(id: string, userIds: string[], actorId: string) {
    const d = await prisma.dashboard.findUnique({ where: { id }, select: { id: true } });
    if (!d) throw ApiError.notFound('Dashboard not found');
    if (userIds.length) {
      const found = await prisma.user.count({ where: { id: { in: userIds } } });
      if (found !== new Set(userIds).size) throw ApiError.badRequest('One or more users do not exist');
    }
    await prisma.$transaction([
      prisma.dashboardAccess.deleteMany({ where: { dashboardId: id } }),
      prisma.dashboardAccess.createMany({ data: userIds.map((userId) => ({ dashboardId: id, userId, assignedById: actorId })), skipDuplicates: true }),
    ]);
    return { assignedUserIds: userIds };
  },
};
