#!/bin/sh
set -e

echo "Database location: /tmp/prod.db"

echo "Applying Prisma schema to database..."
npx prisma db push --force-reset --skip-generate --accept-data-loss

echo "Database schema applied successfully"

echo "Starting application..."
exec PORT=${PORT:-3000} HOST=0.0.0.0 npm start
