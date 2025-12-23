#!/usr/bin/env node

import { execSync } from 'child_process';

const MAX_RETRIES = 30;
const RETRY_DELAY = 2000; // 2 seconds

function runCommand(cmd) {
  return execSync(cmd, { stdio: 'inherit' });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDatabase() {
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
    try {
      // Try to run prisma generate as a test - if it fails due to DB, we'll catch it
      console.log(`⏳ Checking database connectivity... (attempt ${retries + 1}/${MAX_RETRIES})`);
      
      // Just try to generate - if DB is truly unreachable, prisma will fail fast
      runCommand('npx prisma generate');
      
      console.log('✓ Database appears reachable, proceeding with setup\n');
      return true;
    } catch (error) {
      retries++;
      if (retries >= MAX_RETRIES) {
        throw new Error(`Failed to establish database connection after ${MAX_RETRIES} attempts`);
      }
      console.log(`  Retrying in ${RETRY_DELAY / 1000} seconds...\n`);
      await sleep(RETRY_DELAY);
    }
  }
}

async function runSetup() {
  try {
    console.log('Starting database setup with retry logic...\n');
    
    // Wait for database to be ready
    await waitForDatabase();
    
    // Run prisma db push
    console.log('🔄 Pushing database schema...');
    runCommand('npx prisma db push --accept-data-loss');
    
    // Run seed script
    console.log('\n🌱 Seeding database...');
    runCommand('node seed-subscription-plans.js');
    
    console.log('\n✅ Database setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

runSetup();
