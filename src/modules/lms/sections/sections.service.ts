import { prisma } from '../../../config/prisma';
import { ApiError } from '../../../utils/apiError';
import { safeUnlink } from '../media/media.stream';

export const sectionsService = {
  async create(input: { courseId: string; title: string; description?: string | null; orderIndex?: number }) {
    const course = await prisma.course.findUnique({ where: { id: input.courseId }, select: { id: true } });
    if (!course) throw ApiError.notFound('Course not found');
    let orderIndex = input.orderIndex;
    if (orderIndex === undefined) {
      const max = await prisma.section.aggregate({ where: { courseId: input.courseId }, _max: { orderIndex: true } });
      orderIndex = (max._max.orderIndex ?? -1) + 1;
    }
    return prisma.section.create({
      data: { courseId: input.courseId, title: input.title, description: input.description || null, orderIndex },
    });
  },

  async update(id: string, input: { title?: string; description?: string | null; orderIndex?: number }) {
    const s = await prisma.section.findUnique({ where: { id }, select: { id: true } });
    if (!s) throw ApiError.notFound('Section not found');
    return prisma.section.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
      },
    });
  },

  async remove(id: string) {
    const s = await prisma.section.findUnique({
      where: { id },
      select: { id: true, lessons: { select: { video: { select: { fileKey: true } }, documents: { select: { fileKey: true } } } } },
    });
    if (!s) throw ApiError.notFound('Section not found');
    await prisma.section.delete({ where: { id } });
    // Cascade removes the rows; clean up uploaded files on disk too.
    for (const l of s.lessons) {
      safeUnlink(l.video?.fileKey);
      l.documents.forEach((d) => safeUnlink(d.fileKey));
    }
  },

  async reorder(sectionIds: string[]) {
    await prisma.$transaction(sectionIds.map((id, i) => prisma.section.update({ where: { id }, data: { orderIndex: i } })));
    return { reordered: sectionIds.length };
  },
};
