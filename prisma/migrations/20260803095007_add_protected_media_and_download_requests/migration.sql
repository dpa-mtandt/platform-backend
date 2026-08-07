-- CreateEnum
CREATE TYPE "DownloadRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "fileKey" TEXT,
ADD COLUMN     "isProtected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mimeType" TEXT,
ALTER COLUMN "url" SET DEFAULT '';

-- CreateTable
CREATE TABLE "lesson_documents" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "fileKey" TEXT,
    "originalName" TEXT NOT NULL DEFAULT 'document',
    "mimeType" TEXT,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "DownloadRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decisionNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_documents_lessonId_idx" ON "lesson_documents"("lessonId");

-- CreateIndex
CREATE INDEX "download_requests_status_createdAt_idx" ON "download_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "download_requests_userId_idx" ON "download_requests"("userId");

-- CreateIndex
CREATE INDEX "download_requests_documentId_idx" ON "download_requests"("documentId");

-- AddForeignKey
ALTER TABLE "lesson_documents" ADD CONSTRAINT "lesson_documents_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_requests" ADD CONSTRAINT "download_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_requests" ADD CONSTRAINT "download_requests_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "lesson_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_requests" ADD CONSTRAINT "download_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
