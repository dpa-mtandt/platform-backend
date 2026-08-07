import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from './env';
import { logger } from './logger';

/**
 * Cloudflare R2 is S3-compatible. All binary media (videos, docs, images)
 * lives here; Postgres only stores metadata (fileKey, mimeType, sizeBytes, …).
 */

const r2 = config.r2;

export const isR2Configured = Boolean(
  r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket,
);

export const r2Client = isR2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      },
    })
  : null;

export function assertR2Configured(): void {
  if (!r2Client || !r2.bucket) {
    throw new Error(
      'Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.',
    );
  }
}

export async function r2PutObject(
  key: string,
  body: Buffer | Uint8Array | ReadableStream | NodeJS.ReadableStream,
  contentType: string,
  contentLength?: number,
): Promise<void> {
  assertR2Configured();
  await r2Client!.send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: body as never,
      ContentType: contentType,
      ...(contentLength != null ? { ContentLength: contentLength } : {}),
    }),
  );
}

export async function r2GetObject(
  key: string,
  range?: string,
): Promise<{ body: NodeJS.ReadableStream; contentType?: string; contentLength?: number; contentRange?: string; statusCode: number }> {
  assertR2Configured();
  const res = await r2Client!.send(
    new GetObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      ...(range ? { Range: range } : {}),
    }),
  );
  if (!res.Body) throw new Error(`R2 object ${key} has no body`);
  return {
    body: res.Body as NodeJS.ReadableStream,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
    contentRange: res.ContentRange,
    statusCode: range && res.ContentRange ? 206 : 200,
  };
}

export async function r2DeleteObject(key: string): Promise<void> {
  if (!isR2Configured || !key) return;
  try {
    await r2Client!.send(
      new DeleteObjectCommand({
        Bucket: r2.bucket,
        Key: key,
      }),
    );
  } catch (err) {
    logger.warn(`Failed to delete R2 object ${key}`, err);
  }
}

export async function r2HeadObject(key: string): Promise<{ contentType?: string; contentLength?: number } | null> {
  if (!isR2Configured) return null;
  try {
    const res = await r2Client!.send(
      new HeadObjectCommand({
        Bucket: r2.bucket,
        Key: key,
      }),
    );
    return {
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    };
  } catch {
    return null;
  }
}
