import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const svgPath = path.resolve(__dirname, "..", "public", "favicon.svg");
const publicDir = path.resolve(__dirname, "..", "public");

if (!fs.existsSync(svgPath)) {
  console.error(`favicon.svg not found at ${svgPath}`);
  process.exit(1);
}

const svg = fs.readFileSync(svgPath);

const sizes = [
  { name: "pwa-192x192.png", width: 192, height: 192 },
  { name: "pwa-512x512.png", width: 512, height: 512 },
  { name: "apple-touch-icon.png", width: 180, height: 180 },
  { name: "og-image.png", width: 1200, height: 630 },
];

for (const { name, width, height } of sizes) {
  const out = path.join(publicDir, name);
  await sharp(svg)
    .resize(width, height, { fit: "contain", background: { r: 37, g: 99, b: 235, alpha: 1 } })
    .png()
    .toFile(out);
  console.log(`Generated ${out}`);
}

console.log("PWA icons generated successfully.");
