import { Readable } from 'node:stream';
import path from 'node:path';
import type { Request, Response } from 'express';
import { ApiError } from '../../../utils/apiError';
import { logger } from '../../../config/logger';
import { isR2Configured, r2PutObject, r2GetObject, r2DeleteObject } from '../../../config/r2';

/**
 * Protected-media storage & streaming.
 *
 * ALL binary media (videos, documents, images) lives in Cloudflare R2 (S3-compatible).
 * Postgres holds only metadata (fileKey, mimeType, sizeBytes, …). There is no local
 * disk store and no database blob store — R2 is the single source of truth.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function contentTypeFor(nameOrKey: string, fallback = 'application/octet-stream'): string {
  return CONTENT_TYPES[path.extname(nameOrKey).toLowerCase()] ?? fallback;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 200) || 'download';
}

/** Best-effort delete of an object from R2. Never throws. */
export function safeUnlink(fileKey: string | null | undefined): void {
  if (!fileKey) return;
  void r2DeleteObject(fileKey);
}

function setViewHeaders(res: Response, contentType: string, downloadName?: string): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.removeHeader('X-Frame-Options');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length, Content-Type');
  res.setHeader('Content-Disposition', downloadName ? `attachment; filename="${sanitizeFilename(downloadName)}"` : 'inline');
}

/** Stream a protected object from Cloudflare R2 with HTTP Range support. */
export async function streamR2Object(
  req: Request,
  res: Response,
  fileKey: string,
  opts: { contentType?: string; downloadName?: string } = {},
): Promise<void> {
  const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  let upstream;
  try {
    upstream = await r2GetObject(fileKey, rangeHeader);
  } catch (err) {
    logger.error(`R2 get failed for ${fileKey}`, err);
    throw ApiError.notFound('File not found');
  }
  const contentType = opts.contentType || upstream.contentType || contentTypeFor(fileKey);
  setViewHeaders(res, contentType, opts.downloadName);
  if (upstream.contentRange) res.setHeader('Content-Range', upstream.contentRange);
  if (upstream.contentLength != null) res.setHeader('Content-Length', String(upstream.contentLength));
  res.status(upstream.statusCode);
  const nodeStream = Readable.from(upstream.body as never);
  nodeStream.on('error', () => res.destroy());
  nodeStream.pipe(res);
}

/** The single entry point for streaming any stored upload (always R2). */
export async function streamProtectedUpload(
  req: Request,
  res: Response,
  fileKey: string,
  opts: { contentType?: string; downloadName?: string } = {},
): Promise<void> {
  if (!isR2Configured) throw ApiError.serviceUnavailable('Object storage (Cloudflare R2) is not configured');
  return streamR2Object(req, res, fileKey, opts);
}

/** Upload a buffer to R2. */
export async function putProtectedObject(fileKey: string, body: Buffer | Uint8Array, mimeType: string): Promise<void> {
  if (!isR2Configured) throw ApiError.serviceUnavailable('Object storage (Cloudflare R2) is not configured');
  await r2PutObject(fileKey, body, mimeType, body.length);
}

