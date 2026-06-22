import sharp from "sharp";
import { writeFileSync } from "fs";

/**
 * Genereert de favicon-set uit het OFFICIËLE vierkante GENTS-logo (zwarte
 * achtergrond, wit "GENTS — SUITS YOU"), ongewijzigd. Next.js App Router pikt
 * app/favicon.ico, app/icon.png en app/apple-icon.png automatisch op.
 *   node scripts/make-favicon.mjs
 */
const SRC = "public/brand/brand-logo-vierkant.png";

// Officieel logo, alleen STRAKKER GEFRAMED (zwarte marge weg, woordmerk ongewijzigd
// en compleet): trim de zwarte rand → her-pad naar vierkant met een kleine marge,
// zodat "GENTS — SUITS YOU" de tegel goed vult op klein formaat.
const flat = await sharp(SRC).flatten({ background: "#000000" }).toBuffer();
const trimmed = await sharp(flat).trim({ threshold: 12 }).toBuffer();
const tm = await sharp(trimmed).metadata();
const side = Math.round(Math.max(tm.width, tm.height) * 1.14); // ~7% marge rondom
const left = Math.round((side - tm.width) / 2);
const top = Math.round((side - tm.height) / 2);
const square = await sharp(trimmed)
  .extend({ top, bottom: side - tm.height - top, left, right: side - tm.width - left, background: "#000000" })
  .png()
  .toBuffer();
const prep = () => sharp(square);

// Moderne PNG-iconen (Next linkt + serveert ze).
await prep().resize(512, 512, { fit: "cover" }).png().toFile("app/icon.png");
await prep().resize(180, 180, { fit: "cover" }).png().toFile("app/apple-icon.png");

// Klassieke favicon.ico met 16/32/48 (PNG-embedded — door alle moderne browsers ondersteund).
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await prep().resize(s, s, { fit: "cover" }).png().toBuffer());

const count = sizes.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(count, 4);
const entries = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
pngs.forEach((buf, i) => {
  const e = i * 16;
  entries.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e + 0); // width
  entries.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e + 1); // height
  entries.writeUInt8(0, e + 2); // palette
  entries.writeUInt8(0, e + 3); // reserved
  entries.writeUInt16LE(1, e + 4); // color planes
  entries.writeUInt16LE(32, e + 6); // bits per pixel
  entries.writeUInt32LE(buf.length, e + 8); // size of data
  entries.writeUInt32LE(offset, e + 12); // offset of data
  offset += buf.length;
});
const ico = Buffer.concat([header, entries, ...pngs]);
writeFileSync("app/favicon.ico", ico);
console.log(`✓ app/favicon.ico (${ico.length}b, 16/32/48) + app/icon.png (512) + app/apple-icon.png (180)`);
