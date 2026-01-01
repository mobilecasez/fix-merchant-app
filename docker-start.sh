#!/bin/sh
set -e

echo "Database location: /tmp/prod.db"

echo "Running Prisma migrations..."
npx prisma migrate deploy || {
    echo "Migrate deploy failed, trying db push..."
    npx prisma db push --skip-generate --accept-data-loss
}

echo "Verifying database..."
npx prisma db execute --stdin <<EOF
SELECT name FROM sqlite_master WHERE type='table';
EOF

echo "Starting application..."
exec PORT=${PORT:-3000} HOST=0.0.0.0 npm start
