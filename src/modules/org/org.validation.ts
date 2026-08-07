import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });

export const createDepartmentSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(40).nullable().optional(),
  description: z.string().max(300).nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
});
export const updateDepartmentSchema = createDepartmentSchema.partial();

export const createCompanySchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(40).nullable().optional(),
  description: z.string().max(300).nullable().optional(),
});
export const updateCompanySchema = createCompanySchema.partial();
