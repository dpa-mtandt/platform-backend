import { ApiError } from '../../utils/apiError';

/**
 * Accepts Power BI's "Embed report > Website or portal" value — the bare URL or
 * the whole <iframe> snippet — and returns a validated iframe-safe URL.
 *
 * Rejects "Publish to web" (/view?r=…) links on purpose: those are world-readable
 * and would silently defeat every access control in the platform.
 */
export function normalizeSecureEmbedUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw ApiError.badRequest('Secure embed URL is empty');

  const iframeSrc = /<iframe[^>]*\ssrc=["']([^"']+)["']/i.exec(trimmed);
  const candidate = iframeSrc ? iframeSrc[1]! : trimmed;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw ApiError.badRequest('That is not a valid URL. Paste the link (or iframe) from Power BI.');
  }
  if (url.protocol !== 'https:') throw ApiError.badRequest('The embed URL must use https.');

  const host = url.hostname.toLowerCase();
  if (!(host === 'powerbi.com' || host.endsWith('.powerbi.com'))) {
    throw ApiError.badRequest('The embed URL must be a powerbi.com address.');
  }
  if (url.pathname.toLowerCase().startsWith('/view')) {
    throw ApiError.badRequest('That is a "Publish to web" link, which makes the report public to anyone on the internet. Use File > Embed report > Website or portal instead.');
  }
  if (!url.pathname.toLowerCase().includes('reportembed')) {
    throw ApiError.badRequest('That does not look like an embed link. In Power BI use File > Embed report > Website or portal.');
  }
  return url.toString();
}

/** Best-effort reportId from an embed URL (display only). */
export function reportIdFromEmbedUrl(embedUrl: string): string | null {
  try {
    return new URL(embedUrl).searchParams.get('reportId');
  } catch {
    return null;
  }
}
