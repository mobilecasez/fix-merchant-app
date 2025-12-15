/*
  Warnings:

  - You are about to drop the column `isTrialUsed` on the `ShopSubscription` table. All the data in the column will be lost.
  - You are about to drop the column `trialEndDate` on the `ShopSubscription` table. All the data in the column will be lost.
  - You are about to drop the column `trialStartDate` on the `ShopSubscription` table. All the data in the column will be lost.

*/
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
    "trialProductsUsed" INTEGER NOT NULL DEFAULT 0,
    "triedPlanIds" TEXT NOT NULL DEFAULT '',
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
