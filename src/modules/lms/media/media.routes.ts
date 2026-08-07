import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { prisma } from '../../../config/prisma';
import { authenticate } from '../../../middleware/authenticate';
import { requireModule, requirePermission } from '../../../middleware/authorize';
import { validate } from '../../../middleware/validate';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok, created } from '../../../utils/apiResponse';
import { ApiError } from '../../../utils/apiError';
import { verifyMediaToken } from '../../../utils/jwt';
import { config } from '../../../config/env';
import {
  safeUnlink,
  streamRemoteUrl,
  streamProtectedUpload,
  contentTypeFor,
  probeContentType,
  toDirectDownloadUrl,
  isMicrosoftShareUrl,
  uploadRequestToR2,
} from './media.stream';
import { serializeDocumentRequest, isVideoDocument } from './media.serialize';

const router = Router();

/** An approved download is valid for this long. */
const APPROVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const canManage = requirePermission('lms.course.manage');
const canView = requirePermission('lms.course.view');
const canApprove = requirePermission('lms.download.approve');

const ALLOWED_UPLOAD_EXT = new Set([
  '.mp4', '.webm', '.ogg', '.mov', '.m4v', '.mkv',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt',
  '.png', '.jpg', '.jpeg',
]);

function readMediaToken(raw: unknown, kind: 'video' | 'doc', id: string): void {
  const token = typeof raw === 'string' ? raw : '';
  if (!token) throw ApiError.unauthorized('Missing media token');
  let payload;
  try {
    payload = verifyMediaToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired media token');
  }
  if (payload.kind !== kind || payload.k !== id) throw ApiError.forbidden('This token does not grant access to this resource');
}

const docWithCourse = {
  lesson: { include: { section: { include: { course: { select: { id: true, slug: true, title: true, status: true } } } } } },
} as const;

type DocWithCourse = Awaited<ReturnType<typeof loadDocument>>;

async function loadDocument(id: string) {
  const doc = await prisma.lessonDocument.findUnique({ where: { id }, include: docWithCourse });
  if (!doc) throw ApiError.notFound('Document not found');
  return doc;
}

function assertCanView(doc: NonNullable<DocWithCourse>, user: Express.Request['user']): void {
  const published = doc.lesson.section.course.status === 'PUBLISHED';
  const manage = !!user && (user.isSuperAdmin || user.permissions.has('lms.course.manage'));
  if (!published && !manage) throw ApiError.notFound('Document not found');
}

function findApprovers(excludeUserId: string) {
  return prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      id: { not: excludeUserId },
      OR: [
        { userRoles: { some: { role: { OR: [{ isSuperAdmin: true }, { rolePermissions: { some: { permission: { key: 'lms.download.approve' } } } }] } } } },
        { userPermissions: { some: { effect: 'ALLOW', permission: { key: 'lms.download.approve' } } } },
      ],
    },
    select: { id: true },
  });
}

router.get(
  '/video/:id',
  asyncHandler(async (req, res) => {
    readMediaToken(req.query.token, 'video', req.params.id);
    const video = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!video) throw ApiError.notFound('Video not found');
    const contentType = video.mimeType || undefined;
    if (video.fileKey) return streamProtectedUpload(req, res, video.fileKey, { contentType: contentType || contentTypeFor(video.fileKey) });
    if (video.url) return streamRemoteUrl(req, res, video.url, { contentType });
    throw ApiError.notFound('Video has no source');
  }),
);

router.get(
  '/doc/:id',
  asyncHandler(async (req, res) => {
    readMediaToken(req.query.token, 'doc', req.params.id);
    const doc = await prisma.lessonDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) throw ApiError.notFound('Document not found');
    const contentType = doc.mimeType || contentTypeFor(doc.fileKey || doc.originalName);

    if (doc.url && isMicrosoftShareUrl(doc.url)) {
      throw ApiError.badRequest(
        'This document is hosted on SharePoint/OneDrive and cannot be streamed in-app. Use “Open in new tab” instead.',
      );
    }

    if (doc.fileKey) return streamProtectedUpload(req, res, doc.fileKey, { contentType });
    if (doc.url) return streamRemoteUrl(req, res, doc.url, { contentType });
    throw ApiError.notFound('Document has no source');
  }),
);

