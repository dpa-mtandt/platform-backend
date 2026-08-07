import { prisma } from '../../../config/prisma';
import { ApiError } from '../../../utils/apiError';
import { slugify } from '../../../utils/slug';

export const categoriesService = {
  async list() {
    const rows = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, description: true, _count: { select: { courses: true } } },
    });
    return rows.map((c) => ({ ...c, courseCount: c._count.courses, _count: undefined }));
  },

  async create(input: { name: string; description?: string | null }) {
    return prisma.category.create({ data: { name: input.name, slug: slugify(input.name), description: input.description || null } });
  },

  async update(id: string, input: { name?: string; description?: string | null }) {
    const c = await prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw ApiError.notFound('Category not found');
    return prisma.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name, slug: slugify(input.name) } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      },
    });
  },

  async remove(id: string) {
    const c = await prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw ApiError.notFound('Category not found');
    await prisma.category.delete({ where: { id } }); // Course.categoryId → SetNull
  },
};
