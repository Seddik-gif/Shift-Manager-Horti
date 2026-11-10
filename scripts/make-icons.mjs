// Generates the PWA icons from a simple built-in mark (an "H" with a sparkle) using sharp (bundled with Next.js).
// Replace public/brand/horti-magici-logo.png and edit the SVG below if the official logo should be used instead.
//   node scripts/make-icons.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const BG = "#234A49";
const INK = "#F7F2E8";
const GOLD = "#E8B64A";

/** `scale` < 1 keeps the mark inside the safe zone (maskable icons are cropped to a circle on some phones). */
function svg(size, scale) {
  const s = size;
  const u = (s * scale) / 100; // 1 unit of a 100x100 design
  const ox = (s - 100 * u) / 2;
  const oy = (s - 100 * u) / 2;
  const r = (x, y, w, h) => `<rect x="${ox + x * u}" y="${oy + y * u}" width="${w * u}" height="${h * u}" rx="${2 * u}" fill="${INK}"/>`;
  const star = (cx, cy, k) => {
    const x = ox + cx * u, y = oy + cy * u, a = k * u, b = a * 0.28;
    return `<path d="M${x} ${y - a} Q${x + b} ${y - b} ${x + a} ${y} Q${x + b} ${y + b} ${x} ${y + a} Q${x - b} ${y + b} ${x - a} ${y} Q${x - b} ${y - b} ${x} ${y - a}Z" fill="${GOLD}"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" fill="${BG}"/>
    ${r(24, 22, 15, 56)}${r(61, 22, 15, 56)}${r(24, 43, 52, 14)}
    ${star(78, 20, 13)}${star(22, 82, 7)}
  </svg>`;
}

mkdirSync("public/icons", { recursive: true });
const jobs = [
  ["icon-192.png", 192, 0.9],
  ["icon-512.png", 512, 0.9],
  ["icon-maskable-512.png", 512, 0.62],
  ["apple-touch-icon.png", 180, 0.9],
];
for (const [name, size, scale] of jobs) {
  await sharp(Buffer.from(svg(size, scale))).png().toFile(`public/icons/${name}`);
  console.log("wrote public/icons/" + name);
}
// source for the Windows app icons:  cd desktop && npx tauri icon icon-source.png
await sharp(Buffer.from(svg(1024, 0.9))).png().toFile("desktop/icon-source.png");
console.log("wrote desktop/icon-source.png");