router.get(
  '/doc/:id/download',
  authenticate,
  requireModule('LMS'),
  canView,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const doc = await loadDocument(req.params.id);
    assertCanView(doc, user);

    if (isVideoDocument(doc.mimeType, doc.originalName)) throw ApiError.forbidden('Videos are view-only and cannot be downloaded');

    const privileged = user.isSuperAdmin || user.permissions.has('lms.download.approve') || user.permissions.has('lms.course.manage');
    if (!privileged) {
      const grant = await prisma.downloadRequest.findFirst({
        where: { documentId: doc.id, userId: user.id, status: 'APPROVED', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { id: true },
      });
      if (!grant) throw ApiError.forbidden('Download has not been approved for this document');
    }

    req.audit?.({ action: 'DOCUMENT_DOWNLOAD', module: 'lms', entityType: 'LessonDocument', entityId: doc.id, description: `Downloaded document "${doc.title}"` });
    if (doc.fileKey) {
      const contentType = doc.mimeType || contentTypeFor(doc.fileKey || doc.originalName);
      return streamProtectedUpload(req, res, doc.fileKey, { contentType, downloadName: doc.originalName });
    }
    if (doc.url) return ok(res, { url: toDirectDownloadUrl(doc.url) }, 'Download link ready');
    throw ApiError.notFound('Document has no source');
  }),
);

const reasonSchema = z.object({ reason: z.string().max(1000).nullable().optional() });

router.post(
  '/doc/:id/requests',
  authenticate,
  requireModule('LMS'),
  canView,
  validate({ body: reasonSchema }),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const doc = await loadDocument(req.params.id);
    assertCanView(doc, user);
    if (isVideoDocument(doc.mimeType, doc.originalName)) throw ApiError.forbidden('Videos are view-only and cannot be downloaded');

    const existing = await prisma.downloadRequest.findFirst({ where: { documentId: doc.id, userId: user.id, status: 'PENDING' } });
    if (existing) return ok(res, serializeDocumentRequest(existing), 'A request is already pending');

    const request = await prisma.downloadRequest.create({ data: { userId: user.id, documentId: doc.id, reason: req.body.reason ?? null } });

    const approvers = await findApprovers(user.id);
    if (approvers.length) {
      await prisma.notification.createMany({
        data: approvers.map((a) => ({
          userId: a.id,
          type: 'SYSTEM' as const,
          title: 'Document download request',
          message: `${user.name} requested to download "${doc.title}" (${doc.lesson.section.course.title}).`,
          link: '/lms/manage/download-requests',
        })),
      });
    }
    return created(res, serializeDocumentRequest(request), 'Request submitted for approval');
  }),
);

router.get(
  '/requests/mine',
  authenticate,
  requireModule('LMS'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.downloadRequest.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
    return ok(res, rows.map((r) => serializeDocumentRequest(r)));
  }),
);

const statusQuery = z.object({ status: z.enum(['PENDING', 'APPROVED', 'DENIED']).optional() });

router.get(
  '/requests',
  authenticate,
  requireModule('LMS'),
  canApprove,
  validate({ query: statusQuery }),
  asyncHandler(async (req, res) => {
    const status = (req.query as z.infer<typeof statusQuery>).status;
    const rows = await prisma.downloadRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        user: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
        document: { include: docWithCourse },
      },
    });
    const pendingCount = await prisma.downloadRequest.count({ where: { status: 'PENDING' } });
    const data = rows.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      expiresAt: r.expiresAt,
      requester: r.user,
      reviewedBy: r.reviewedBy,
      document: {
        id: r.document.id,
        title: r.document.title,
        originalName: r.document.originalName,
        sizeBytes: Number(r.document.sizeBytes),
        lessonTitle: r.document.lesson.title,
        courseTitle: r.document.lesson.section.course.title,
        courseSlug: r.document.lesson.section.course.slug,
      },
    }));
    return ok(res, { data, pendingCount });
  }),
);

const decideSchema = z.object({ status: z.enum(['APPROVED', 'DENIED']), decisionNote: z.string().max(1000).nullable().optional() });

router.patch(
  '/requests/:id',
  authenticate,
  requireModule('LMS'),
  canApprove,
  validate({ body: decideSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decideSchema>;
    const request = await prisma.downloadRequest.findUnique({ where: { id: req.params.id }, include: { document: { include: docWithCourse } } });
    if (!request) throw ApiError.notFound('Request not found');

    const now = new Date();
    const approved = body.status === 'APPROVED';
    const updated = await prisma.downloadRequest.update({
      where: { id: request.id },
      data: {
        status: body.status,
        decisionNote: body.decisionNote ?? null,
        reviewedById: req.user!.id,
        reviewedAt: now,
        expiresAt: approved ? new Date(now.getTime() + APPROVAL_WINDOW_MS) : null,
      },
    });

    const course = request.document.lesson.section.course;
    await prisma.notification.create({
      data: {
        userId: request.userId,
        type: 'SYSTEM',
        title: approved ? 'Download approved' : 'Download request denied',
        message: approved
          ? `Your request to download "${request.document.title}" was approved. You can download it for the next 7 days.`
          : `Your request to download "${request.document.title}" was not approved.`,
        link: `/lms/learn/${course.slug}?lesson=${request.document.lessonId}`,
      },
    });
    return ok(res, serializeDocumentRequest(updated), approved ? 'Request approved' : 'Request denied');
  }),
);

