import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });

export const createModuleSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Key must be UPPER_SNAKE_CASE'),
  name: z.string().min(2).max(120),
  description: z.string().max(300).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  path: z.string().max(120).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
  isExternal: z.boolean().optional(),
  externalUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
});

export const updateModuleSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(300).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  path: z.string().max(120).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
  isExternal: z.boolean().optional(),
  externalUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
});
