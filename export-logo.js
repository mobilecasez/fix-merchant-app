#!/usr/bin/env node

/**
 * Export SVG logo to PNG formats
 * Requires: sharp and sharp-svgString
 * 
 * Usage: node export-logo.js
 * 
 * This will create:
 * - logo-1024x1024.png (App Store icon)
 * - logo-512x512.png (Social media)
 * - logo-256x256.png (Web favicon)
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SVG_FILE = path.join(__dirname, "logo-ai-modern-alt.svg");
const SIZES = [
  { width: 1024, height: 1024, name: "logo-1024x1024.png" },
  { width: 512, height: 512, name: "logo-512x512.png" },
  { width: 256, height: 256, name: "logo-256x256.png" },
  { width: 180, height: 180, name: "logo-180x180.png" }, // iOS app icon
  { width: 192, height: 192, name: "logo-192x192.png" }, // Android app icon
];

async function exportLogo() {
  try {
    // Check if SVG exists
    if (!fs.existsSync(SVG_FILE)) {
      console.error(`❌ SVG file not found: ${SVG_FILE}`);
      process.exit(1);
    }

    console.log("🎨 Exporting logo to PNG formats...\n");

    // Read SVG file
    const svgBuffer = fs.readFileSync(SVG_FILE);

    // Create PNG files for each size
    for (const size of SIZES) {
      const outputPath = path.join(__dirname, size.name);

      await sharp(svgBuffer)
        .resize(size.width, size.height, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 }, // Transparent background
        })
        .png()
        .toFile(outputPath);

      const fileSize = fs.statSync(outputPath).size;
      console.log(
        `✅ Created ${size.name} (${size.width}x${size.height}) - ${(fileSize / 1024).toFixed(2)} KB`
      );
    }

    console.log("\n✨ Export complete!");
    console.log("\n📱 Use these files for:");
    console.log("  • logo-1024x1024.png → Shopify App Store listing");
    console.log("  • logo-512x512.png → Social media & marketing");
    console.log("  • logo-256x256.png → Website favicon");
    console.log("  • logo-180x180.png → iOS app icon");
    console.log("  • logo-192x192.png → Android app icon");
  } catch (error) {
    console.error("❌ Export failed:", error.message);
    process.exit(1);
  }
}

exportLogo();
