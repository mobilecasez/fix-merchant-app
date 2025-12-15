# Settings System Documentation

## Overview
The app now includes an admin-only settings system that allows the application owner to control which pages are visible to users.

## Default Configuration
When the app is first installed, these are the default settings:
- ✅ **Add Product Replica**: Enabled
- ❌ **Dashboard**: Disabled
- ❌ **Additional Page**: Disabled
- ❌ **Product Error Detailed Report**: Disabled
- ❌ **Store Error Report**: Disabled

## Database Schema
A new `AppSettings` model was added to Prisma:
```prisma
model AppSettings {
  id                      String   @id @default(cuid())
  shop                    String   @unique
  addProductReplicaEnabled Boolean @default(true)
  dashboardEnabled        Boolean  @default(false)
  additionalEnabled       Boolean  @default(false)
  reportEnabled           Boolean  @default(false)
  storeErrorReportEnabled Boolean  @default(false)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
}
```

## How It Works

### 1. Navigation (app.tsx)
- The main app layout fetches settings from the database
- Navigation links are conditionally rendered based on settings
- Only the account owner sees the "Settings" link
- Settings are automatically created on first access if they don't exist

### 2. Settings Page (app/routes/app.settings.tsx)
- **Access**: Only account owners can access this page
- **Authorization**: Returns 403 error if accessed by non-owners
- **Features**:
  - Toggle each page on/off with checkboxes
  - Changes save instantly with toast confirmation
  - Settings are stored per shop in the database

### 3. Route Protection
Each protected route now checks settings before rendering:
- `app.dashboard.tsx` - checks `dashboardEnabled`
- `app.additional.tsx` - checks `additionalEnabled`
- `app.report.tsx` - checks `reportEnabled`
- `app.store-error-report.tsx` - checks `storeErrorReportEnabled`

If a page is disabled, it returns a 403 error, even if accessed directly via URL.

## Account Owner Detection
The system uses the `accountOwner` field in the Session model to determine admin privileges. This is typically set during installation and identifies the shop owner who installed the app.

## Usage

### For App Owner
1. Navigate to the Settings page (only visible to you)
2. Toggle features on/off as needed
3. Changes apply immediately for all users

### For Regular Users
- Users only see enabled pages in navigation
- Attempting to access disabled pages shows an error
- No access to Settings page

## Launch Strategy
With default settings, you can:
1. Launch with only "Add Product Replica" visible
2. Test and stabilize that feature
3. Enable additional features as they're ready
4. Roll out features gradually to manage support load

## Technical Implementation

### Checking Settings in Loaders
```typescript
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const settings = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });

  if (!settings?.featureEnabled) {
    throw new Response("This page is not enabled", { status: 403 });
  }
  
  // Rest of loader logic...
};
```

### Conditional Navigation
```tsx
{settings.dashboardEnabled && (
  <Link to="/app/dashboard">Dashboard</Link>
)}
```

## Files Modified
1. `/prisma/schema.prisma` - Added AppSettings model
2. `/app/routes/app.settings.tsx` - New settings page
3. `/app/routes/app.tsx` - Updated navigation with conditional rendering
4. `/app/routes/app.dashboard.tsx` - Added settings check
5. `/app/routes/app.additional.tsx` - Added settings check
6. `/app/routes/app.report.tsx` - Added settings check
7. `/app/routes/app.store-error-report.tsx` - Added settings check

## Migration Status
✅ Database schema updated
✅ Prisma client regenerated
✅ No pending migrations
