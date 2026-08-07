import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { ApiError } from '../../../utils/apiError';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination';
import { recomputeCourseCompletion } from '../lms.completion';
import type { Viewer } from '../courses/courses.service';
import type { CreateQuestionInput, CreateQuizInput, SubmitAttemptInput, UpdateQuestionInput } from './quizzes.validation';

// ---------------------------------------------------------------------------
// Grading — pure, server-authoritative. Never trusts a client-provided score.
// Set-equality per question for every type (all-or-nothing, no partial credit).
// ---------------------------------------------------------------------------
function setEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

interface GradableQuestion { id: string; points: number; options: { id: string; isCorrect: boolean }[] }

export function gradeQuiz(questions: GradableQuestion[], submitted: Map<string, string[]>) {
  const perQuestion = [];
  let totalPoints = 0;
  let earned = 0;
  let correctCount = 0;
  for (const q of questions) {
    const correctOptionIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
    const submittedIds = [...new Set(submitted.get(q.id) ?? [])];
    const isCorrect = setEquals(correctOptionIds, submittedIds);
    const pointsAwarded = isCorrect ? q.points : 0;
    totalPoints += q.points;
    earned += pointsAwarded;
    if (isCorrect) correctCount += 1;
    perQuestion.push({ questionId: q.id, isCorrect, pointsAwarded, correctOptionIds, submittedIds });
  }
  const score = totalPoints > 0 ? Math.round((earned / totalPoints) * 100) : 0;
  return { perQuestion, totalPoints, earned, score, correctCount };
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i]!, arr[j]!] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function summarize(finished: { id: string; score: number; passed: boolean }[], maxAttempts: number | null) {
  const best = finished[0] ?? null; // callers order best-score-first
  return {
    attemptsUsed: finished.length,
    attemptsLeft: maxAttempts == null ? null : Math.max(0, maxAttempts - finished.length),
    bestScore: best ? best.score : null,
    passed: best ? best.passed : false,
    bestAttemptId: best ? best.id : null,
  };
}

const attemptFullInclude = {
  answers: true,
  quiz: {
    select: {
      id: true,
      title: true,
      passPercentage: true,
      showAnswers: true,
      courseId: true,
      course: { select: { slug: true, title: true } },
      questions: { orderBy: { orderIndex: 'asc' as const }, include: { options: { orderBy: { orderIndex: 'asc' as const } } } },
    },
  },
} satisfies Prisma.QuizAttemptInclude;

