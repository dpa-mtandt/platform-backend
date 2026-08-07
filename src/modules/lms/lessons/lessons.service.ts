import type { Prisma, DownloadRequest } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { ApiError } from '../../../utils/apiError';
import type { Viewer } from '../courses/courses.service';
import type { CreateLessonInput, ProgressInput, UpdateLessonInput } from './lessons.validation';
import { recomputeCourseCompletion } from '../lms.completion';
import { serializeVideo, serializeDocument } from '../media/media.serialize';
import { safeUnlink } from '../media/media.stream';

type VideoInput = NonNullable<CreateLessonInput['video']>;

function videoWriteData(v: VideoInput, fallbackTitle: string) {
  const fileKey = v.fileKey || null;
  return {
    title: v.title || fallbackTitle,
    url: fileKey ? '' : (v.url?.trim() || ''),
    fileKey,
    isProtected: v.isProtected ?? Boolean(fileKey),
    mimeType: v.mimeType || null,
    duration: v.duration ?? 0,
    sizeBytes: BigInt(Math.floor(v.sizeBytes ?? 0)),
    thumbnailUrl: v.thumbnailUrl || null,
    provider: v.provider || (fileKey ? 'upload' : null),
  };
}

export const lessonsService = {
  async get(id: string, viewer: Viewer) {
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        video: true,
        documents: { orderBy: { orderIndex: 'asc' } },
        section: { select: { id: true, title: true, courseId: true, course: { select: { id: true, slug: true, title: true, status: true } } } },
      },
    });
    if (!lesson) throw ApiError.notFound('Lesson not found');
    const published = lesson.section.course.status === 'PUBLISHED';
    if (!published && !viewer.canManage) throw ApiError.notFound('Lesson not found');

    const siblings = await prisma.lesson.findMany({
      where: { section: { courseId: lesson.section.courseId } },
      orderBy: [{ section: { orderIndex: 'asc' } }, { orderIndex: 'asc' }],
      select: { id: true },
    });
    const idx = siblings.findIndex((s) => s.id === id);
    const progress = await prisma.lessonProgress.findUnique({ where: { userId_lessonId: { userId: viewer.id, lessonId: id } } });

    const latestByDoc = new Map<string, DownloadRequest>();
    if (lesson.documents.length) {
      const reqs = await prisma.downloadRequest.findMany({
        where: { userId: viewer.id, documentId: { in: lesson.documents.map((d) => d.id) } },
        orderBy: { createdAt: 'desc' },
      });
      for (const r of reqs) if (!latestByDoc.has(r.documentId)) latestByDoc.set(r.documentId, r);
    }

    const { video: rawVideo, documents: rawDocs, ...rest } = lesson;
    return {
      ...rest,
      video: serializeVideo(rawVideo, viewer.id, { includeSource: viewer.canManage }),
      documents: rawDocs.map((d) => serializeDocument(d, viewer.id, latestByDoc.get(d.id) ?? null)),
      prevLessonId: idx > 0 ? siblings[idx - 1]!.id : null,
      nextLessonId: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1]!.id : null,
      progress,
    };
  },

  async create(input: CreateLessonInput) {
    const section = await prisma.section.findUnique({ where: { id: input.sectionId }, select: { id: true } });
    if (!section) throw ApiError.notFound('Section not found');
    let orderIndex = input.orderIndex;
    if (orderIndex === undefined) {
      const max = await prisma.lesson.aggregate({ where: { sectionId: input.sectionId }, _max: { orderIndex: true } });
      orderIndex = (max._max.orderIndex ?? -1) + 1;
    }
    return prisma.lesson.create({
      data: {
        sectionId: input.sectionId,
        title: input.title,
        type: input.type ?? 'RICH_TEXT',
        content: input.content || null,
        notes: input.notes || null,
        orderIndex,
        estimatedMinutes: input.estimatedMinutes ?? 0,
        isPreview: input.isPreview ?? false,
        ...(input.video ? { video: { create: videoWriteData(input.video, input.title) } } : {}),
      },
      include: { video: true },
    });
  },

  async update(id: string, input: UpdateLessonInput) {
    const lesson = await prisma.lesson.findUnique({ where: { id }, select: { id: true, video: { select: { id: true } } } });
    if (!lesson) throw ApiError.notFound('Lesson not found');

    const data: Prisma.LessonUpdateInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.content !== undefined ? { content: input.content || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
      ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
      ...(input.isPreview !== undefined ? { isPreview: input.isPreview } : {}),
    };
    if (input.video !== undefined) {
      if (input.video === null) {
        if (lesson.video) data.video = { delete: true };
      } else {
        const w = videoWriteData(input.video, input.title || 'Video');
        data.video = lesson.video ? { update: w } : { create: w };
      }
    }
    return prisma.lesson.update({ where: { id }, data, include: { video: true } });
  },

  async remove(id: string) {
    const l = await prisma.lesson.findUnique({
      where: { id },
      select: { id: true, video: { select: { fileKey: true } }, documents: { select: { fileKey: true } } },
    });
    if (!l) throw ApiError.notFound('Lesson not found');
    await prisma.lesson.delete({ where: { id } });
    safeUnlink(l.video?.fileKey);
    l.documents.forEach((d) => safeUnlink(d.fileKey));
  },

  async reorder(lessonIds: string[]) {
    await prisma.$transaction(lessonIds.map((id, i) => prisma.lesson.update({ where: { id }, data: { orderIndex: i } })));
    return { reordered: lessonIds.length };
  },

  async updateProgress(lessonId: string, viewer: Viewer, input: ProgressInput) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { section: { select: { courseId: true, course: { select: { status: true } } } } },
    });
    if (!lesson) throw ApiError.notFound('Lesson not found');
    if (lesson.section.course.status !== 'PUBLISHED' && !viewer.canManage) throw ApiError.notFound('Lesson not found');
    const courseId = lesson.section.courseId;

    const existing = await prisma.lessonProgress.findUnique({ where: { userId_lessonId: { userId: viewer.id, lessonId } } });
    const watchedSeconds = Math.max(existing?.watchedSeconds ?? 0, input.watchedSeconds ?? 0);
    const watchPercent = Math.max(existing?.watchPercent ?? 0, input.watchPercent ?? 0);
    const completed = (existing?.completed ?? false) || (input.completed ?? false) || watchPercent >= 95;

    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: viewer.id, lessonId } },
      update: {
        watchedSeconds,
        watchPercent,
        lastPositionSeconds: input.lastPositionSeconds ?? existing?.lastPositionSeconds ?? 0,
        completed,
        ...(completed && !existing?.completed ? { completedAt: new Date() } : {}),
      },
      create: {
        userId: viewer.id,
        lessonId,
        watchedSeconds,
        watchPercent,
        lastPositionSeconds: input.lastPositionSeconds ?? 0,
        completed,
        ...(completed ? { completedAt: new Date() } : {}),
      },
    });

    const roll = await recomputeCourseCompletion(viewer.id, courseId);
    return { lessonCompleted: completed, ...roll };
  },
};
