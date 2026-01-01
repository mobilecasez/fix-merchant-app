#!/bin/sh
set -e

echo "=== Starting ShopFlix AI ==="
echo "Database: /tmp/prod.db"

echo "=== Step 1: Creating database schema ==="
npx prisma db push --force-reset --skip-generate --accept-data-loss

echo "=== Step 2: Waiting for database to be ready ==="
sleep 5

echo "=== Step 3: Starting application ==="
PORT=${PORT:-3000} HOST=0.0.0.0 npm start
