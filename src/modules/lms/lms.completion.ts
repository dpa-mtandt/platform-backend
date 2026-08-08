import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';

/** Serial format: MG-<year>-<NNN>, e.g. MG-2026-001, incrementing per year. */
function certPrefix(year: number): string {
  return `MG-${year}-`;
}

/** Idempotently issue a completion certificate (+ notification) for a course. */
export async function issueCertificate(userId: string, courseId: string) {
  const existing = await prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { certificateNo: true } });
  if (existing) return existing;

  const prefix = certPrefix(new Date().getFullYear());

  // Sequential number = (certificates already issued this year) + 1. Retry on the
  // rare race where two certificates grab the same number at the same instant.
  for (let attempt = 0; attempt < 6; attempt++) {
    const issuedThisYear = await prisma.certificate.count({ where: { certificateNo: { startsWith: prefix } } });
    const certificateNo = `${prefix}${String(issuedThisYear + 1).padStart(3, '0')}`;
    try {
      const cert = await prisma.certificate.create({ data: { certificateNo, userId, courseId }, select: { certificateNo: true } });
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
      await prisma.notification.create({
        data: { userId, type: 'CERTIFICATE', title: 'Certificate earned', message: `You completed "${course?.title ?? 'a course'}" and earned a certificate.`, link: `/lms/certificates/${cert.certificateNo}` },
      });
      return cert;
    } catch (err) {
      // Either this user already has a certificate (userId+courseId is unique) → return it,
      // or another certificate took this number concurrently → recount and retry.
      const mine = await prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { certificateNo: true } });
      if (mine) return mine;
      logger.warn(`Certificate number race (${certificateNo}) — retrying`, err);
    }
  }
  return prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { certificateNo: true } });
}

/**
 * Recompute a user's enrollment state for a course and, when the course is fully
 * complete, mark it COMPLETED and issue a certificate.
 *
 * A course is COMPLETE when ALL lessons are completed AND every PUBLISHED quiz
 * attached to the course has at least one passing attempt. progressPercent
 * reflects lesson (content) progress.
 */
export async function recomputeCourseCompletion(userId: string, courseId: string) {
  const [course, totalLessons, completedLessons, publishedQuizzes] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { status: true } }),
    prisma.lesson.count({ where: { section: { courseId } } }),
    prisma.lessonProgress.count({ where: { userId, completed: true, lesson: { section: { courseId } } } }),
    prisma.quiz.findMany({ where: { courseId, isPublished: true }, select: { id: true } }),
  ]);

  const lessonPercent = totalLessons === 0 ? 100 : Math.round((completedLessons / totalLessons) * 100);
  const contentComplete = totalLessons === 0 || completedLessons >= totalLessons;

  let quizzesPassed = true;
  if (publishedQuizzes.length) {
    const quizIds = publishedQuizzes.map((q) => q.id);
    const passed = await prisma.quizAttempt.findMany({ where: { userId, passed: true, quizId: { in: quizIds } }, select: { quizId: true }, distinct: ['quizId'] });
    const passedSet = new Set(passed.map((p) => p.quizId));
    quizzesPassed = quizIds.every((id) => passedSet.has(id));
  }

  // A course can only be COMPLETED (and a certificate issued) while it is PUBLISHED —
  // never for a draft/archived course, even if all lessons/quizzes are satisfied.
  const completed = course?.status === 'PUBLISHED' && contentComplete && quizzesPassed;
  const status: 'IN_PROGRESS' | 'COMPLETED' = completed ? 'COMPLETED' : 'IN_PROGRESS';

  await prisma.enrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    update: { progressPercent: lessonPercent, status, lastAccessedAt: new Date(), ...(completed ? { completedAt: new Date() } : {}) },
    create: { userId, courseId, progressPercent: lessonPercent, status, startedAt: new Date(), lastAccessedAt: new Date(), ...(completed ? { completedAt: new Date() } : {}) },
  });

  if (completed) await issueCertificate(userId, courseId);
  return { percent: lessonPercent, status, contentComplete, quizzesPassed };
}
