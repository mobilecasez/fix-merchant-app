-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);

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

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "productLimit" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ShopSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "chargeId" TEXT,
    "productsUsed" INTEGER NOT NULL DEFAULT 0,
    "billingCycleStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billingCycleEnd" DATETIME,
    "trialProductsUsed" INTEGER NOT NULL DEFAULT 0,
    "triedPlanIds" TEXT NOT NULL DEFAULT '',
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShopSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productsCreated" INTEGER NOT NULL DEFAULT 0,
    "planName" TEXT NOT NULL,
    "planLimit" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ShopReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSubscription_shop_key" ON "ShopSubscription"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSubscription_chargeId_key" ON "ShopSubscription"("chargeId");

-- CreateIndex
CREATE INDEX "UsageHistory_shop_date_idx" ON "UsageHistory"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShopReview_shop_key" ON "ShopReview"("shop");
