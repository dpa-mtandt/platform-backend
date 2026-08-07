-- All protected media now lives exclusively in Cloudflare R2.
-- Postgres keeps only metadata (fileKey, mimeType, sizeBytes, …).
DROP TABLE IF EXISTS "protected_media_blobs";
