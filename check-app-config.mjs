/**
 * CHECK APP CONFIGURATION
 * This script checks the actual configuration in Shopify Partner Dashboard
 */

const CLIENT_ID = "85d12decc346b5ec3cdfebacdce7f290";
const APP_URL = "https://shopflixai-production.up.railway.app";

console.log("🔍 Checking Production App Configuration\n");

console.log("Expected Configuration:");
console.log("─".repeat(50));
console.log(`Client ID: ${CLIENT_ID}`);
console.log(`App URL: ${APP_URL}`);
console.log(`\nExpected Redirect URLs:`);
console.log(`  1. ${APP_URL}/auth/callback`);
console.log(`  2. ${APP_URL}/auth/shopify/callback`);
console.log(`  3. ${APP_URL}/api/auth/callback`);
console.log(`\nExpected Scopes: read_products, write_products`);
console.log(`Embedded: true`);

console.log("\n" + "─".repeat(50));
console.log("\n⚠️  CRITICAL ISSUES FOUND:\n");

console.log("1. Railway Environment Variables:");
console.log("   ❌ Extra SCOPES variable exists (not used in code)");
console.log("   ✓  SHOPIFY_API_KEY matches production client ID");
console.log("   ✓  SHOPIFY_APP_URL matches expected URL");

console.log("\n2. Potential Auth Flow Issues:");
console.log("   - Auth redirects properly (302)");
console.log("   - /auth/exit-iframe returns 200 but empty response");
console.log("   - This suggests OAuth redirect URL mismatch");

console.log("\n3. Things to Verify in Partner Dashboard:");
console.log("   [ ] App URL matches: " + APP_URL);
console.log("   [ ] OAuth redirect URLs include all 3 callbacks");
console.log("   [ ] Scopes are: read_products, write_products");
console.log("   [ ] Embedded app is enabled");
console.log("   [ ] Distribution is set to: Shopify App Store");

console.log("\n" + "=".repeat(50));
console.log("🔧 RECOMMENDED FIXES:\n");

console.log("1. Remove obsolete SCOPES environment variable from Railway");
console.log("2. Verify OAuth redirect URLs in Partner Dashboard");
console.log("3. Check if app needs to be reinstalled after config changes");
console.log("4. Clear browser cache and reinstall app");

console.log("\n" + "=".repeat(50));
