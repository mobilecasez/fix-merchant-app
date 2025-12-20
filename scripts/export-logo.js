import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const input = path.join(__dirname, "..", "public", "logo-ai-modern-alt-1200.svg");
const output = path.join(__dirname, "..", "public", "logo-ai-modern-alt-1200.png");

async function main() {
  console.log("Exporting SVG to PNG...");
  await sharp(input, { density: 384 }) // increase density for crisp rasterization
    .resize(1200, 1200)
    .png({ quality: 95 })
    .toFile(output);
  console.log("Done:", output);
}

main().catch((err) => {
  console.error("Export failed", err);
  process.exit(1);
});
