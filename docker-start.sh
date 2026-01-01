#!/bin/sh
set -e

echo "Database will be created in /tmp (writable location)"

echo "Applying Prisma schema (SQLite)..."
npx prisma db push --skip-generate

echo "Starting application..."
exec PORT=${PORT:-3000} HOST=0.0.0.0 npm start
