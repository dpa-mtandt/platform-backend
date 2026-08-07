-- CreateTable
CREATE TABLE "feedback_competencies" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "giverId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "periodMonth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_scores" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,

    CONSTRAINT "feedback_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_competencies_key_key" ON "feedback_competencies"("key");

-- CreateIndex
CREATE INDEX "feedback_recipientId_idx" ON "feedback"("recipientId");

-- CreateIndex
CREATE INDEX "feedback_giverId_idx" ON "feedback"("giverId");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_giverId_recipientId_periodMonth_key" ON "feedback"("giverId", "recipientId", "periodMonth");

-- CreateIndex
CREATE INDEX "feedback_scores_competencyId_idx" ON "feedback_scores"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_scores_feedbackId_competencyId_key" ON "feedback_scores"("feedbackId", "competencyId");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_scores" ADD CONSTRAINT "feedback_scores_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_scores" ADD CONSTRAINT "feedback_scores_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "feedback_competencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
