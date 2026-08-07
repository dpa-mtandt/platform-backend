import type { Video, LessonDocument, DownloadRequest } from '@prisma/client';
import { config } from '../../../config/env';
import { signMediaToken } from '../../../utils/jwt';
import { toDirectDownloadUrl, toEmbedUrl, isMicrosoftShareUrl } from './media.stream';

/**
 * Tokened media URL. When PUBLIC_API_URL is set (FE and API on different hosts),
 * returns an absolute URL the browser can load directly. When empty (same-origin
 * or Vite proxy), returns a path relative to the current origin.
 */
function mediaUrl(pathAndQuery: string): string {
  const base =
    typeof (config as { publicApiUrl?: unknown }).publicApiUrl === 'string'
      ? ((config as { publicApiUrl: string }).publicApiUrl || '').replace(/\/+$/, '')
      : '';
  return `${base}${pathAndQuery}`;
}

/** A tokened stream URL for a protected video. */
export function videoStreamUrl(videoId: string, userId: string): string {
  return mediaUrl(
    `${config.apiPrefix}/media/video/${videoId}?token=${signMediaToken({
      sub: userId,
      k: videoId,
      kind: 'video',
    })}`,
  );
}

/** A tokened, inline-view URL for a protected document. */
export function docViewUrl(documentId: string, userId: string): string {
  return mediaUrl(
    `${config.apiPrefix}/media/doc/${documentId}?token=${signMediaToken({
      sub: userId,
      k: documentId,
      kind: 'doc',
    })}`,
  );
}

export function isVideoProtected(v: Pick<Video, 'isProtected' | 'fileKey'>): boolean {
  return v.isProtected || !!v.fileKey;
}

export interface ClientVideo {
  id: string;
  title: string;
  streamUrl: string;
  /**
   * Browser-embeddable fallback URL for URL-sourced videos. If the proxy `streamUrl`
   * fails (e.g. an org-restricted SharePoint link the server can't fetch), the player
   * renders this in an <iframe> using the viewer's own sign-in. Null for uploads.
   */
  embedUrl: string | null;
  isProtected: boolean;
  duration: number;
  thumbnailUrl: string | null;
  provider: string | null;
  mimeType: string | null;
  // Only populated for course managers (so the editor can show/edit the source).
  sourceUrl?: string;
  fileKey?: string | null;
  sizeBytes?: number;
}

/**
 * Client-safe video: exposes only a `streamUrl`. Protected videos get a tokened
 * proxy URL (view-only, watermarked in the player); unprotected videos pass their
 * raw URL through. The stored `url`/`fileKey` are serialized ONLY for managers
 * (`includeSource`), never for learners.
 */
export function serializeVideo(
  v: Video | null | undefined,
  userId: string,
  opts: { includeSource?: boolean } = {},
): ClientVideo | null {
  if (!v) return null;
  const isProtected = isVideoProtected(v);
  const rawUrl = (v.url || '').trim();
  // Always prefer the tokened proxy when protected or when there is no public URL.
  const streamUrl = isProtected || !rawUrl ? videoStreamUrl(v.id, userId) : rawUrl;
  const base: ClientVideo = {
    id: v.id,
    title: v.title,
    streamUrl,
    // Only URL-sourced videos need a fallback; uploaded files always stream fine.
    embedUrl: !v.fileKey && rawUrl ? toEmbedUrl(rawUrl) : null,
    isProtected,
    duration: v.duration,
    thumbnailUrl: v.thumbnailUrl,
    provider: v.provider,
    mimeType: v.mimeType,
  };
  if (opts.includeSource) {
    base.sourceUrl = v.url;
    base.fileKey = v.fileKey;
    base.sizeBytes = Number(v.sizeBytes);
  }
  return base;
}

export interface ClientDocumentRequest {
  id: string;
  status: DownloadRequest['status'];
  canDownload: boolean;
  reason: string | null;
  decisionNote: string | null;
  expiresAt: string | null;
  reviewedAt: string | null;
}

/**
 * How the browser should preview a document:
 *  - 'inline'  → same-origin proxy stream (PDF / image / text): view-only, link hidden.
 *  - 'embed'   → SharePoint/OneDrive share embedded in an <iframe> that renders through
 *                the viewer's OWN sign-in (robust for org-restricted links the server
 *                can't fetch). The link is exposed to the browser, unavoidably.
 *  - 'office'  → a read-only Office web viewer for Word/PPT/Excel URLs (renders the
 *                file; the link is handed to the viewer, so it must be public).
 *  - 'none'    → not previewable in a browser (e.g. an uploaded Office file) →
 *                the UI shows a "request download" notice.
 */
