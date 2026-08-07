import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });

export const createRoleSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Key must be UPPER_SNAKE_CASE'),
  name: z.string().min(2).max(120),
  description: z.string().max(300).nullable().optional(),
  isSuperAdmin: z.boolean().optional(),
  permissionIds: z.array(z.string().uuid()).optional(),
});

// key + isSuperAdmin are immutable after creation (they are privilege-defining).
export const updateRoleSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(300).nullable().optional(),
});

export const setRolePermissionsSchema = z.object({ permissionIds: z.array(z.string().uuid()) });
