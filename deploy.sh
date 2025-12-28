#!/bin/bash

# ShopFlix AI - One-Click Deployment Script
# This script automates the deployment process

set -e

echo "🚀 ShopFlix AI - Deployment Script"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Pre-deployment checks
echo "${YELLOW}Step 1: Pre-deployment Checks${NC}"
echo "Checking Node.js version..."
node --version

echo "Checking Shopify CLI..."
shopify version || { echo "${RED}Shopify CLI not installed. Install with: npm install -g @shopify/cli${NC}"; exit 1; }

# Step 2: Clean build
echo ""
echo "${YELLOW}Step 2: Building App${NC}"
echo "Installing dependencies..."
npm install

echo "Running type checks..."
npx tsc --noEmit || { echo "${RED}TypeScript errors found!${NC}"; exit 1; }

echo "Building for production..."
npm run build || { echo "${RED}Build failed!${NC}"; exit 1; }

echo "${GREEN}✓ Build successful${NC}"

# Step 3: Verify assets
echo ""
echo "${YELLOW}Step 3: Verifying Assets${NC}"

if [ -f "public/ShopFlixAI.mp4" ]; then
    SIZE=$(ls -lh public/ShopFlixAI.mp4 | awk '{print $5}')
    echo "${GREEN}✓ Video file found (${SIZE})${NC}"
else
    echo "${RED}✗ Video file not found in public/ShopFlixAI.mp4${NC}"
    exit 1
fi

if [ -d "Screenshots" ]; then
    COUNT=$(ls -1 Screenshots/*.png 2>/dev/null | wc -l)
    echo "${GREEN}✓ Screenshots found (${COUNT} files)${NC}"
else
    echo "${YELLOW}⚠ No Screenshots directory found${NC}"
fi

# Step 4: Database preparation
echo ""
echo "${YELLOW}Step 4: Database Preparation${NC}"

if [ -f ".env" ]; then
    echo "${GREEN}✓ .env file found${NC}"
else
    echo "${YELLOW}⚠ .env file not found. Please create one with required variables.${NC}"
    echo "  Required variables:"
    echo "  - SHOPIFY_API_KEY"
    echo "  - SHOPIFY_API_SECRET"
    echo "  - SHOPIFY_APP_URL"
    echo "  - SESSION_SECRET"
fi

echo "Applying database migrations..."
npx prisma migrate deploy || { echo "${RED}Migration failed!${NC}"; exit 1; }

echo "${GREEN}✓ Database ready${NC}"

# Step 5: Deploy
echo ""
echo "${YELLOW}Step 5: Deploying to Shopify${NC}"
echo ""
echo "Ready to deploy! Choose your deployment method:"
echo ""
echo "1. Deploy to Shopify Hosting (Recommended)"
echo "   Command: shopify app deploy"
echo ""
echo "2. Deploy to Custom Server"
echo "   Command: npm start"
echo ""

read -p "Enter your choice (1 or 2): " choice

case $choice in
    1)
        echo "Starting Shopify deployment..."
        shopify app deploy
        echo "${GREEN}✓ App deployed to Shopify!${NC}"
        ;;
    2)
        echo "Starting local production server..."
        export NODE_ENV=production
        npm start
        ;;
    *)
        echo "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo "${GREEN}✓ Deployment complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Visit Shopify Partner Dashboard"
echo "2. Configure your app listing"
echo "3. Add screenshots and descriptions"
echo "4. Set pricing tiers"
echo "5. Submit for review (if publishing to App Store)"
echo ""
echo "For detailed instructions, see: DEPLOYMENT_GUIDE.md"
