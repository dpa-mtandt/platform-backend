import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { ApiError } from '../../../utils/apiError';
import { slugify, uniqueSlug } from '../../../utils/slug';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination';
import { safeUnlink } from '../media/media.stream';
import type { CreateCourseInput, ListCoursesQuery, UpdateCourseInput } from './courses.validation';

/** The viewer's LMS capabilities — canManage gates draft visibility & authoring. */
export interface Viewer {
  id: string;
  isSuperAdmin: boolean;
  canManage: boolean;
}

const cardSelect = {
  id: true,
  title: true,
  slug: true,
  summary: true,
  thumbnailUrl: true,
  difficulty: true,
  estimatedMinutes: true,
  status: true,
  isFeatured: true,
  publishedAt: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true } },
  instructor: { select: { id: true, name: true } },
  tags: { select: { id: true, name: true, slug: true } },
  _count: { select: { enrollments: true, sections: true } },
} satisfies Prisma.CourseSelect;

function tagWrites(tags: string[]) {
  return tags.map((t) => ({ where: { name: t }, create: { name: t, slug: slugify(t) } }));
}

export const coursesService = {
  async list(query: ListCoursesQuery, viewer: Viewer) {
    const { page, limit, skip } = parsePagination(query, 12, 50);

    const and: Prisma.CourseWhereInput[] = [];
    if (!viewer.canManage) {
      and.push({ status: 'PUBLISHED' }); // learners never see drafts/archived
      and.push({ enrollments: { some: { userId: viewer.id } } }); // …and only courses assigned to them
    } else if (query.status) {
      and.push({ status: query.status });
    }
    if (query.categoryId) and.push({ categoryId: query.categoryId });
    if (query.difficulty) and.push({ difficulty: query.difficulty });
    if (query.featured === 'true') and.push({ isFeatured: true });
    if (query.search) {
      const s = query.search.trim();
      and.push({ OR: [{ title: { contains: s, mode: 'insensitive' } }, { summary: { contains: s, mode: 'insensitive' } }, { description: { contains: s, mode: 'insensitive' } }] });
    }
    const where: Prisma.CourseWhereInput = and.length ? { AND: and } : {};

    const [rows, total, myEnrollments] = await Promise.all([
      prisma.course.findMany({ where, skip, take: limit, orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }], select: cardSelect }),
      prisma.course.count({ where }),
      prisma.enrollment.findMany({ where: { userId: viewer.id }, select: { courseId: true, status: true, progressPercent: true } }),
    ]);
    const enrollMap = new Map(myEnrollments.map((e) => [e.courseId, e]));

    // For managers, surface how many assignees are past due per course (at-a-glance).
    const overdueMap = new Map<string, number>();
    if (viewer.canManage && rows.length) {
      const grouped = await prisma.enrollment.groupBy({
        by: ['courseId'],
        where: { courseId: { in: rows.map((c) => c.id) }, status: { not: 'COMPLETED' }, dueDate: { lt: new Date() } },
        _count: { _all: true },
      });
      grouped.forEach((g) => overdueMap.set(g.courseId, g._count._all));
    }

    const data = rows.map((c) => ({
      ...c,
      sectionCount: c._count.sections,
      enrollmentCount: c._count.enrollments,
      overdueCount: overdueMap.get(c.id) ?? 0,
      _count: undefined,
      myEnrollment: enrollMap.get(c.id) ?? null,
    }));
    return { data, pagination: buildPaginationMeta(total, page, limit) };
  },

  async getBySlug(slug: string, viewer: Viewer) {
    const course = await prisma.course.findUnique({
      where: { slug },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        instructor: { select: { id: true, name: true, designation: true } },
        tags: { select: { id: true, name: true, slug: true } },
        sections: {
          orderBy: { orderIndex: 'asc' },
          include: {
            lessons: {
              orderBy: { orderIndex: 'asc' },
              select: { id: true, title: true, type: true, orderIndex: true, isPreview: true, estimatedMinutes: true, video: { select: { id: true, duration: true } } },
            },
          },
        },
        _count: { select: { enrollments: true } },
      },
    });
    if (!course) throw ApiError.notFound('Course not found');
    if (course.status !== 'PUBLISHED' && !viewer.canManage) throw ApiError.notFound('Course not found');

    const [enrollment, progress] = await Promise.all([
      prisma.enrollment.findUnique({ where: { userId_courseId: { userId: viewer.id, courseId: course.id } } }),
      prisma.lessonProgress.findMany({ where: { userId: viewer.id, lesson: { section: { courseId: course.id } } }, select: { lessonId: true, completed: true } }),
    ]);
    // Learners may only open a course that has been assigned to them.
    if (!viewer.canManage && !enrollment) throw ApiError.notFound('Course not found');
    const lessonCount = course.sections.reduce((n, s) => n + s.lessons.length, 0);
    return {
      ...course,
      enrollmentCount: course._count.enrollments,
      _count: undefined,
      myEnrollment: enrollment,
      lessonCount,
      completedLessonIds: progress.filter((p) => p.completed).map((p) => p.lessonId),
    };
  },

  /** Bootstrap the course player: ensures enrollment, returns sections+lessons+progress. */
  async getLearn(slug: string, viewer: Viewer) {
    const course = await prisma.course.findUnique({
      where: { slug },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        sections: {
          orderBy: { orderIndex: 'asc' },
          select: { id: true, title: true, orderIndex: true, lessons: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true, type: true, orderIndex: true, estimatedMinutes: true } } },
        },
      },
    });
    if (!course) throw ApiError.notFound('Course not found');
    if (course.status !== 'PUBLISHED' && !viewer.canManage) throw ApiError.notFound('Course not found');

    // Access is assignment-gated: a learner can only open a course assigned to them.
    // Opening it advances an ASSIGNED enrollment to IN_PROGRESS. Managers may preview
    // any course without being enrolled.
    const existing = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: viewer.id, courseId: course.id } },
      select: { status: true, startedAt: true },
    });
    if (!existing) {
      if (!viewer.canManage) throw ApiError.forbidden('This course has not been assigned to you yet.');
    } else {
      await prisma.enrollment.update({
        where: { userId_courseId: { userId: viewer.id, courseId: course.id } },
        data: {
          lastAccessedAt: new Date(),
          ...(existing.status === 'ASSIGNED' ? { status: 'IN_PROGRESS', startedAt: existing.startedAt ?? new Date() } : {}),
        },
      });
    }

    const progress = await prisma.lessonProgress.findMany({
      where: { userId: viewer.id, lesson: { section: { courseId: course.id } } },
      select: { lessonId: true, completed: true, watchPercent: true, lastPositionSeconds: true },
    });
    const pmap = new Map(progress.map((p) => [p.lessonId, p]));
    const sections = course.sections.map((s) => ({ ...s, lessons: s.lessons.map((l) => ({ ...l, progress: pmap.get(l.id) ?? null })) }));
    const flat = sections.flatMap((s) => s.lessons);
    const resumeLessonId = flat.find((l) => !pmap.get(l.id)?.completed)?.id ?? flat[0]?.id ?? null;
    return { course: { id: course.id, title: course.title, slug: course.slug }, sections, resumeLessonId };
  },

  async create(input: CreateCourseInput, viewer: Viewer) {
    const slug = await uniqueSlug(input.slug || input.title, async (s) => !!(await prisma.course.findUnique({ where: { slug: s }, select: { id: true } })));
    const created = await prisma.course.create({
      data: {
        title: input.title,
        slug,
        description: input.description || null,
        summary: input.summary || null,
        thumbnailUrl: input.thumbnailUrl || null,
        difficulty: input.difficulty ?? 'BEGINNER',
        estimatedMinutes: input.estimatedMinutes ?? 0,
        status: input.status ?? 'DRAFT',
        isFeatured: input.isFeatured ?? false,
        ...(input.status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
        ...(input.categoryId ? { category: { connect: { id: input.categoryId } } } : {}),
        ...(input.instructorId ? { instructor: { connect: { id: input.instructorId } } } : {}),
        createdBy: { connect: { id: viewer.id } },
        ...(input.tags?.length ? { tags: { connectOrCreate: tagWrites(input.tags) } } : {}),
      },
      select: { slug: true },
    });
    return this.getBySlug(created.slug, viewer);
  },

  async update(id: string, input: UpdateCourseInput, viewer: Viewer) {
    const existing = await prisma.course.findUnique({ where: { id }, select: { id: true, publishedAt: true } });
    if (!existing) throw ApiError.notFound('Course not found');

    const data: Prisma.CourseUpdateInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.summary !== undefined ? { summary: input.summary || null } : {}),
      ...(input.thumbnailUrl !== undefined ? { thumbnailUrl: input.thumbnailUrl || null } : {}),
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(input.categoryId !== undefined ? (input.categoryId ? { category: { connect: { id: input.categoryId } } } : { category: { disconnect: true } }) : {}),
      ...(input.instructorId !== undefined ? (input.instructorId ? { instructor: { connect: { id: input.instructorId } } } : { instructor: { disconnect: true } }) : {}),
    };
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'PUBLISHED' && !existing.publishedAt) data.publishedAt = new Date();
    }
    if (input.tags !== undefined) {
      data.tags = { set: [], connectOrCreate: tagWrites(input.tags) };
    }
    const updated = await prisma.course.update({ where: { id }, data, select: { slug: true } });
    return this.getBySlug(updated.slug, viewer);
  },

  async remove(id: string) {
    const c = await prisma.course.findUnique({
      where: { id },
      select: {
        id: true,
        sections: { select: { lessons: { select: { video: { select: { fileKey: true } }, documents: { select: { fileKey: true } } } } } },
      },
    });
    if (!c) throw ApiError.notFound('Course not found');
    await prisma.course.delete({ where: { id } });
    // Prisma cascades the DB rows; clean up any uploaded files on disk too so a
    // deleted course doesn't orphan protected videos/documents.
    for (const s of c.sections) {
      for (const l of s.lessons) {
        safeUnlink(l.video?.fileKey);
        l.documents.forEach((d) => safeUnlink(d.fileKey));
      }
    }
  },

  /** Active users with LMS access (via role or a direct grant) — the pool for "assign to everyone". */
  async lmsAudience() {
    return prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { userRoles: { some: { role: { OR: [{ isSuperAdmin: true }, { rolePermissions: { some: { permission: { key: 'lms.access' } } } }] } } } },
          { userPermissions: { some: { effect: 'ALLOW', permission: { key: 'lms.access' } } } },
        ],
      },
      select: { id: true },
    });
  },

  /** Assign a published course to users, a department, or everyone; enrolls + notifies. */
  async assign(courseId: string, input: { userIds?: string[]; departmentId?: string | null; all?: boolean; dueDate?: string | null }, actorId: string) {
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, status: true, slug: true, title: true } });
    if (!course) throw ApiError.notFound('Course not found');
    if (course.status !== 'PUBLISHED') throw ApiError.badRequest('Only published courses can be assigned');

    const targets = new Set<string>();
    (input.userIds ?? []).forEach((id) => targets.add(id));
    if (input.departmentId) {
      const deptUsers = await prisma.user.findMany({ where: { departmentId: input.departmentId, status: 'ACTIVE' }, select: { id: true } });
      deptUsers.forEach((u) => targets.add(u.id));
    }
    if (input.all) {
      (await this.lmsAudience()).forEach((u) => targets.add(u.id));
    }
    targets.delete(actorId);
    if (targets.size === 0) throw ApiError.badRequest('No target users to assign');

    const due = input.dueDate ? new Date(input.dueDate) : null;
    const ids = [...targets];
    for (const uid of ids) {
      await prisma.enrollment.upsert({
        where: { userId_courseId: { userId: uid, courseId } },
        update: { assignedById: actorId, ...(due ? { dueDate: due } : {}) },
        create: { userId: uid, courseId, status: 'ASSIGNED', assignedById: actorId, dueDate: due },
      });
    }
    await prisma.notification.createMany({
      data: ids.map((uid) => ({
        userId: uid,
        type: 'TRAINING_ASSIGNMENT' as const,
        title: 'New training assigned',
        message: `You have been assigned "${course.title}"${due ? ` — due ${due.toDateString()}` : ''}.`,
        link: `/lms/learn/${course.slug}`,
      })),
    });
    return { assigned: ids.length };
  },

  /** Everyone assigned/enrolled in a course, with progress + overdue tracking. */
  async listAssignments(courseId: string) {
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw ApiError.notFound('Course not found');
    const rows = await prisma.enrollment.findMany({
      where: { courseId },
      orderBy: [{ status: 'asc' }, { assignedAt: 'desc' }],
      include: {
        user: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
        assignedBy: { select: { id: true, name: true } },
      },
    });
    const now = Date.now();
    return rows.map((e) => ({
      userId: e.userId,
      user: e.user,
      status: e.status,
      progressPercent: e.progressPercent,
      dueDate: e.dueDate,
      assignedAt: e.assignedAt,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      lastAccessedAt: e.lastAccessedAt,
      assignedBy: e.assignedBy,
      overdue: !!e.dueDate && e.status !== 'COMPLETED' && e.dueDate.getTime() < now,
    }));
  },

  /** Edit a single assignee's enrollment — currently the due date (null clears it). */
  async updateAssignment(courseId: string, userId: string, input: { dueDate?: string | null }) {
    const enr = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } });
    if (!enr) throw ApiError.notFound('This user is not assigned to the course');
    const data: Prisma.EnrollmentUpdateInput = {};
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    await prisma.enrollment.update({ where: { userId_courseId: { userId, courseId } }, data });
    return { updated: true };
  },

  /** Unassign a user from a course (removes their enrollment → they no longer see it). */
  async unassign(courseId: string, userId: string) {
    const enr = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } });
    if (!enr) throw ApiError.notFound('This user is not assigned to the course');
    await prisma.enrollment.delete({ where: { userId_courseId: { userId, courseId } } });
  },
};
