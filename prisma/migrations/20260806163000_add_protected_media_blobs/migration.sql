-- Durable blob storage for protected media uploads (survives ephemeral disks).
CREATE TABLE IF NOT EXISTS "protected_media_blobs" (
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protected_media_blobs_pkey" PRIMARY KEY ("key")
);
