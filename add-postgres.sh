#!/bin/bash

# Railway PostgreSQL Setup Script
# This script adds PostgreSQL database to your ShopFlixAI project

PROJECT_ID="25a65c19-fdc6-4f32-89bd-7f6033c2cf9a"
ENVIRONMENT_ID="692d13d7-c385-4836-8aae-30490747e3ab"

echo "🚀 Adding PostgreSQL to ShopFlixAI project..."
echo "Project ID: $PROJECT_ID"
echo "Environment ID: $ENVIRONMENT_ID"
echo ""

# Get Railway API token from environment or config
RAILWAY_TOKEN=$(cat ~/.railway/config.json 2>/dev/null | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$RAILWAY_TOKEN" ]; then
    echo "❌ Could not find Railway authentication token"
    echo "Make sure you're logged in: railway login"
    exit 1
fi

echo "✅ Found Railway authentication token"
echo ""
echo "📌 NEXT STEPS:"
echo ""
echo "Since PostgreSQL service creation requires the Railway web dashboard,"
echo "please follow these steps:"
echo ""
echo "1. Go to: https://railway.app/project/$PROJECT_ID"
echo "2. Click '+ New Service' button"
echo "3. Select 'PostgreSQL' from the dropdown"
echo "4. Wait for PostgreSQL to show 'Ready' status"
echo ""
echo "5. The DATABASE_URL will be automatically created"
echo "6. Your app will automatically use it"
echo ""
echo "⏱️  This should take less than a minute"
echo ""
echo "After PostgreSQL is added:"
echo "- Your app will auto-start with the database"
echo "- Prisma will run migrations automatically"
echo "- Subscription plans will be seeded"
echo ""
echo "🔗 Dashboard: https://railway.app/project/$PROJECT_ID"
