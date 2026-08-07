import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/apiError';
import { slugify } from '../../utils/slug';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination';
import type { SubmitFeedbackInput, UpdateFeedbackInput } from './feedback.validation';

/** Individual comments/scores only surface once a person has this many responses. */
const MIN_N = 3;

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (nums: number[]) => (nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : 0);
const currentMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

export const feedbackService = {
  // ── Competencies ───────────────────────────────────────────────────────────
  async listCompetencies(activeOnly = true) {
    return prisma.competency.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, key: true, name: true, description: true, sortOrder: true, isActive: true },
    });
  },

  async createCompetency(input: { name: string; description?: string | null; sortOrder?: number }) {
    let key = slugify(input.name);
    if (await prisma.competency.findUnique({ where: { key }, select: { id: true } })) key = `${key}-${Date.now().toString(36).slice(-4)}`;
    return prisma.competency.create({ data: { key, name: input.name, description: input.description || null, sortOrder: input.sortOrder ?? 0 } });
  },

  async updateCompetency(id: string, input: { name?: string; description?: string | null; sortOrder?: number; isActive?: boolean }) {
    const c = await prisma.competency.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw ApiError.notFound('Competency not found');
    return prisma.competency.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  },

  async removeCompetency(id: string) {
    const c = await prisma.competency.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw ApiError.notFound('Competency not found');
    await prisma.competency.delete({ where: { id } });
  },

  // ── Recipients (who you can rate) ────────────────────────────────────────────
  async listRecipients(giverId: string) {
    return prisma.user.findMany({
      where: { status: 'ACTIVE', id: { not: giverId } },
      orderBy: { name: 'asc' },
      take: 1000,
      select: { id: true, name: true, email: true, designation: true, department: { select: { name: true } } },
    });
  },

  // ── Submit + own history ─────────────────────────────────────────────────────
  async submit(giverId: string, input: SubmitFeedbackInput) {
    if (input.recipientId === giverId) throw ApiError.badRequest('You cannot submit feedback about yourself');
    const recipient = await prisma.user.findUnique({ where: { id: input.recipientId }, select: { id: true, status: true } });
    if (!recipient || recipient.status !== 'ACTIVE') throw ApiError.badRequest('Recipient not found');

    const compIds = input.scores.map((s) => s.competencyId);
    if (new Set(compIds).size !== compIds.length) throw ApiError.badRequest('Duplicate competency in scores');
    const activeComps = await prisma.competency.count({ where: { id: { in: compIds }, isActive: true } });
    if (activeComps !== compIds.length) throw ApiError.badRequest('One or more competencies are invalid or inactive');

    const periodMonth = currentMonth();
    const existing = await prisma.feedback.findUnique({
      where: { giverId_recipientId_periodMonth: { giverId, recipientId: input.recipientId, periodMonth } },
      select: { id: true },
    });
    if (existing) throw ApiError.conflict('You have already submitted feedback for this person this month');

    const fb = await prisma.feedback.create({
      data: {
        giverId,
        recipientId: input.recipientId,
        isAnonymous: input.isAnonymous ?? false,
        comment: input.comment || null,
        periodMonth,
        scores: { create: input.scores.map((s) => ({ competencyId: s.competencyId, rating: s.rating })) },
      },
      select: { id: true, periodMonth: true },
    });
    return fb;
  },

  /** The current user's own submissions (they always see their own). */
  async myGiven(giverId: string) {
    const rows = await prisma.feedback.findMany({
      where: { giverId },
      orderBy: { createdAt: 'desc' },
      include: { recipient: { select: { id: true, name: true, designation: true } }, scores: { select: { rating: true } } },
    });
    return rows.map((f) => ({
      id: f.id,
      recipient: f.recipient,
      isAnonymous: f.isAnonymous,
      comment: f.comment,
      periodMonth: f.periodMonth,
      createdAt: f.createdAt,
      average: avg(f.scores.map((s) => s.rating)),
    }));
  },

  // ── Reports (analytics; giver identity never exposed) ────────────────────────
  async reports() {
    const comps = await this.listCompetencies(true);
    const feedbacks = await prisma.feedback.findMany({
      select: {
        recipientId: true,
        recipient: { select: { id: true, name: true, designation: true, department: { select: { name: true } } } },
        scores: { select: { competencyId: true, rating: true } },
      },
    });

    const map = new Map<string, { recipient: (typeof feedbacks)[number]['recipient']; count: number; sum: number; n: number; perComp: Map<string, { sum: number; n: number }> }>();
    for (const f of feedbacks) {
      let e = map.get(f.recipientId);
      if (!e) {
        e = { recipient: f.recipient, count: 0, sum: 0, n: 0, perComp: new Map() };
        map.set(f.recipientId, e);
      }
      e.count += 1;
      for (const s of f.scores) {
        e.sum += s.rating;
        e.n += 1;
        const pc = e.perComp.get(s.competencyId) ?? { sum: 0, n: 0 };
        pc.sum += s.rating;
        pc.n += 1;
        e.perComp.set(s.competencyId, pc);
      }
    }

    const data = [...map.values()]
      .map((e) => {
        // Below the min-N threshold, suppress the scores too (a lone respondent's
        // "average" is their exact ratings) — not just the comments.
        const below = e.count < MIN_N;
        return {
          recipient: e.recipient,
          responses: e.count,
          overall: below ? null : e.n ? round1(e.sum / e.n) : 0,
          belowThreshold: below,
          competencies: comps.map((c) => {
            const pc = e.perComp.get(c.id);
            return { id: c.id, name: c.name, average: below ? null : pc && pc.n ? round1(pc.sum / pc.n) : null };
          }),
        };
      })
      .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

    return { minN: MIN_N, competencies: comps.map((c) => ({ id: c.id, name: c.name })), data };
  },

  async recipientReport(userId: string) {
    const recipient = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, designation: true, department: { select: { name: true } } } });
    if (!recipient) throw ApiError.notFound('User not found');
    const comps = await this.listCompetencies(true);
    const feedbacks = await prisma.feedback.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
      select: { comment: true, periodMonth: true, createdAt: true, scores: { select: { competencyId: true, rating: true } } },
    });
    const count = feedbacks.length;
    const allRatings = feedbacks.flatMap((f) => f.scores.map((s) => s.rating));

    const competencies = comps.map((c) => {
      const ratings = feedbacks.flatMap((f) => f.scores.filter((s) => s.competencyId === c.id).map((s) => s.rating));
      return { id: c.id, name: c.name, average: ratings.length ? avg(ratings) : null, responses: ratings.length };
    });

    // Monthly trend (avg per month)
    const byMonth = new Map<string, number[]>();
    for (const f of feedbacks) {
      const r = f.scores.map((s) => s.rating);
      byMonth.set(f.periodMonth, [...(byMonth.get(f.periodMonth) ?? []), ...r]);
    }
    const trend = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, ratings]) => ({ month, average: avg(ratings) }));

    // Individual comments only once ≥ MIN_N responses — and NEVER attributed to a giver.
    const belowThreshold = count < MIN_N;
    const comments = belowThreshold ? [] : feedbacks.filter((f) => f.comment).map((f) => ({ comment: f.comment, month: f.periodMonth }));

    return {
      recipient,
      responses: count,
      overall: belowThreshold ? null : avg(allRatings),
      belowThreshold,
      thresholdMessage: belowThreshold ? `Individual scores and comments appear once there are at least ${MIN_N} responses.` : null,
      competencies: belowThreshold ? competencies.map((c) => ({ ...c, average: null })) : competencies,
      trend: belowThreshold ? [] : trend,
      comments,
    };
  },

  // ── Management (moderation; anonymous givers stay hidden even here) ───────────
  async manageList(query: { page?: number; limit?: number; recipientId?: string; month?: string; search?: string }) {
    const { page, limit, skip } = parsePagination(query, 20, 100);
    const and: Prisma.FeedbackWhereInput[] = [];
    if (query.recipientId) and.push({ recipientId: query.recipientId });
    if (query.month) and.push({ periodMonth: query.month });
    if (query.search) {
      const s = query.search;
      and.push({ OR: [{ comment: { contains: s, mode: 'insensitive' } }, { recipient: { name: { contains: s, mode: 'insensitive' } } }] });
    }
    const where: Prisma.FeedbackWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { recipient: { select: { id: true, name: true } }, giver: { select: { id: true, name: true } }, scores: { select: { rating: true } } },
      }),
      prisma.feedback.count({ where }),
    ]);
    const data = rows.map((f) => ({
      id: f.id,
      recipient: f.recipient,
      giver: f.isAnonymous ? null : f.giver, // anonymity preserved even for managers
      isAnonymous: f.isAnonymous,
      periodMonth: f.periodMonth,
      comment: f.comment,
      average: avg(f.scores.map((s) => s.rating)),
      createdAt: f.createdAt,
    }));
    return { data, pagination: buildPaginationMeta(total, page, limit) };
  },

  async manageGet(id: string) {
    const f = await prisma.feedback.findUnique({
      where: { id },
      include: {
        recipient: { select: { id: true, name: true } },
        giver: { select: { id: true, name: true } },
        scores: { include: { competency: { select: { id: true, name: true } } } },
      },
    });
    if (!f) throw ApiError.notFound('Feedback not found');
    return {
      id: f.id,
      recipient: f.recipient,
      giver: f.isAnonymous ? null : f.giver,
      isAnonymous: f.isAnonymous,
      periodMonth: f.periodMonth,
      comment: f.comment,
      createdAt: f.createdAt,
      scores: f.scores.map((s) => ({ competencyId: s.competencyId, competency: s.competency.name, rating: s.rating })),
    };
  },

  async manageUpdate(id: string, input: UpdateFeedbackInput) {
    const f = await prisma.feedback.findUnique({ where: { id }, select: { id: true } });
    if (!f) throw ApiError.notFound('Feedback not found');
    await prisma.$transaction(async (tx) => {
      await tx.feedback.update({ where: { id }, data: { ...(input.comment !== undefined ? { comment: input.comment || null } : {}) } });
      if (input.scores) {
        for (const s of input.scores) {
          await tx.feedbackScore.updateMany({ where: { feedbackId: id, competencyId: s.competencyId }, data: { rating: s.rating } });
        }
      }
    });
    return this.manageGet(id);
  },

  async manageDelete(id: string) {
    const f = await prisma.feedback.findUnique({ where: { id }, select: { id: true } });
    if (!f) throw ApiError.notFound('Feedback not found');
    await prisma.feedback.delete({ where: { id } });
  },
};
