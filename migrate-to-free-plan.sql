-- Update Free Trial plan to Free Plan
UPDATE "SubscriptionPlan" 
SET 
  name = 'Free Plan',
  description = 'Free Forever - Import up to 2 products per month',
  price = 0,
  "productLimit" = 2
WHERE name = 'Free Trial';

-- Update all trial subscriptions to active status
UPDATE "ShopSubscription"
SET status = 'active'
WHERE status = 'trial';

-- Display results
SELECT id, name, description, price, "productLimit", "isActive" 
FROM "SubscriptionPlan" 
WHERE name = 'Free Plan';

SELECT shop, status, "productsUsed", "trialProductsUsed", "planId"
FROM "ShopSubscription"
LIMIT 5;
