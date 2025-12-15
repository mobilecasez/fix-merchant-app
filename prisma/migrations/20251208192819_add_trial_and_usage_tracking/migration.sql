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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "chargeId" TEXT,
    "productsUsed" INTEGER NOT NULL DEFAULT 0,
    "billingCycleStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billingCycleEnd" DATETIME,
    "isTrialUsed" BOOLEAN NOT NULL DEFAULT false,
    "trialStartDate" DATETIME,
    "trialEndDate" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShopSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ShopSubscription" ("billingCycleEnd", "billingCycleStart", "cancelledAt", "chargeId", "createdAt", "id", "planId", "productsUsed", "shop", "status", "updatedAt") SELECT "billingCycleEnd", "billingCycleStart", "cancelledAt", "chargeId", "createdAt", "id", "planId", "productsUsed", "shop", "status", "updatedAt" FROM "ShopSubscription";
DROP TABLE "ShopSubscription";
ALTER TABLE "new_ShopSubscription" RENAME TO "ShopSubscription";
CREATE UNIQUE INDEX "ShopSubscription_shop_key" ON "ShopSubscription"("shop");
CREATE UNIQUE INDEX "ShopSubscription_chargeId_key" ON "ShopSubscription"("chargeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "UsageHistory_shop_date_idx" ON "UsageHistory"("shop", "date");