/** Stream the request body into a size-limited buffer, then put it to R2. */
export async function uploadRequestToR2(req: Request, fileKey: string, mimeType: string, maxBytes: number): Promise<number> {
  if (!isR2Configured) throw ApiError.serviceUnavailable('Object storage (Cloudflare R2) is not configured');
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(ApiError.badRequest(`File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve());
  });
  if (size === 0) throw ApiError.badRequest('Empty upload');
  const buf = Buffer.concat(chunks);
  await r2PutObject(fileKey, buf, mimeType, buf.length);
  return size;
}

// ── Remote (SharePoint / OneDrive / YouTube / …) URL helpers ──────────────────

function isMicrosoftShareHost(host: string): boolean {
  const h = host.toLowerCase();
  return h.endsWith('.sharepoint.com') || h.endsWith('.sharepoint.us') || h === 'onedrive.live.com' || h.endsWith('1drv.ms');
}

export function isMicrosoftShareUrl(rawUrl: string): boolean {
  try {
    return isMicrosoftShareHost(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

const BROWSERISH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

export function toDirectDownloadUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (isMicrosoftShareHost(u.hostname) && !u.searchParams.has('download')) u.searchParams.set('download', '1');
  return u.toString();
}

export function toEmbedUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const host = u.hostname.toLowerCase();

  if (host === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0];
    if (id) return `https://www.youtube.com/embed/${id}`;
  }
  if (host.endsWith('youtube.com')) {
    const v = u.searchParams.get('v');
    if (v) return `https://www.youtube.com/embed/${v}`;
    const m = /\/(?:embed|shorts)\/([^/?#]+)/.exec(u.pathname);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
  }
  if (host.endsWith('vimeo.com')) {
    const id = u.pathname.split('/').filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
  }
  if (host.endsWith('drive.google.com')) {
    const m = /\/file\/d\/([^/]+)/.exec(u.pathname);
    if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  }
  if (isMicrosoftShareHost(host)) {
    u.searchParams.delete('download');
    if (!u.searchParams.has('action')) u.searchParams.set('action', 'embedview');
    return u.toString();
  }
  return u.toString();
}

export function assertSafeRemoteUrl(rawUrl: string): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw ApiError.badRequest('Invalid media URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw ApiError.badRequest('Only http(s) media URLs are allowed');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0') {
    throw ApiError.badRequest('This media URL is not allowed');
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const priv =
      a === 0 || a === 127 || a === 10 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    if (priv) throw ApiError.badRequest('This media URL is not allowed');
  }
  if (host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) {
    throw ApiError.badRequest('This media URL is not allowed');
  }
}

export async function probeContentType(rawUrl: string): Promise<string | null> {
  let direct: string;
  try {
    direct = toDirectDownloadUrl(rawUrl);
    assertSafeRemoteUrl(direct);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(direct, { method: 'GET', headers: { ...BROWSERISH_HEADERS, Range: 'bytes=0-0' }, redirect: 'follow', signal: controller.signal });
    const ct = res.headers.get('content-type');
    await res.body?.cancel().catch(() => {});
    return ct ? ct.split(';')[0]!.trim().toLowerCase() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function streamRemoteUrl(
  req: Request,
  res: Response,
  rawUrl: string,
  opts: { contentType?: string; downloadName?: string } = {},
): Promise<void> {
  const direct = toDirectDownloadUrl(rawUrl);
  assertSafeRemoteUrl(direct);

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const headers: Record<string, string> = { ...BROWSERISH_HEADERS };
  if (req.headers.range) headers.Range = req.headers.range;
  const doFetch = (target: string) => fetch(target, { headers, redirect: 'follow', signal: controller.signal });

  let upstream: Awaited<ReturnType<typeof fetch>>;
  try {
    upstream = await doFetch(direct);
    if (upstream.status >= 400 && direct !== rawUrl) {
      assertSafeRemoteUrl(rawUrl);
      const retry = await doFetch(rawUrl);
      if (retry.status < 400) upstream = retry;
    }
  } catch (err) {
    if (controller.signal.aborted) return;
    logger.error('Media proxy fetch failed', err);
    throw new ApiError(502, 'Could not fetch the media from its source URL');
  }

  if (upstream.status >= 400) {
    throw new ApiError(502, `Media source returned ${upstream.status}. If it is an org-restricted SharePoint link, it will open via your own sign-in instead.`);
  }

  const contentType = opts.contentType || upstream.headers.get('content-type') || contentTypeFor(rawUrl);
  setViewHeaders(res, contentType, opts.downloadName);
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) res.setHeader('Content-Range', contentRange);
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) res.setHeader('Content-Length', contentLength);
  res.status(upstream.status === 206 ? 206 : 200);

  if (!upstream.body) {
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.on('error', () => res.destroy());
  nodeStream.pipe(res);
}