export const quizzesService = {
  // ── Learner ────────────────────────────────────────────────────────────────
  async list(userId: string, params: { courseId?: string; search?: string; page?: number; limit?: number }) {
    const { page, limit, skip } = parsePagination(params, 20, 50);
    const and: Prisma.QuizWhereInput[] = [
      // A quiz is only catalog-visible if it's standalone or its course is PUBLISHED.
      { OR: [{ courseId: null }, { course: { status: 'PUBLISHED' } }] },
    ];
    if (params.courseId) and.push({ courseId: params.courseId });
    if (params.search) and.push({ OR: [{ title: { contains: params.search, mode: 'insensitive' } }, { description: { contains: params.search, mode: 'insensitive' } }] });
    const where: Prisma.QuizWhereInput = { isPublished: true, AND: and };
    const [rows, total] = await Promise.all([
      prisma.quiz.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, description: true, passPercentage: true, durationMinutes: true, maxAttempts: true, showAnswers: true, course: { select: { id: true, title: true, slug: true } }, _count: { select: { questions: true } } },
      }),
      prisma.quiz.count({ where }),
    ]);
    const attempts = rows.length
      ? await prisma.quizAttempt.findMany({ where: { userId, quizId: { in: rows.map((r) => r.id) }, status: { in: ['PASSED', 'FAILED'] } }, orderBy: { score: 'desc' }, select: { id: true, quizId: true, score: true, passed: true } })
      : [];
    const byQuiz = new Map<string, { id: string; score: number; passed: boolean }[]>();
    for (const a of attempts) byQuiz.set(a.quizId, [...(byQuiz.get(a.quizId) ?? []), a]);
    const data = rows.map((r) => ({ id: r.id, title: r.title, description: r.description, passPercentage: r.passPercentage, durationMinutes: r.durationMinutes, maxAttempts: r.maxAttempts, questionCount: r._count.questions, course: r.course, ...summarize(byQuiz.get(r.id) ?? [], r.maxAttempts) }));
    return { data, pagination: buildPaginationMeta(total, page, limit) };
  },

  async getInfo(id: string, viewer: Viewer) {
    const quiz = await prisma.quiz.findUnique({ where: { id }, select: { id: true, title: true, description: true, passPercentage: true, durationMinutes: true, maxAttempts: true, randomize: true, showAnswers: true, isPublished: true, course: { select: { id: true, title: true, slug: true, status: true } }, _count: { select: { questions: true } } } });
    if (!quiz || (!quiz.isPublished && !viewer.canManage)) throw ApiError.notFound('Quiz not found');
    if (quiz.course && quiz.course.status !== 'PUBLISHED' && !viewer.canManage) throw ApiError.notFound('Quiz not found');
    const [finished, inProgress] = await Promise.all([
      prisma.quizAttempt.findMany({ where: { quizId: id, userId: viewer.id, status: { in: ['PASSED', 'FAILED'] } }, orderBy: { score: 'desc' }, select: { id: true, score: true, passed: true } }),
      prisma.quizAttempt.findFirst({ where: { quizId: id, userId: viewer.id, status: 'IN_PROGRESS' }, select: { id: true } }),
    ]);
    return { id: quiz.id, title: quiz.title, description: quiz.description, passPercentage: quiz.passPercentage, durationMinutes: quiz.durationMinutes, maxAttempts: quiz.maxAttempts, showAnswers: quiz.showAnswers, questionCount: quiz._count.questions, course: quiz.course, ...summarize(finished, quiz.maxAttempts), inProgressAttemptId: inProgress?.id ?? null };
  },

  async startAttempt(id: string, viewer: Viewer) {
    const quiz = await prisma.quiz.findUnique({ where: { id }, include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } }, course: { select: { status: true } } } });
    if (!quiz || (!quiz.isPublished && !viewer.canManage)) throw ApiError.notFound('Quiz not found');
    if (quiz.course && quiz.course.status !== 'PUBLISHED' && !viewer.canManage) throw ApiError.notFound('Quiz not found');
    if (quiz.questions.length === 0) throw ApiError.badRequest('This quiz has no questions yet');

    let attempt = await prisma.quizAttempt.findFirst({ where: { quizId: id, userId: viewer.id, status: 'IN_PROGRESS' } });
    if (!attempt) {
      if (quiz.maxAttempts != null) {
        const used = await prisma.quizAttempt.count({ where: { quizId: id, userId: viewer.id, status: { in: ['PASSED', 'FAILED'] } } });
        if (used >= quiz.maxAttempts) throw ApiError.forbidden('No attempts remaining');
      }
      attempt = await prisma.quizAttempt.create({ data: { quizId: id, userId: viewer.id } });
    }

    // Client-safe questions — option.isCorrect is NEVER included.
    let questions = quiz.questions.map((q) => ({ id: q.id, type: q.type, text: q.text, points: q.points, options: q.options.map((o) => ({ id: o.id, text: o.text })) }));
    if (quiz.randomize) questions = shuffle(questions).map((q) => ({ ...q, options: shuffle(q.options) }));

    return { attemptId: attempt.id, startedAt: attempt.startedAt, durationMinutes: quiz.durationMinutes, showAnswers: quiz.showAnswers, quiz: { id: quiz.id, title: quiz.title, passPercentage: quiz.passPercentage }, questions };
  },

  async submit(attemptId: string, viewer: Viewer, body: SubmitAttemptInput) {
    const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: attemptFullInclude });
    if (!attempt) throw ApiError.notFound('Attempt not found');
    if (attempt.userId !== viewer.id) throw ApiError.forbidden('This attempt does not belong to you');
    if (attempt.status !== 'IN_PROGRESS') throw ApiError.badRequest('This attempt has already been submitted');

    const submittedMap = new Map<string, string[]>();
    for (const a of body.answers) submittedMap.set(a.questionId, a.selectedOptionIds);

    const graded = gradeQuiz(attempt.quiz.questions.map((q) => ({ id: q.id, points: q.points, options: q.options.map((o) => ({ id: o.id, isCorrect: o.isCorrect })) })), submittedMap);
    const passed = graded.score >= attempt.quiz.passPercentage;
    const submittedAt = new Date();
    const durationSeconds = Math.floor((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000);

    await prisma.$transaction([
      prisma.quizAnswer.deleteMany({ where: { attemptId } }),
      prisma.quizAttempt.update({
        where: { id: attemptId },
        data: {
          status: passed ? 'PASSED' : 'FAILED',
          score: graded.score,
          passed,
          submittedAt,
          durationSeconds,
          answers: { create: graded.perQuestion.map((g) => ({ questionId: g.questionId, selectedOptionIds: g.submittedIds, isCorrect: g.isCorrect, pointsAwarded: g.pointsAwarded })) },
        },
      }),
    ]);

    // Side-effect on pass: re-check course completion (may issue a certificate).
    if (passed && attempt.quiz.courseId) {
      await recomputeCourseCompletion(viewer.id, attempt.quiz.courseId).catch(() => {});
    }
    return this.getResult(attemptId, viewer);
  },

  async getResult(attemptId: string, viewer: Viewer) {
    const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: attemptFullInclude });
    if (!attempt) throw ApiError.notFound('Attempt not found');
    if (attempt.userId !== viewer.id && !viewer.canManage) throw ApiError.forbidden('You may not view this attempt');
    // Never leak the answer key for an unsubmitted attempt.
    if (attempt.status === 'IN_PROGRESS') throw ApiError.badRequest('This attempt has not been submitted yet');

    const quiz = attempt.quiz;
    const answerByQ = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const certificate = quiz.courseId ? await prisma.certificate.findUnique({ where: { userId_courseId: { userId: attempt.userId, courseId: quiz.courseId } }, select: { certificateNo: true } }) : null;

    const review = quiz.showAnswers
        ? quiz.questions.map((q) => {
            const ans = answerByQ.get(q.id);
            return {
              questionId: q.id,
              text: q.text,
              type: q.type,
              explanation: q.explanation,
              points: q.points,
              pointsAwarded: ans?.pointsAwarded ?? 0,
              isCorrect: ans?.isCorrect ?? false,
              yourOptionIds: ans?.selectedOptionIds ?? [],
              correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
              options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
            };
          })
        : null;

    return {
      attempt: { id: attempt.id, status: attempt.status, score: attempt.score, passed: attempt.passed, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, durationSeconds: attempt.durationSeconds },
      quiz: { id: quiz.id, title: quiz.title, passPercentage: quiz.passPercentage, showAnswers: quiz.showAnswers, courseId: quiz.courseId, courseSlug: quiz.course?.slug ?? null, courseTitle: quiz.course?.title ?? null },
      totalQuestions: quiz.questions.length,
      correctCount: attempt.answers.filter((a) => a.isCorrect).length,
      certificate,
      review,
    };
  },

  // ── Authoring ────────────────────────────────────────────────────────────────
  async listManage() {
    const rows = await prisma.quiz.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, title: true, isPublished: true, passPercentage: true, maxAttempts: true, course: { select: { id: true, title: true } }, _count: { select: { questions: true, attempts: true } } } });
    return rows.map((r) => ({ ...r, questionCount: r._count.questions, attemptCount: r._count.attempts, _count: undefined }));
  },

  async createQuiz(input: CreateQuizInput, userId: string) {
    if (input.courseId) {
      const c = await prisma.course.findUnique({ where: { id: input.courseId }, select: { id: true } });
      if (!c) throw ApiError.badRequest('Course not found');
    }
    return prisma.quiz.create({
      data: {
        title: input.title,
        description: input.description || null,
        passPercentage: input.passPercentage ?? 70,
        durationMinutes: input.durationMinutes ?? null,
        randomize: input.randomize ?? false,
        maxAttempts: input.maxAttempts ?? null,
        showAnswers: input.showAnswers ?? true,
        isPublished: input.isPublished ?? false,
        ...(input.courseId ? { course: { connect: { id: input.courseId } } } : {}),
        createdBy: { connect: { id: userId } },
      },
    });
  },

  async getFull(id: string) {
    const quiz = await prisma.quiz.findUnique({ where: { id }, include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } }, course: { select: { id: true, title: true } } } });
    if (!quiz) throw ApiError.notFound('Quiz not found');
    return quiz;
  },

  async updateQuiz(id: string, input: Partial<CreateQuizInput>) {
    const quiz = await prisma.quiz.findUnique({ where: { id }, select: { id: true } });
    if (!quiz) throw ApiError.notFound('Quiz not found');
    return prisma.quiz.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.passPercentage !== undefined ? { passPercentage: input.passPercentage } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.randomize !== undefined ? { randomize: input.randomize } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.showAnswers !== undefined ? { showAnswers: input.showAnswers } : {}),
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
        ...(input.courseId !== undefined ? (input.courseId ? { course: { connect: { id: input.courseId } } } : { course: { disconnect: true } }) : {}),
      },
    });
  },

  async deleteQuiz(id: string) {
    const quiz = await prisma.quiz.findUnique({ where: { id }, select: { id: true } });
    if (!quiz) throw ApiError.notFound('Quiz not found');
    await prisma.quiz.delete({ where: { id } });
  },

  async addQuestion(quizId: string, input: CreateQuestionInput) {
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true } });
    if (!quiz) throw ApiError.notFound('Quiz not found');
    const max = await prisma.question.aggregate({ where: { quizId }, _max: { orderIndex: true } });
    return prisma.question.create({
      data: {
        quizId,
        type: input.type ?? 'MCQ',
        text: input.text,
        explanation: input.explanation || null,
        points: input.points ?? 1,
        orderIndex: (max._max.orderIndex ?? -1) + 1,
        options: { create: input.options.map((o, i) => ({ text: o.text, isCorrect: o.isCorrect, orderIndex: i })) },
      },
      include: { options: { orderBy: { orderIndex: 'asc' } } },
    });
  },

  async updateQuestion(questionId: string, input: UpdateQuestionInput) {
    const q = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true } });
    if (!q) throw ApiError.notFound('Question not found');
    await prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id: questionId },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.explanation !== undefined ? { explanation: input.explanation || null } : {}),
          ...(input.points !== undefined ? { points: input.points } : {}),
        },
      });
      if (input.options !== undefined) {
        await tx.questionOption.deleteMany({ where: { questionId } });
        await tx.questionOption.createMany({ data: input.options.map((o, i) => ({ questionId, text: o.text, isCorrect: o.isCorrect, orderIndex: i })) });
      }
    });
    return prisma.question.findUnique({ where: { id: questionId }, include: { options: { orderBy: { orderIndex: 'asc' } } } });
  },

  async deleteQuestion(questionId: string) {
    const q = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true } });
    if (!q) throw ApiError.notFound('Question not found');
    await prisma.question.delete({ where: { id: questionId } });
  },

  async reorderQuestions(quizId: string, questionIds: string[]) {
    await prisma.$transaction(questionIds.map((id, i) => prisma.question.update({ where: { id }, data: { orderIndex: i } })));
    return { reordered: questionIds.length };
  },
};
