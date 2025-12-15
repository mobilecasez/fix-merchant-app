-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "addProductReplicaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dashboardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "additionalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reportEnabled" BOOLEAN NOT NULL DEFAULT false,
    "storeErrorReportEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");
