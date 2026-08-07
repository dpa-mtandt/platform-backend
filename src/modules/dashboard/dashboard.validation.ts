import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });

export const createDashboardSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  secureEmbedUrl: z.string().max(4000).nullable().optional(),
  workspaceId: z.string().max(120).nullable().optional(),
  reportId: z.string().max(120).nullable().optional(),
  embedUrl: z.string().max(4000).nullable().optional(),
  isActive: z.boolean().optional(),
  allowExport: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export const updateDashboardSchema = createDashboardSchema.partial();

export const setAccessSchema = z.object({ userIds: z.array(z.string().uuid()) });
