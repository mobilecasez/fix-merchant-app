#!/bin/sh
set -e

echo "Creating database directory with proper permissions..."
mkdir -p /app/prisma
chmod -R 777 /app/prisma

echo "Applying Prisma schema (SQLite)..."
npx prisma db push --skip-generate

echo "Starting application..."
exec PORT=${PORT:-3000} HOST=0.0.0.0 npm start
