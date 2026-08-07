import { z } from 'zod';

const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[0-9]/, 'Must contain a number');

const nullableUuid = z.string().uuid().nullable().optional();

export const idParam = z.object({ id: z.string().uuid() });

export const listUsersQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  role: z.string().optional(), // role key
  module: z.string().optional(), // module key — users with access to it
  departmentId: z.string().uuid().optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: strongPassword,
  employeeId: z.string().trim().max(60).nullable().optional(),
  designation: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  departmentId: nullableUuid,
  companyId: nullableUuid,
  managerId: nullableUuid,
  roleIds: z.array(z.string().uuid()).optional(),
});

// Update: email + password are managed separately (email is immutable; password
// via the reset endpoint). roleIds, when present, replaces the user's roles.
export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  employeeId: z.string().trim().max(60).nullable().optional(),
  designation: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  departmentId: nullableUuid,
  companyId: nullableUuid,
  managerId: nullableUuid,
  roleIds: z.array(z.string().uuid()).optional(),
});

export const resetPasswordSchema = z.object({ newPassword: strongPassword });

export const setRolesSchema = z.object({ roleIds: z.array(z.string().uuid()) });

export const setPermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      permissionId: z.string().uuid(),
      effect: z.enum(['ALLOW', 'DENY']).default('ALLOW'),
    }),
  ),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
