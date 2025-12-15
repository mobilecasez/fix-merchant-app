#!/usr/bin/env node

/**
 * Generate secure environment variables for production
 * Run: node generate-secure-env.js
 */

const crypto = require('crypto');

console.log('\n🔐 Secure Environment Variable Generator\n');
console.log('=========================================\n');

// Generate encryption string
const encryptionString = crypto.randomBytes(32).toString('base64');
console.log('ENCRYPTION_STRING:');
console.log(encryptionString);
console.log('\n');

// Generate session secret
const sessionSecret = crypto.randomBytes(32).toString('hex');
console.log('SESSION_SECRET (if needed):');
console.log(sessionSecret);
console.log('\n');

// Generate API key (example)
const apiKey = crypto.randomBytes(16).toString('hex');
console.log('INTERNAL_API_KEY (for cron jobs or webhooks):');
console.log(apiKey);
console.log('\n');

console.log('=========================================');
console.log('⚠️  IMPORTANT SECURITY NOTES:');
console.log('=========================================\n');
console.log('1. Store these values securely (password manager)');
console.log('2. Never commit these to version control');
console.log('3. Use different values for dev/staging/production');
console.log('4. Rotate these values every 90 days');
console.log('5. Set them as environment variables, not in code\n');

console.log('📝 To set in your hosting platform:\n');
console.log('Railway:');
console.log('  railway variables set ENCRYPTION_STRING="' + encryptionString + '"\n');
console.log('Heroku:');
console.log('  heroku config:set ENCRYPTION_STRING="' + encryptionString + '"\n');
console.log('Fly.io:');
console.log('  fly secrets set ENCRYPTION_STRING="' + encryptionString + '"\n');

// Generate example .env
console.log('=========================================');
console.log('📋 Add to your .env file:');
console.log('=========================================\n');
console.log(`ENCRYPTION_STRING=${encryptionString}`);
console.log(`SESSION_SECRET=${sessionSecret}`);
console.log(`INTERNAL_API_KEY=${apiKey}`);
console.log('\n');
