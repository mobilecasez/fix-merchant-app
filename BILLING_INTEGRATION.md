# Shopify Billing API Integration

This app uses Shopify's Billing API to handle subscription charges.

## How It Works

### 1. **Trial System (Per-Plan)**
- Each plan offers 2 free product imports as a trial
- Users can try each plan once (tracked in database)
- Trial status is tracked per-plan in `triedPlanIds` field

### 2. **Billing Flow**

#### New Subscription:
1. User clicks "Choose Plan" button
2. App calls `requestBilling()` which creates a Shopify billing charge
3. User is redirected to Shopify's billing confirmation page
4. After approval, Shopify redirects to `/app/billing-callback`
5. Callback verifies the charge and creates subscription in database

#### Plan Change (Upgrade/Downgrade):
1. User clicks "Upgrade" or "Downgrade" button
2. App requests new billing charge for the new plan
3. User approves on Shopify's confirmation page
4. Callback updates subscription to new plan

#### Trial to Paid:
1. User on trial clicks "Upgrade to This Plan"
2. App requests billing for the paid plan
3. After approval, trial status changes to "active"

### 3. **Key Functions**

**`requestBilling(request, planId, returnUrl)`**
- Creates recurring application charge with Shopify
- Returns confirmation URL for user to approve
- Uses `billing.request()` from Shopify API

**`checkBillingStatus(request, chargeId)`**
- Verifies if a charge is active
- Called in billing callback to confirm payment

**`startPlanTrial(shop, planId)`**
- Starts 2-product trial for a specific plan
- Marks plan as tried in database

**`createSubscription(shop, planId, chargeId)`**
- Creates or updates subscription after billing approval
- Sets status to "active"

**`changePlan(shop, newPlanId)`**
- Updates subscription to new plan
- Resets counters if moving to higher tier

### 4. **Routes**

**`/app/choose-subscription`**
- Displays available plans with "Try for Free" buttons
- Handles form submission for trials and purchases

**`/app/billing-callback`**
- Receives callback from Shopify after billing approval
- Confirms charge and activates subscription

**`/app/subscription-success`**
- Success page after subscription activation

### 5. **Environment Variables**

Required in `.env`:
```
SHOPIFY_APP_URL=https://your-production-url.com
```

This URL is used for billing return callbacks.

### 6. **Testing**

During development:
- Set `NODE_ENV=development` 
- Billing API runs in test mode (no real charges)
- Test subscriptions will be marked as test charges

### 7. **Production Checklist**

Before going live:
- [ ] Set `NODE_ENV=production`
- [ ] Update `SHOPIFY_APP_URL` to production URL
- [ ] Test billing flow end-to-end
- [ ] Verify webhooks are configured for subscription updates
- [ ] Set up monitoring for failed charges

### 8. **Database Schema**

**ShopSubscription:**
```prisma
model ShopSubscription {
  id                String    @id @default(cuid())
  shop              String    @unique
  planId            String
  status            String    // "trial", "active", "cancelled", "expired"
  chargeId          String?   // Shopify charge ID
  productsUsed      Int       @default(0)
  trialProductsUsed Int       @default(0)
  triedPlanIds      String?   // Comma-separated list of tried plan IDs
  billingCycleStart DateTime?
  billingCycleEnd   DateTime?
  // ... other fields
}
```

### 9. **Error Handling**

Common errors:
- `billing_cancelled`: User cancelled on Shopify confirmation page
- `billing_not_active`: Charge wasn't approved
- `billing_failed`: Generic billing error
- `missing_plan`: Plan ID not provided

All errors redirect to `/app/choose-subscription?error=<error_type>`

### 10. **Future Enhancements**

- Webhook handler for `APP_SUBSCRIPTIONS_UPDATE`
- Automatic billing cycle renewal
- Usage-based billing option
- Annual billing with discount
- Prorated plan changes
