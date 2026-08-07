-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "secureEmbedUrl" TEXT,
    "workspaceId" TEXT,
    "reportId" TEXT,
    "datasetId" TEXT,
    "embedUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowExport" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "dashboard_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dashboards_key_key" ON "dashboards"("key");

-- CreateIndex
CREATE INDEX "dashboard_access_userId_idx" ON "dashboard_access"("userId");

-- CreateIndex
CREATE INDEX "dashboard_access_dashboardId_idx" ON "dashboard_access"("dashboardId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_access_userId_dashboardId_key" ON "dashboard_access"("userId", "dashboardId");

-- AddForeignKey
ALTER TABLE "dashboard_access" ADD CONSTRAINT "dashboard_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_access" ADD CONSTRAINT "dashboard_access_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_access" ADD CONSTRAINT "dashboard_access_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
