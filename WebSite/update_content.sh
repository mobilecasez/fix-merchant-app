#!/bin/bash

# Backup original
cp index.html index.html.backup

# Update hero section
sed -i '' 's/Make Business Easy With Beam\./AI-Powered Google Merchant Center Optimization for Shopify/g' index.html
sed -i '' 's/Donec quam felis, ultricies nec, pellentesque eu, pretium quis sem\./Fix product errors, optimize listings, and boost your Google Shopping performance with intelligent AI automation. Get approved faster and sell more./g' index.html
sed -i '' 's/Download Now/Install App - Free Trial/g' index.html
sed -i '' 's/alt="macbook"/alt="ShopFlix AI Dashboard"/g' index.html

echo "Content updated successfully!"
