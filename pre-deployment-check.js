#!/usr/bin/env node

/**
 * Pre-Deployment Validation Script
 * Run before deploying to production to catch common issues
 * Usage: node pre-deployment-check.js
 */

const fs = require('fs');
const path = require('path');

console.log('\n🚀 Pre-Deployment Validation\n');
console.log('='.repeat(50) + '\n');

let errors = 0;
let warnings = 0;

// Check if .env file exists
function checkEnvFile() {
  console.log('📄 Checking environment configuration...');
  
  if (!fs.existsSync('.env')) {
    console.log('  ❌ .env file not found');
    console.log('     Create from .env.example: cp .env.example .env');
    errors++;
    return false;
  }
  
  const envContent = fs.readFileSync('.env', 'utf8');
  
  const requiredVars = [
    'SHOPIFY_API_KEY',
    'SHOPIFY_API_SECRET',
    'SHOPIFY_APP_URL',
    'DATABASE_URL',
    'ENCRYPTION_STRING',
    'NODE_ENV'
  ];
  
  const missingVars = requiredVars.filter(v => !envContent.includes(v + '='));
  
  if (missingVars.length > 0) {
    console.log('  ❌ Missing required variables:');
    missingVars.forEach(v => console.log('     - ' + v));
    errors++;
  } else {
    console.log('  ✅ All required variables present');
  }
  
  // Check for placeholder values
  if (envContent.includes('your_') || envContent.includes('your-')) {
    console.log('  ⚠️  Warning: Found placeholder values in .env');
    console.log('     Replace all "your_*" placeholders with actual values');
    warnings++;
  }
  
  // Check NODE_ENV
  if (envContent.includes('NODE_ENV=production')) {
    console.log('  ✅ NODE_ENV set to production');
  } else {
    console.log('  ⚠️  Warning: NODE_ENV not set to production');
    warnings++;
  }
  
  console.log('');
  return true;
}

// Check database configuration
function checkDatabase() {
  console.log('🗄️  Checking database configuration...');
  
  if (!fs.existsSync('prisma/schema.prisma')) {
    console.log('  ❌ Prisma schema not found');
    errors++;
    return;
  }
  
  const envContent = fs.readFileSync('.env', 'utf8');
  
  if (envContent.includes('file:./prisma')) {
    console.log('  ⚠️  Warning: Using SQLite (not recommended for production)');
    console.log('     Switch to PostgreSQL for production');
    warnings++;
  } else if (envContent.includes('postgresql://')) {
    console.log('  ✅ PostgreSQL configured');
  }
  
  // Check if migrations exist
  if (fs.existsSync('prisma/migrations')) {
    const migrations = fs.readdirSync('prisma/migrations');
    console.log(`  ✅ Found ${migrations.length - 1} migrations`);
  }
  
  console.log('');
}

// Check for build artifacts
function checkBuild() {
  console.log('🔨 Checking build configuration...');
  
  if (!fs.existsSync('package.json')) {
    console.log('  ❌ package.json not found');
    errors++;
    return;
  }
  
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  if (!pkg.scripts.build) {
    console.log('  ❌ No build script found');
    errors++;
  } else {
    console.log('  ✅ Build script present');
  }
  
  if (!pkg.scripts.start) {
    console.log('  ❌ No start script found');
    errors++;
  } else {
    console.log('  ✅ Start script present');
  }
  
  console.log('');
}

// Check Shopify configuration
function checkShopifyConfig() {
  console.log('🛍️  Checking Shopify configuration...');
  
  if (!fs.existsSync('shopify.app.toml')) {
    console.log('  ❌ shopify.app.toml not found');
    errors++;
    return;
  }
  
  const config = fs.readFileSync('shopify.app.toml', 'utf8');
  
  if (config.includes('trycloudflare.com')) {
    console.log('  ❌ Still using Cloudflare tunnel URL');
    console.log('     Update application_url to production URL');
    errors++;
  } else if (config.includes('your-production-url')) {
    console.log('  ❌ Placeholder URL in shopify.app.toml');
    console.log('     Update with actual production URL');
    errors++;
  } else {
    console.log('  ✅ Production URL configured');
  }
  
  if (config.includes('redirect_urls')) {
    console.log('  ✅ OAuth redirect URLs configured');
  } else {
    console.log('  ⚠️  Warning: No redirect URLs found');
    warnings++;
  }
  
  console.log('');
}

