import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });
export const userIdParam = z.object({ userId: z.string().uuid() });

const scoreSchema = z.object({ competencyId: z.string().uuid(), rating: z.coerce.number().int().min(1).max(5) });

export const submitFeedbackSchema = z.object({
  recipientId: z.string().uuid(),
  isAnonymous: z.boolean().optional(),
  comment: z.string().max(2000).nullable().optional(),
  scores: z.array(scoreSchema).min(1, 'Rate at least one competency'),
});

export const updateFeedbackSchema = z.object({
  comment: z.string().max(2000).nullable().optional(),
  scores: z.array(scoreSchema).min(1).optional(),
});

export const listManageQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  recipientId: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  search: z.string().trim().optional(),
});

export const createCompetencySchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});
export const updateCompetencySchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;
export type UpdateFeedbackInput = z.infer<typeof updateFeedbackSchema>;
