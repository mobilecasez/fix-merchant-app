#!/bin/sh
set -e

echo "=== Starting ShopFlix AI ==="
echo "Database: /tmp/prod.db"

echo "=== Checking Prisma schema ==="
ls -la prisma/schema.prisma

echo "=== Creating database schema ==="
if npx prisma db push --force-reset --skip-generate --accept-data-loss; then
    echo "✓ Database schema created successfully"
else
    echo "✗ Database schema creation failed!"
    exit 1
fi

echo "=== Verifying database file ==="
ls -la /tmp/prod.db || echo "Warning: Database file not found"

echo "=== Waiting for database to stabilize ==="
sleep 3

echo "=== Starting application ==="
PORT=${PORT:-3000} HOST=0.0.0.0 npm start
