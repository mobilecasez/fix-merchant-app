# Product Import Pro - Shopify App

A powerful Shopify application that enables merchants to import authorized products from major e-commerce platforms with AI-powered optimization and Google Merchant Center compliance checking.

## 🌟 Features

### Multi-Platform Import for Authorized Products
Import products you're authorized to sell from:
- Amazon (dropshipping & supplier products)
- AliExpress (authorized supplier products)  
- eBay (licensed products)
- Walmart (supplier products)
- Flipkart (authorized products)
- Shopee (supplier products)
- Plus 5+ more platforms for dropshipping and supplier integration

**Important:** Only import products you have permission to sell - your own products, officially licensed items, or products from authorized suppliers.

### AI-Powered Optimization
- Smart product descriptions using GPT-4
- SEO-optimized titles and content
- Automatic GTIN/UPC discovery
- Intelligent category matching

### Subscription Management
- **Basic**: $4.99/month - 20 products
- **Professional**: $9.99/month - 50 products
- **Premium**: $14.99/month - 100 products
- **Per-Plan Trials**: 2 free products per plan

### Google Merchant Center
- Automated compliance checking
- Detailed error reports
- Fix suggestions
- Store health monitoring

## 🚀 Quick Start (Development)

### Prerequisites

Before you begin, you'll need the following:

