import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });

// A video is sourced by EITHER a remote `url` (e.g. a SharePoint share link) OR an
// uploaded `fileKey`. `isProtected` streams it view-only through the media proxy.
const videoSchema = z
  .object({
    title: z.string().max(200).optional(),
    url: z.string().max(2000).optional(),
    fileKey: z.string().max(200).nullable().optional(),
    isProtected: z.boolean().optional(),
    mimeType: z.string().max(200).nullable().optional(),
    duration: z.coerce.number().int().min(0).optional(),
    sizeBytes: z.coerce.number().int().min(0).optional(),
    thumbnailUrl: z.string().nullable().optional(),
    provider: z.string().max(60).nullable().optional(),
  })
  .refine((v) => Boolean((v.url && v.url.trim()) || v.fileKey), { message: 'A video needs a URL or an uploaded file' });

export const createLessonSchema = z.object({
  sectionId: z.string().uuid(),
  title: z.string().min(1).max(200),
  type: z.enum(['RICH_TEXT', 'VIDEO', 'PDF', 'DOCUMENT', 'MIXED']).optional(),
  content: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  orderIndex: z.coerce.number().int().min(0).optional(),
  estimatedMinutes: z.coerce.number().int().min(0).optional(),
  isPreview: z.boolean().optional(),
  video: videoSchema.nullable().optional(),
});

export const updateLessonSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.enum(['RICH_TEXT', 'VIDEO', 'PDF', 'DOCUMENT', 'MIXED']).optional(),
  content: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  orderIndex: z.coerce.number().int().min(0).optional(),
  estimatedMinutes: z.coerce.number().int().min(0).optional(),
  isPreview: z.boolean().optional(),
  video: videoSchema.nullable().optional(),
});

export const reorderLessonsSchema = z.object({ sectionId: z.string().uuid(), lessonIds: z.array(z.string().uuid()).min(1) });

export const progressSchema = z.object({
  watchedSeconds: z.coerce.number().int().min(0).optional(),
  watchPercent: z.coerce.number().min(0).max(100).optional(),
  lastPositionSeconds: z.coerce.number().int().min(0).optional(),
  completed: z.boolean().optional(),
});

export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;
export type ProgressInput = z.infer<typeof progressSchema>;
