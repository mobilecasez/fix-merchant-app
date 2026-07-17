// Rasterize hero SVGs -> sibling PNGs (1200x630) for social og:image cards.
// Usage: node rasterize.mjs <file1.svg> <file2.svg> ...
import sharp from "sharp";
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) { console.error("no svg files given"); process.exit(1); }

for (const f of files) {
  const png = f.replace(/\.svg$/, ".png");
  try {
    const buf = readFileSync(f);
    await sharp(buf, { density: 160 })
      .resize(1200, 630, { fit: "fill" })
      .png({ quality: 90 })
      .toFile(png);
    console.log("wrote", png);
  } catch (e) {
    console.error("FAILED", f, e.message);
    process.exitCode = 1;
  }
}