1. **Node.js**: [Download and install](https://nodejs.org/en/download/) (v18.20+)
2. **Shopify Partner Account**: [Create account](https://partners.shopify.com/signup)
3. **Test Store**: [Development store](https://help.shopify.com/en/partners/dashboard/development-stores)
4. **OpenAI API Key**: [Get key](https://platform.openai.com/api-keys) (optional, for AI features)
5. **Google AI API Key**: [Get key](https://makersuite.google.com/app/apikey) (optional)

### Installation

```bash
# Clone the repository
git clone https://github.com/mobilecasez/fix-merchant-app.git
cd fix-merchant-app

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values

# Set up database
npx prisma generate
npx prisma migrate deploy
node seed-subscription-plans.js

# Start development server
npm run dev
```

### Development Commands

```bash
# Start development server
npm run dev

# Generate Prisma client
npm run prisma generate

# Run database migrations
npm run db:migrate

# Seed subscription plans
npm run db:seed

# Build for production
npm run build

# Generate secure environment variables
npm run generate:env

# Pre-deployment validation
npm run precheck
```

## 📦 Production Deployment

### 1. Prepare Environment Variables

```bash
# Generate secure keys
npm run generate:env

# Set in your hosting platform
SHOPIFY_API_KEY=your_key
SHOPIFY_API_SECRET=your_secret
SHOPIFY_APP_URL=https://your-domain.com
DATABASE_URL=postgresql://...
ENCRYPTION_STRING=generated_value
NODE_ENV=production
OPENAI_API_KEY=sk-...
GOOGLE_AI_API_KEY=AIza...
```

### 2. Deploy to Hosting Platform

#### Railway (Recommended)
```bash
railway login
railway init
railway up
railway domain  # Get your URL
railway variables set SHOPIFY_APP_URL=https://your-app.up.railway.app
```

#### Fly.io
```bash
fly launch
fly secrets set SHOPIFY_API_KEY=your_key
fly deploy
```

#### Heroku
```bash
heroku create your-app
heroku addons:create heroku-postgresql
heroku config:set SHOPIFY_API_KEY=your_key
git push heroku main
```

### 3. Update Shopify Configuration

1. Go to [Partner Dashboard](https://partners.shopify.com/)
2. Select your app
3. Update App URL to production URL
4. Update OAuth redirect URLs
5. Save changes

### 4. Run Pre-Deployment Checks

```bash
npm run precheck
```

### 5. Deploy

```bash
# Build and deploy
npm run prod:build

# Or use platform-specific commands
railway up  # Railway
fly deploy  # Fly.io
git push heroku main  # Heroku
```

## 📚 Documentation

- **[Production Deployment Guide](./PRODUCTION_DEPLOYMENT.md)** - Complete deployment instructions
- **[Billing Integration](./BILLING_INTEGRATION.md)** - Shopify Billing API details
- **[App Store Submission](./APP_STORE_SUBMISSION_CHECKLIST.md)** - Launch checklist
- **[Privacy Policy](./PRIVACY_POLICY.md)** - Privacy policy template
- **[Terms of Service](./TERMS_OF_SERVICE.md)** - Terms template

## 🗄️ Database Schema

### Models
- **SubscriptionPlan**: Plan configurations (Basic, Professional, Premium)
- **ShopSubscription**: Per-shop subscription tracking with trial management
- **UsageHistory**: Daily usage aggregation for analytics
- **Session**: Shopify session storage

### Migrations
```bash
# Create new migration
npx prisma migrate dev --name your_migration_name

# Apply migrations to production
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

## 🔐 Security

### Environment Variables
- Never commit `.env` files
- Use different values for dev/staging/production
- Rotate secrets every 90 days
- Use hosting platform's secret management

### Data Protection
- All data encrypted in transit (HTTPS)
- Database encryption at rest
- GDPR and CCPA compliant
- Automatic data deletion on app uninstall

## 🧪 Testing

```bash
# Run tests (if implemented)
npm test

# Lint code
npm run lint

# Type checking
npx tsc --noEmit
```

## 🛠️ Tech Stack

- **Framework**: [Remix](https://remix.run/)
- **UI**: [Shopify Polaris](https://polaris.shopify.com/)
- **Database**: [Prisma](https://www.prisma.io/) + PostgreSQL/SQLite
- **AI**: OpenAI GPT-4, Google AI
- **Scraping**: Puppeteer
- **Hosting**: Railway/Fly.io/Heroku compatible

## 📊 Features in Detail

### Product Import Flow
1. User enters product URL from any supported platform
2. App scrapes product data (title, price, images, specs)
3. AI generates optimized description
4. User reviews and customizes
5. Product created in Shopify store

### Subscription Management
- Integrated with Shopify Billing API
- Per-plan trial system (2 free products each)
- Usage tracking and warnings
- Automatic limit enforcement
- Upgrade/downgrade support

### Analytics Dashboard
- Real-time usage statistics
- 30-day usage history
- Daily product creation tracking
- Warning system at 80% and 100% usage
- Smart upgrade recommendations

## 🔌 API Integration

### Shopify APIs Used
- Admin GraphQL API (products, billing)
- Webhooks (uninstall, scopes update)
- OAuth for authentication

### Third-Party APIs
- OpenAI API (description generation)
- Google AI API (content optimization)
- Platform-specific scraping (Amazon, eBay, etc.)

## 🐛 Troubleshooting

### Common Issues

**App won't install:**
- Check OAuth redirect URLs match exactly
- Verify SHOPIFY_API_KEY and SHOPIFY_API_SECRET
- Ensure app URL is HTTPS

**Database errors:**
- Run `npx prisma generate`
- Check DATABASE_URL format
- Ensure migrations are applied

**AI features not working:**
- Verify OPENAI_API_KEY is set
- Check API key has credits
- Review error logs

**Billing not working:**
- Ensure SHOPIFY_APP_URL is set correctly
- Test in development mode first
- Check billing callback route is accessible

## 📞 Support

- **Email**: support@yourapp.com
- **Documentation**: [Full docs](./PRODUCTION_DEPLOYMENT.md)
- **Issues**: [GitHub Issues](https://github.com/mobilecasez/fix-merchant-app/issues)
- **Shopify Partners**: [Partner Support](https://partners.shopify.com/support)

## 📝 License

Proprietary - All rights reserved

## 🤝 Contributing

This is a private commercial application. For feature requests or bug reports, please contact support.

## 🎯 Roadmap

- [ ] Additional platform support
- [ ] Bulk import functionality
- [ ] Advanced AI customization
- [ ] Multi-language support
- [ ] Enhanced analytics
- [ ] API webhooks for integrations

## ⚡ Performance

- Average import time: 5-10 seconds
- Supports: 1000+ products/month per user
- Uptime: 99.9% target
- Response time: <500ms average

## 🔄 Version History

### v1.0.0 (Current)
- Initial release
- Multi-platform import (11 platforms)
- AI-powered descriptions
- Subscription billing with trials
- Usage analytics
- Google Merchant Center compliance

---

**Built with ❤️ for Shopify merchants**

For production deployment assistance, see [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes preconfigured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-remix/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-remix/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks in individual files such as [/app/routes/webhooks.app.uninstalled.tsx](https://github.com/Shopify/shopify-app-template-remix/blob/main/app/routes/webhooks.app.uninstalled.tsx) and [/app/routes/webhooks.app.scopes_update.tsx](https://github.com/Shopify/shopify-app-template-remix/blob/main/app/routes/webhooks.app.scopes_update.tsx)

Please read the [documentation for @shopify/shopify-app-remix](https://www.npmjs.com/package/@shopify/shopify-app-remix#authenticating-admin-requests) to understand what other API's are available.

## Deployment

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, by default using an [SQLite](https://www.sqlite.org/index.html) database.
The database is defined as a Prisma schema in `prisma/schema.prisma`.

This use of SQLite works in production if your app runs as a single instance.
The database that works best for you depends on the data your app needs and how it is queried.
You can run your database of choice on a server yourself or host it with a SaaS company.
Here's a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                               |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Remix handles building the app for you, by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/deployment/web) to host your app on a cloud provider like [Heroku](https://www.heroku.com/) or [Fly.io](https://fly.io/).

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

### Hosting on Vercel

Using the Vercel Preset is recommended when hosting your Shopify Remix app on Vercel. You'll also want to ensure imports that would normally come from `@remix-run/node` are imported from `@vercel/remix` instead. Learn more about hosting Remix apps on Vercel [here](https://vercel.com/docs/frameworks/remix).

```diff
// vite.config.ts
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
+ import { vercelPreset } from '@vercel/remix/vite';

installGlobals();

export default defineConfig({
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
+     presets: [vercelPreset()],
    }),
    tsconfigPaths(),
  ],
});
```

## Troubleshooting

### Database tables don't exist

If you get this error:

```
The table `main.Session` does not exist in the current database.
```

You need to create the database for Prisma. Run the `setup` script in `package.json` using your preferred package manager.

### Navigating/redirecting breaks an embedded app

Embedded Shopify apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `@remix-run/react` or `@shopify/polaris`. Do not use `<a>`.
2. Use the `redirect` helper returned from `authenticate.admin`. Do not use `redirect` from `@remix-run/node`
3. Use `useSubmit` or `<Form/>` from `@remix-run/react`. Do not use a lowercase `<form/>`.

This only applies if your app is embedded, which it will be by default.

### Non Embedded

Shopify apps are best when they are embedded in the Shopify Admin, which is how this template is configured. If you have a reason to not embed your app please make the following changes:

1. Ensure `embedded = false` is set in [shopify.app.toml`](./shopify.app.toml). [Docs here](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration#global).
2. Pass `isEmbeddedApp: false` to `shopifyApp()` in `./app/shopify.server.js|ts`.
3. Change the `isEmbeddedApp` prop to `isEmbeddedApp={false}` for the `AppProvider` in `/app/routes/app.jsx|tsx`.
4. Remove the `@shopify/app-bridge-react` dependency from [package.json](./package.json) and `vite.config.ts|js`.
5. Remove anything imported from `@shopify/app-bridge-react`.  For example: `NavMenu`, `TitleBar` and `useAppBridge`.

### OAuth goes into a loop when I change my app's scopes

If you change your app's scopes and authentication goes into a loop and fails with a message from Shopify that it tried too many times, you might have forgotten to update your scopes with Shopify.
To do that, you can run the `deploy` CLI command.

Using yarn:

```shell
yarn deploy
```

Using npm:

```shell
npm run deploy
```

Using pnpm:

```shell
pnpm run deploy
```

### My shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.  

Instead of using the `afterAuth` hook, the recommended approach is to declare app-specific webhooks in the `shopify.app.toml` file.  This approach is easier since Shopify will automatically update changes to webhook subscriptions every time you run `deploy` (e.g: `npm run deploy`).  Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?framework=remix&deliveryMethod=https)

If you do need shop-specific webhooks, please keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, you can uninstall and reinstall it in your development store. That will force the OAuth process and call the `afterAuth` hook.

### Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.  There are 2 solutions:

1. Use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead (recommended)
2. Create [webhook subscriptions](https://shopify.dev/docs/api/shopify-app-remix/v1/guide-webhooks) using the `shopifyApp` object.

Test your webhooks with the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger) or by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for VS Code will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

in this situation, please update the [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-remix/blob/main/.graphqlrc.ts) config.

### First parameter has member 'readable' that is not a ReadableStream.

See [hosting on Vercel](#hosting-on-vercel).

### Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Using Defer & await for streaming responses

To test [streaming using defer/await](https://remix.run/docs/en/main/guides/streaming) during local development you'll need to use the Shopify CLI slightly differently:

1. First setup ngrok: https://ngrok.com/product/secure-tunnels
2. Create an ngrok tunnel on port 8080: `ngrok http 8080`.
3. Copy the forwarding address. This should be something like: `https://f355-2607-fea8-bb5c-8700-7972-d2b5-3f2b-94ab.ngrok-free.app`
4. In a separate terminal run `yarn shopify app dev --tunnel-url=TUNNEL_URL:8080` replacing `TUNNEL_URL` for the address you copied in step 3.

By default the CLI uses a cloudflare tunnel. Unfortunately it cloudflare tunnels wait for the Response stream to finish, then sends one chunk.

This will not affect production, since tunnels are only for local development.

### Using MongoDB and Prisma

By default this template uses SQLlite as the database. It is recommended to move to a persisted database for production. If you choose to use MongoDB, you will need to make some modifications to the schema and prisma configuration. For more information please see the [Prisma MongoDB documentation](https://www.prisma.io/docs/orm/overview/databases/mongodb).

Alternatively you can use a MongDB database directly with the [MongoDB session storage adapter](https://github.com/Shopify/shopify-app-js/tree/main/packages/apps/session-storage/shopify-app-session-storage-mongodb).

#### Mapping the id field

In MongoDB, an ID must be a single field that defines an @id attribute and a @map("\_id") attribute.
The prisma adapter expects the ID field to be the ID of the session, and not the \_id field of the document.

To make this work you can add a new field to the schema that maps the \_id field to the id field. For more information see the [Prisma documentation](https://www.prisma.io/docs/orm/prisma-schema/data-model/models#defining-an-id-field)

```prisma
model Session {
  session_id  String    @id @default(auto()) @map("_id") @db.ObjectId
  id          String    @unique
...
}
```

#### Error: The "mongodb" provider is not supported with this command

MongoDB does not support the [prisma migrate](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/overview) command. Instead, you can use the [prisma db push](https://www.prisma.io/docs/orm/reference/prisma-cli-reference#db-push) command and update the `shopify.web.toml` file with the following commands. If you are using MongoDB please see the [Prisma documentation](https://www.prisma.io/docs/orm/overview/databases/mongodb) for more information.

```toml
[commands]
predev = "npx prisma generate && npx prisma db push"
dev = "npm exec remix vite:dev"
```

#### Prisma needs to perform transactions, which requires your mongodb server to be run as a replica set

See the [Prisma documentation](https://www.prisma.io/docs/getting-started/setup-prisma/start-from-scratch/mongodb/connect-your-database-node-mongodb) for connecting to a MongoDB database.

### I want to use Polaris v13.0.0 or higher

Currently, this template is set up to work on node v18.20 or higher. However, `@shopify/polaris` is limited to v12 because v13 can only run on node v20+.

You don't have to make any changes to the code in order to be able to upgrade Polaris to v13, but you'll need to do the following:

- Upgrade your node version to v20.10 or higher.
- Update your `Dockerfile` to pull `FROM node:20-alpine` instead of `node:18-alpine`

### "nbf" claim timestamp check failed

This error will occur of the `nbf` claim timestamp check failed. This is because the JWT token is expired.
If you  are consistently getting this error, it could be that the clock on your machine is not in sync with the server.

To fix this ensure you have enabled `Set time and date automatically` in the `Date and Time` settings on your computer.

## Benefits

Shopify apps are built on a variety of Shopify tools to create a great merchant experience.

<!-- TODO: Uncomment this after we've updated the docs -->
<!-- The [create an app](https://shopify.dev/docs/apps/getting-started/create) tutorial in our developer documentation will guide you through creating a Shopify app using this template. -->

The Remix app template comes with the following out-of-the-box functionality:

- [OAuth](https://github.com/Shopify/shopify-app-js/tree/main/packages/shopify-app-remix#authenticating-admin-requests): Installing the app and granting permissions
- [GraphQL Admin API](https://github.com/Shopify/shopify-app-js/tree/main/packages/shopify-app-remix#using-the-shopify-admin-graphql-api): Querying or mutating Shopify admin data
- [Webhooks](https://github.com/Shopify/shopify-app-js/tree/main/packages/shopify-app-remix#authenticating-webhook-requests): Callbacks sent by Shopify when certain events occur
- [AppBridge](https://shopify.dev/docs/api/app-bridge): This template uses the next generation of the Shopify App Bridge library which works in unison with previous versions.
- [Polaris](https://polaris.shopify.com/): Design system that enables apps to create Shopify-like experiences

## Tech Stack

This template uses [Remix](https://remix.run). The following Shopify tools are also included to ease app development:

- [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix) provides authentication and methods for interacting with Shopify APIs.
- [Shopify App Bridge](https://shopify.dev/docs/apps/tools/app-bridge) allows your app to seamlessly integrate your app within Shopify's Admin.
- [Polaris React](https://polaris.shopify.com/) is a powerful design system and component library that helps developers build high quality, consistent experiences for Shopify merchants.
- [Webhooks](https://github.com/Shopify/shopify-app-js/tree/main/packages/shopify-app-remix#authenticating-webhook-requests): Callbacks sent by Shopify when certain events occur
- [Polaris](https://polaris.shopify.com/): Design system that enables apps to create Shopify-like experiences

## Resources

- [Remix Docs](https://remix.run/docs/en/v1)
- [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix)
- [Introduction to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [App authentication](https://shopify.dev/docs/apps/auth)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)
- [Getting started with internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
