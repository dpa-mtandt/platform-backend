import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/apiError';

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
}
export interface ReportBody {
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  summary?: { label: string; value: string | number }[];
}
export interface ReportResult extends ReportBody {
  type: string;
  title: string;
  description: string;
  group: string;
  generatedAt: string;
}

export interface Scope {
  departmentIds: string[] | null; // null = org-wide
}

/**
 * Data scope for a report request. Org-wide access (departmentIds === null) must
 * be an EXPLICIT grant — super admin, or the `reports.view.all` permission. Every
 * other user is scoped to the departments they manage; a user who manages none
 * gets an empty scope (matches nothing) rather than falling open to org-wide.
 */
export async function getScope(user: { id: string; isSuperAdmin: boolean; permissions: Set<string> }): Promise<Scope> {
  if (user.isSuperAdmin || user.permissions.has('reports.view.all')) return { departmentIds: null };
  const managed = await prisma.department.findMany({ where: { managerId: user.id }, select: { id: true } });
  return { departmentIds: managed.map((d) => d.id) }; // [] when none → fail closed
}

const round = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtDate = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
const userWhere = (scope: Scope): Prisma.UserWhereInput => (scope.departmentIds ? { departmentId: { in: scope.departmentIds } } : {});

interface Builder {
  title: string;
  description: string;
  group: string;
  /** Extra permission required beyond reports.view (e.g. the audit trail). */
  minPermission?: string;
  build: (scope: Scope) => Promise<ReportBody>;
}

