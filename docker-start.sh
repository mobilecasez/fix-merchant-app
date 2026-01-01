#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy --skip-generate

echo "Starting application..."
exec PORT=${PORT:-3000} HOST=0.0.0.0 npm start
