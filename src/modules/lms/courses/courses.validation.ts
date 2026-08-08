import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });
export const slugParam = z.object({ slug: z.string().min(1) });
export const assignmentParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

export const listCoursesQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  featured: z.enum(['true', 'false']).optional(),
});

export const createCourseSchema = z.object({
  title: z.string().min(3).max(200),
  slug: z.string().max(80).optional(),
  description: z.string().nullable().optional(),
  summary: z.string().max(500).nullable().optional(),
  // Either an external image URL, or an uploaded-cover reference ("r2:<key>"), or empty.
  thumbnailUrl: z.string().max(2000).nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  isFeatured: z.boolean().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  instructorId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
});

export const updateCourseSchema = createCourseSchema.partial().omit({ slug: true });

export const assignCourseSchema = z
  .object({
    userIds: z.array(z.string().uuid()).optional(),
    departmentId: z.string().uuid().nullable().optional(),
    all: z.boolean().optional(), // assign to every active user with LMS access
    dueDate: z.string().datetime().nullable().optional(),
  })
  .refine((d) => (d.userIds && d.userIds.length > 0) || d.departmentId || d.all, {
    message: 'Provide userIds, a departmentId, or all',
  });

// Edit one assignee's enrollment — the due date (null clears it).
export const updateAssignmentSchema = z.object({
  dueDate: z.string().datetime().nullable().optional(),
});

export type ListCoursesQuery = z.infer<typeof listCoursesQuery>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