const BUILDERS: Record<string, Builder> = {
  // ── Training ────────────────────────────────────────────────────────────────
  'course-completion': {
    title: 'Course Completion',
    description: 'Enrolment and completion by course.',
    group: 'Training',
    build: async (scope) => {
      const courses = await prisma.course.findMany({
        where: { status: 'PUBLISHED' },
        select: {
          title: true,
          category: { select: { name: true } },
          enrollments: { where: scope.departmentIds ? { user: { departmentId: { in: scope.departmentIds } } } : {}, select: { status: true } },
        },
      });
      const rows = courses
        .map((c) => {
          const e = c.enrollments;
          const enrolled = e.length;
          const completed = e.filter((x) => x.status === 'COMPLETED').length;
          const inProgress = e.filter((x) => x.status === 'IN_PROGRESS').length;
          return { course: c.title, category: c.category?.name ?? '—', enrolled, inProgress, completed, completionRate: enrolled ? round((completed / enrolled) * 100) : 0 };
        })
        .sort((a, b) => b.enrolled - a.enrolled);
      const totalEnroll = rows.reduce((s, r) => s + r.enrolled, 0);
      const totalComplete = rows.reduce((s, r) => s + r.completed, 0);
      return {
        columns: [
          { key: 'course', label: 'Course' },
          { key: 'category', label: 'Category' },
          { key: 'enrolled', label: 'Enrolled', align: 'right' },
          { key: 'inProgress', label: 'In progress', align: 'right' },
          { key: 'completed', label: 'Completed', align: 'right' },
          { key: 'completionRate', label: 'Completion %', align: 'right' },
        ],
        rows,
        summary: [
          { label: 'Published courses', value: rows.length },
          { label: 'Total enrolments', value: totalEnroll },
          { label: 'Overall completion', value: `${totalEnroll ? round((totalComplete / totalEnroll) * 100) : 0}%` },
        ],
      };
    },
  },

  learners: {
    title: 'Learner Progress',
    description: 'Per-person training activity.',
    group: 'Training',
    build: async (scope) => {
      const users = await prisma.user.findMany({
        where: { ...userWhere(scope) },
        orderBy: { name: 'asc' },
        select: {
          name: true,
          department: { select: { name: true } },
          enrollments: { select: { status: true } },
          _count: { select: { certificates: true } },
        },
      });
      const rows = users
        .filter((u) => u.enrollments.length > 0 || u._count.certificates > 0)
        .map((u) => ({
          learner: u.name,
          department: u.department?.name ?? '—',
          enrolled: u.enrollments.length,
          completed: u.enrollments.filter((e) => e.status === 'COMPLETED').length,
          certificates: u._count.certificates,
        }));
      return {
        columns: [
          { key: 'learner', label: 'Learner' },
          { key: 'department', label: 'Department' },
          { key: 'enrolled', label: 'Enrolled', align: 'right' },
          { key: 'completed', label: 'Completed', align: 'right' },
          { key: 'certificates', label: 'Certificates', align: 'right' },
        ],
        rows,
        summary: [
          { label: 'Active learners', value: rows.length },
          { label: 'Certificates earned', value: rows.reduce((s, r) => s + r.certificates, 0) },
        ],
      };
    },
  },

  certificates: {
    title: 'Certificates Issued',
    description: 'Every certificate awarded.',
    group: 'Training',
    build: async (scope) => {
      const certs = await prisma.certificate.findMany({
        where: scope.departmentIds ? { user: { departmentId: { in: scope.departmentIds } } } : {},
        orderBy: { issuedAt: 'desc' },
        select: { certificateNo: true, issuedAt: true, user: { select: { name: true, department: { select: { name: true } } } }, course: { select: { title: true } } },
      });
      const rows = certs.map((c) => ({ certificateNo: c.certificateNo, holder: c.user.name, department: c.user.department?.name ?? '—', course: c.course.title, issued: fmtDate(c.issuedAt) }));
      return {
        columns: [
          { key: 'certificateNo', label: 'Certificate No.' },
          { key: 'holder', label: 'Holder' },
          { key: 'department', label: 'Department' },
          { key: 'course', label: 'Course' },
          { key: 'issued', label: 'Issued' },
        ],
        rows,
        summary: [{ label: 'Certificates', value: rows.length }],
      };
    },
  },

  quizzes: {
    title: 'Quiz Performance',
    description: 'Attempts, pass rate and average score per quiz.',
    group: 'Training',
    build: async (scope) => {
      const quizzes = await prisma.quiz.findMany({
        where: { isPublished: true },
        select: {
          title: true,
          passPercentage: true,
          course: { select: { title: true } },
          attempts: { where: { status: { in: ['PASSED', 'FAILED'] }, ...(scope.departmentIds ? { user: { departmentId: { in: scope.departmentIds } } } : {}) }, select: { passed: true, score: true } },
        },
      });
      const rows = quizzes.map((q) => {
        const a = q.attempts;
        const attempts = a.length;
        const passed = a.filter((x) => x.passed).length;
        const avgScore = attempts ? round1(a.reduce((s, x) => s + x.score, 0) / attempts) : 0;
        return { quiz: q.title, course: q.course?.title ?? 'Standalone', attempts, passRate: attempts ? round((passed / attempts) * 100) : 0, avgScore };
      });
      return {
        columns: [
          { key: 'quiz', label: 'Quiz' },
          { key: 'course', label: 'Course' },
          { key: 'attempts', label: 'Attempts', align: 'right' },
          { key: 'passRate', label: 'Pass %', align: 'right' },
          { key: 'avgScore', label: 'Avg score', align: 'right' },
        ],
        rows,
        summary: [
          { label: 'Published quizzes', value: rows.length },
          { label: 'Total attempts', value: rows.reduce((s, r) => s + r.attempts, 0) },
        ],
      };
    },
  },

  // ── Feedback ────────────────────────────────────────────────────────────────
  'feedback-summary': {
    title: 'Feedback Summary',
    description: 'Aggregated ratings per person (no individual comments or givers).',
    group: 'Feedback',
    build: async (scope) => {
      const comps = await prisma.competency.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } });
      const feedbacks = await prisma.feedback.findMany({
        where: scope.departmentIds ? { recipient: { departmentId: { in: scope.departmentIds } } } : {},
        select: { recipientId: true, recipient: { select: { name: true, department: { select: { name: true } } } }, scores: { select: { competencyId: true, rating: true } } },
      });
      const map = new Map<string, { name: string; dept: string; count: number; all: number[]; per: Map<string, number[]> }>();
      for (const f of feedbacks) {
        let e = map.get(f.recipientId);
        if (!e) {
          e = { name: f.recipient.name, dept: f.recipient.department?.name ?? '—', count: 0, all: [], per: new Map() };
          map.set(f.recipientId, e);
        }
        e.count += 1;
        for (const s of f.scores) {
          e.all.push(s.rating);
          e.per.set(s.competencyId, [...(e.per.get(s.competencyId) ?? []), s.rating]);
        }
      }
      const avg = (a: number[]) => (a.length ? round1(a.reduce((x, y) => x + y, 0) / a.length) : 0);
      const rows = [...map.values()]
        .map((e) => {
          const row: Record<string, string | number | null> = { person: e.name, department: e.dept, responses: e.count, overall: avg(e.all) };
          for (const c of comps) row[c.id] = e.per.has(c.id) ? avg(e.per.get(c.id)!) : null;
          return row;
        })
        .sort((a, b) => (b.overall as number) - (a.overall as number));
      return {
        columns: [
          { key: 'person', label: 'Person' },
          { key: 'department', label: 'Department' },
          { key: 'responses', label: 'Responses', align: 'right' },
          { key: 'overall', label: 'Overall', align: 'right' },
          ...comps.map((c) => ({ key: c.id, label: c.name, align: 'right' as const })),
        ],
        rows,
        summary: [{ label: 'People with feedback', value: rows.length }, { label: 'Total responses', value: feedbacks.length }],
      };
    },
  },

  // ── Platform ────────────────────────────────────────────────────────────────
  'users-access': {
    title: 'Users & Access',
    description: 'Every user with their roles and accessible modules.',
    group: 'Platform',
    build: async (scope) => {
      const users = await prisma.user.findMany({
        where: { ...userWhere(scope) },
        orderBy: { name: 'asc' },
        select: {
          name: true,
          email: true,
          status: true,
          department: { select: { name: true } },
          userRoles: { select: { role: { select: { key: true, isSuperAdmin: true, rolePermissions: { select: { permission: { select: { moduleKey: true } } } } } } } },
          userPermissions: { select: { effect: true, permission: { select: { moduleKey: true } } } },
        },
      });
      const activeModules = await prisma.module.findMany({ where: { isActive: true }, select: { key: true } });
      const rows = users.map((u) => {
        const isSuper = u.userRoles.some((ur) => ur.role.isSuperAdmin);
        const mods = new Set<string>();
        for (const ur of u.userRoles) for (const rp of ur.role.rolePermissions) mods.add(rp.permission.moduleKey);
        for (const up of u.userPermissions) if (up.effect === 'ALLOW') mods.add(up.permission.moduleKey);
        const moduleList = isSuper ? activeModules.map((m) => m.key) : [...mods];
        return {
          name: u.name,
          email: u.email,
          department: u.department?.name ?? '—',
          roles: u.userRoles.map((ur) => ur.role.key).join(', ') || '—',
          modules: moduleList.join(', ') || '—',
          status: u.status,
        };
      });
      return {
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'department', label: 'Department' },
          { key: 'roles', label: 'Roles' },
          { key: 'modules', label: 'Modules' },
          { key: 'status', label: 'Status' },
        ],
        rows,
        summary: [
          { label: 'Users', value: rows.length },
          { label: 'Active', value: rows.filter((r) => r.status === 'ACTIVE').length },
        ],
      };
    },
  },

  'audit-log': {
    title: 'Audit Log',
    description: 'The 500 most recent audited actions.',
    group: 'Platform',
    minPermission: 'platform.audit.view',
    build: async () => {
      const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500, select: { createdAt: true, userName: true, userEmail: true, action: true, module: true, status: true } });
      const rows = logs.map((l) => ({ time: fmtDate(l.createdAt), actor: l.userName ?? l.userEmail ?? 'System', action: l.action, module: l.module, status: l.status }));
      return {
        columns: [
          { key: 'time', label: 'Time' },
          { key: 'actor', label: 'Actor' },
          { key: 'action', label: 'Action' },
          { key: 'module', label: 'Module' },
          { key: 'status', label: 'Status' },
        ],
        rows,
        summary: [{ label: 'Entries', value: rows.length }],
      };
    },
  },
};

type Principal = { isSuperAdmin: boolean; permissions: Set<string> };

function allowed(b: Builder, user: Principal) {
  return !b.minPermission || user.isSuperAdmin || user.permissions.has(b.minPermission);
}

export const reportsService = {
  listTypes(user: Principal) {
    return Object.entries(BUILDERS)
      .filter(([, b]) => allowed(b, user))
      .map(([type, b]) => ({ type, title: b.title, description: b.description, group: b.group }));
  },

  canAccessType(type: string, user: Principal) {
    const b = BUILDERS[type];
    return !b || allowed(b, user);
  },

  async getReport(type: string, scope: Scope): Promise<ReportResult> {
    const b = BUILDERS[type];
    if (!b) throw ApiError.notFound('Unknown report type');
    const body = await b.build(scope);
    return { type, title: b.title, description: b.description, group: b.group, generatedAt: new Date().toISOString(), ...body };
  },
};