/**
 * Upload binary body → Cloudflare R2 when configured, else local disk (+ small files to DB).
 */
router.post(
  '/upload',
  authenticate,
  requireModule('LMS'),
  canManage,
  asyncHandler(async (req, res) => {
    const rawName = String(req.header('x-file-name') || 'upload');
    let originalName = 'upload';
    try {
      originalName = decodeURIComponent(rawName).slice(0, 200);
    } catch {
      originalName = rawName.slice(0, 200);
    }
    const mimeType = (req.header('content-type') || 'application/octet-stream').split(';')[0]!.trim();
    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
      throw ApiError.badRequest(`Unsupported file type "${ext || '(none)'}". Allowed: videos, PDF, Office docs, images.`);
    }
    const fileKey = `${randomUUID()}${ext}`;
    const maxBytes = config.media.maxUploadMb * 1024 * 1024;
    // All uploads stream straight to Cloudflare R2 (throws if R2 isn't configured).
    const size = await uploadRequestToR2(req, fileKey, mimeType, maxBytes);
    return created(res, { fileKey, originalName, mimeType, sizeBytes: size }, 'Uploaded');
  }),
);

const attachSchema = z
  .object({
    lessonId: z.string().uuid(),
    title: z.string().max(200).optional(),
    url: z.string().max(4000).optional(),
    fileKey: z.string().max(200).optional(),
    originalName: z.string().max(200).optional(),
    mimeType: z.string().max(200).nullable().optional(),
    sizeBytes: z.coerce.number().int().min(0).optional(),
  })
  .refine((d) => (d.url && d.url.trim()) || d.fileKey, { message: 'A document needs a URL or an uploaded file' });

const docIdParam = z.object({ id: z.string().uuid() });
const updateDocSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    orderIndex: z.coerce.number().int().min(0).optional(),
  })
  .refine((d) => d.title !== undefined || d.orderIndex !== undefined, { message: 'Nothing to update' });

router.post(
  '/documents',
  authenticate,
  requireModule('LMS'),
  canManage,
  validate({ body: attachSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof attachSchema>;
    const lesson = await prisma.lesson.findUnique({ where: { id: body.lessonId }, select: { id: true } });
    if (!lesson) throw ApiError.notFound('Lesson not found');
    const agg = await prisma.lessonDocument.aggregate({ where: { lessonId: body.lessonId }, _max: { orderIndex: true } });
    const nextIndex = (agg._max.orderIndex ?? -1) + 1;
    const title = body.title?.trim() || body.originalName?.trim() || `Document ${nextIndex + 1}`;
    const trimmedUrl = body.url?.trim() || '';
    let mimeType = body.mimeType || null;
    if (!mimeType && trimmedUrl) mimeType = await probeContentType(trimmedUrl);
    const doc = await prisma.lessonDocument.create({
      data: {
        lessonId: body.lessonId,
        title,
        url: trimmedUrl,
        fileKey: body.fileKey || null,
        originalName: body.originalName?.trim() || title,
        mimeType,
        sizeBytes: BigInt(Math.floor(body.sizeBytes ?? 0)),
        orderIndex: nextIndex,
      },
    });
    return created(res, { id: doc.id, title: doc.title }, 'Document added');
  }),
);

router.patch(
  '/documents/:id',
  authenticate,
  requireModule('LMS'),
  canManage,
  validate({ params: docIdParam, body: updateDocSchema }),
  asyncHandler(async (req, res) => {
    const doc = await prisma.lessonDocument.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!doc) throw ApiError.notFound('Document not found');
    const body = req.body as z.infer<typeof updateDocSchema>;
    const updated = await prisma.lessonDocument.update({
      where: { id: doc.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.orderIndex !== undefined ? { orderIndex: body.orderIndex } : {}),
      },
      select: { id: true, title: true },
    });
    return ok(res, updated, 'Document updated');
  }),
);

router.delete(
  '/documents/:id',
  authenticate,
  requireModule('LMS'),
  canManage,
  validate({ params: docIdParam }),
  asyncHandler(async (req, res) => {
    const doc = await prisma.lessonDocument.findUnique({ where: { id: req.params.id }, select: { id: true, fileKey: true } });
    if (!doc) throw ApiError.notFound('Document not found');
    await prisma.lessonDocument.delete({ where: { id: doc.id } });
    safeUnlink(doc.fileKey);
    return ok(res, null, 'Document removed');
  }),
);

export default router;
