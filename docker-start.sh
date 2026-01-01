#!/bin/sh
set -e

echo "=== Starting ShopFlix AI ==="
echo "Database: PostgreSQL"

echo "=== Running Prisma migrations ==="
if npx prisma migrate deploy; then
    echo "✓ Migrations applied successfully"
else
    echo "✗ Migrations failed, trying db push..."
    npx prisma db push --skip-generate --accept-data-loss
fi

echo "=== Starting application ==="
PORT=${PORT:-3000} HOST=0.0.0.0 npm start