export type DocPreview =
  | { mode: 'inline'; url: string }
  | { mode: 'embed'; url: string }
  | { mode: 'office'; url: string }
  | { mode: 'none' };

export interface ClientDocument {
  id: string;
  title: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number;
  viewUrl: string;
  preview: DocPreview;
  // True when this "document" is actually a video file: it plays view-only in the
  // viewer and can never be downloaded (matching the video policy).
  isVideo: boolean;
  // A URL to open the source in a new tab via the viewer's own sign-in — the escape
  // hatch when an embedded preview is blocked from framing. Null for uploaded files.
  openUrl: string | null;
  // How an approved download is delivered: 'file' streams the uploaded bytes from
  // our server; 'external' hands back the source link for the browser to fetch
  // (so a private SharePoint file downloads via the user's own login).
  download: 'file' | 'external';
  request: ClientDocumentRequest | null;
}

export type DocKind = 'pdf' | 'image' | 'text' | 'video' | 'office' | 'other';

/** Classify a document from its MIME type and/or filename. */
export function inferDocKind(mimeType: string | null | undefined, originalName: string | null | undefined): DocKind {
  const mime = (mimeType || '').toLowerCase();
  const name = (originalName || '').toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return 'image';
  // A video file attached in the Documents slot — playable view-only, never downloadable.
  if (mime.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v|mkv)$/.test(name)) return 'video';
  if (mime.startsWith('text/') || name.endsWith('.txt')) return 'text';
  if (/(word|powerpoint|presentation|excel|spreadsheet|officedocument|msword|ms-excel|ms-powerpoint)/.test(mime) || /\.(docx?|pptx?|xlsx?)$/.test(name)) return 'office';
  return 'other';
}

/** True when a document is actually a video file (attached in the Documents slot). */
export function isVideoDocument(mimeType: string | null | undefined, originalName: string | null | undefined): boolean {
  return inferDocKind(mimeType, originalName) === 'video';
}

/** Microsoft's read-only Office web viewer embed URL for a public document link. */
export function officeEmbedUrl(sourceUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(toDirectDownloadUrl(sourceUrl))}`;
}

/** True when an APPROVED request is still within its grant window. */
export function grantIsLive(r: Pick<DownloadRequest, 'status' | 'expiresAt'>): boolean {
  return r.status === 'APPROVED' && (r.expiresAt === null || r.expiresAt.getTime() > Date.now());
}

export function serializeDocumentRequest(r: DownloadRequest | null | undefined): ClientDocumentRequest | null {
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    canDownload: grantIsLive(r),
    reason: r.reason,
    decisionNote: r.decisionNote,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  };
}

/**
 * Client-safe document: only a tokened `viewUrl` (view-only, in-app). No download
 * URL is ever sent — download happens through the approval-gated route. `request`
 * carries the viewer's latest download-request state (drives the UI button).
 */
export function serializeDocument(d: LessonDocument, userId: string, latestRequest?: DownloadRequest | null): ClientDocument {
  const kind = inferDocKind(d.mimeType, d.originalName);
  const hasUrl = !!d.url && d.url.trim().length > 0;
  const isShare = hasUrl && isMicrosoftShareUrl(d.url);
  let preview: DocPreview;
  if (isShare) {
    // SharePoint/OneDrive — render through the viewer's own sign-in. This works for
    // both "anyone with the link" and org-restricted shares (our server can't fetch
    // the latter), so it's the robust default for these hosts.
    preview = { mode: 'embed', url: toEmbedUrl(d.url) };
  } else if (kind === 'pdf' || kind === 'image' || kind === 'text' || kind === 'video') {
    // Browser-renderable (incl. a video file attached as a document) → stream
    // view-only through our proxy (the raw source/link stays hidden).
    preview = { mode: 'inline', url: docViewUrl(d.id, userId) };
  } else if (hasUrl) {
    // Office / unknown from a (non-SharePoint) URL → read-only Office web viewer.
    preview = { mode: 'office', url: officeEmbedUrl(d.url) };
  } else {
    // Uploaded non-renderable file (e.g. a .docx on our private disk) — no viewer.
    preview = { mode: 'none' };
  }
  return {
    id: d.id,
    title: d.title,
    originalName: d.originalName,
    mimeType: d.mimeType,
    sizeBytes: Number(d.sizeBytes),
    viewUrl: docViewUrl(d.id, userId),
    preview,
    isVideo: kind === 'video',
    openUrl: hasUrl ? toEmbedUrl(d.url) : null,
    download: d.fileKey ? 'file' : 'external',
    request: serializeDocumentRequest(latestRequest),
  };
}
