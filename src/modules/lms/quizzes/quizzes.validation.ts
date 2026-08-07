import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });
export const attemptParam = z.object({ attemptId: z.string().uuid() });
export const questionParam = z.object({ questionId: z.string().uuid() });

export const listQuizzesQuery = z.object({
  courseId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const submitAttemptSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      selectedOptionIds: z.array(z.string().uuid()),
    }),
  ),
});

// ── Authoring ────────────────────────────────────────────────────────────────
export const createQuizSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(1000).nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  passPercentage: z.coerce.number().int().min(0).max(100).optional(),
  durationMinutes: z.coerce.number().int().min(1).nullable().optional(),
  randomize: z.boolean().optional(),
  maxAttempts: z.coerce.number().int().min(1).nullable().optional(),
  showAnswers: z.boolean().optional(),
  isPublished: z.boolean().optional(),
});
export const updateQuizSchema = createQuizSchema.partial();

const optionSchema = z.object({ text: z.string().min(1).max(500), isCorrect: z.boolean().default(false) });

export const createQuestionSchema = z.object({
  type: z.enum(['MCQ', 'TRUE_FALSE', 'MULTIPLE_SELECT', 'SCENARIO']).optional(),
  text: z.string().min(1),
  explanation: z.string().max(1000).nullable().optional(),
  points: z.coerce.number().int().min(1).optional(),
  options: z
    .array(optionSchema)
    .min(2, 'A question needs at least 2 options')
    .refine((opts) => opts.some((o) => o.isCorrect), { message: 'At least one option must be correct' }),
});

export const updateQuestionSchema = z.object({
  type: z.enum(['MCQ', 'TRUE_FALSE', 'MULTIPLE_SELECT', 'SCENARIO']).optional(),
  text: z.string().min(1).optional(),
  explanation: z.string().max(1000).nullable().optional(),
  points: z.coerce.number().int().min(1).optional(),
  options: z
    .array(optionSchema)
    .min(2, 'A question needs at least 2 options')
    .refine((opts) => opts.some((o) => o.isCorrect), { message: 'At least one option must be correct' })
    .optional(),
});

export const reorderQuestionsSchema = z.object({ questionIds: z.array(z.string().uuid()).min(1) });

export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;
export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