// Check for sensitive files
function checkSensitiveFiles() {
  console.log('🔒 Checking for sensitive files...');
  
  const sensitiveFiles = ['.env', 'prisma/dev.sqlite', 'node_modules'];
  
  if (!fs.existsSync('.gitignore')) {
    console.log('  ❌ .gitignore not found');
    errors++;
    return;
  }
  
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  
  const missing = sensitiveFiles.filter(f => !gitignore.includes(f));
  
  if (missing.length > 0) {
    console.log('  ⚠️  Warning: Following should be in .gitignore:');
    missing.forEach(f => console.log('     - ' + f));
    warnings++;
  } else {
    console.log('  ✅ Sensitive files properly ignored');
  }
  
  console.log('');
}

// Check for required legal documents
function checkLegalDocuments() {
  console.log('📜 Checking legal documents...');
  
  const required = ['PRIVACY_POLICY.md', 'TERMS_OF_SERVICE.md'];
  const missing = required.filter(f => !fs.existsSync(f));
  
  if (missing.length > 0) {
    console.log('  ❌ Missing required documents:');
    missing.forEach(f => console.log('     - ' + f));
    errors++;
  } else {
    console.log('  ✅ Privacy policy and terms of service present');
  }
  
  console.log('');
}

// Check dependencies
function checkDependencies() {
  console.log('📦 Checking dependencies...');
  
  if (!fs.existsSync('package-lock.json') && !fs.existsSync('yarn.lock')) {
    console.log('  ⚠️  Warning: No lock file found');
    console.log('     Run npm install to generate package-lock.json');
    warnings++;
  } else {
    console.log('  ✅ Dependency lock file present');
  }
  
  console.log('');
}

// Check for AI API keys
function checkAIKeys() {
  console.log('🤖 Checking AI service configuration...');
  
  const envContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  
  if (!envContent.includes('OPENAI_API_KEY') || envContent.includes('OPENAI_API_KEY=your')) {
    console.log('  ⚠️  Warning: OpenAI API key not configured');
    console.log('     AI features will not work');
    warnings++;
  } else {
    console.log('  ✅ OpenAI API key configured');
  }
  
  if (!envContent.includes('GOOGLE_AI_API_KEY') || envContent.includes('GOOGLE_AI_API_KEY=your')) {
    console.log('  ⚠️  Warning: Google AI API key not configured');
    warnings++;
  } else {
    console.log('  ✅ Google AI API key configured');
  }
  
  console.log('');
}

// Run all checks
checkEnvFile();
checkDatabase();
checkBuild();
checkShopifyConfig();
checkSensitiveFiles();
checkLegalDocuments();
checkDependencies();
checkAIKeys();

// Summary
console.log('='.repeat(50));
console.log('\n📊 Validation Summary\n');

if (errors === 0 && warnings === 0) {
  console.log('🎉 All checks passed! Ready for deployment.\n');
  process.exit(0);
} else {
  if (errors > 0) {
    console.log(`❌ ${errors} error(s) found - Must fix before deployment`);
  }
  if (warnings > 0) {
    console.log(`⚠️  ${warnings} warning(s) found - Recommended to fix`);
  }
  console.log('');
  
  if (errors > 0) {
    console.log('Fix all errors before deploying to production.\n');
    process.exit(1);
  } else {
    console.log('Consider fixing warnings for optimal deployment.\n');
    process.exit(0);
  }
}
