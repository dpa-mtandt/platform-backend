import { randomBytes } from 'node:crypto';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';

const CERT_PREFIX = 'MTANDT-CERT';

/** Idempotently issue a completion certificate (+ notification) for a course. */
export async function issueCertificate(userId: string, courseId: string) {
  const existing = await prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { certificateNo: true } });
  if (existing) return existing;
  const year = new Date().getFullYear();
  const certificateNo = `${CERT_PREFIX}-${year}-${randomBytes(3).toString('hex')}`;
  try {
    const cert = await prisma.certificate.create({ data: { certificateNo, userId, courseId }, select: { certificateNo: true } });
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
    await prisma.notification.create({
      data: { userId, type: 'CERTIFICATE', title: 'Certificate earned', message: `You completed "${course?.title ?? 'a course'}" and earned a certificate.`, link: `/lms/certificates/${cert.certificateNo}` },
    });
    return cert;
  } catch (err) {
    // Unique race — a certificate was created concurrently. Fetch and return it.
    logger.warn(`Certificate create race for user ${userId} course ${courseId}`, err);
    return prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { certificateNo: true } });
  }
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
