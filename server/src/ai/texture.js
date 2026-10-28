// Materials the stock libraries don't have ("red Maasai shuka check", "gold kente
// weave"): Nano Banana paints a flat swatch, which is made seamless (the tile is
// offset by half and feathered over itself, so its edges meet its own middle),
// given a normal map from its detail, and stored like a Poly Haven material —
// so dragging, the inspector and the agent use it the same way.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { ensureDir, publicUrl } from "../files.js";
import { generateTexture } from "./images.js";

const SIZE = 1024;
const SOFT = /fabric|cloth|linen|cotton|silk|satin|velvet|wool|weave|woven|check|tartan|plaid|shuka|kente|kitenge|ankara|lace|knit|felt|jute|hessian|denim|leather|rug|carpet/i;

async function seamless(png) {
  const { data } = await sharp(png).removeAlpha().resize(SIZE, SIZE, { fit: "cover" }).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length), h = SIZE / 2, feather = SIZE * 0.09; // a narrow blend: little ghosting of the pattern
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    // weight of the original: 1 in the middle, fading to 0 near the edges, where the half-offset copy takes over
    const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y), t = Math.min(1, edge / feather), w = t * t * (3 - 2 * t);
    const i = (y * SIZE + x) * 3, j = (((y + h) % SIZE) * SIZE + ((x + h) % SIZE)) * 3;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(data[i + c] * w + data[j + c] * (1 - w));
  }
  return out;
}

// gentle relief from brightness (a weave reads as raised threads)
function normalMap(rgb, strength = 2.2) {
  const lum = new Float32Array(SIZE * SIZE), n = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) lum[i] = (0.3 * rgb[i * 3] + 0.59 * rgb[i * 3 + 1] + 0.11 * rgb[i * 3 + 2]) / 255;
  const at = (x, y) => lum[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength, len = Math.hypot(dx, dy, 1), i = (y * SIZE + x) * 3;
    n[i] = Math.round((-dx / len * 0.5 + 0.5) * 255); n[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255); n[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
  }
  return n;
}

/** Paint, tile and store a material from words; returns it like mirrorMaterial does. */
export async function generateMaterial(prompt) {
  const words = String(prompt || "").trim().slice(0, 160);
  if (!words) throw Object.assign(new Error("Describe the material."), { status: 400 });
  const img = await generateTexture(words);
  const rgb = await seamless(Buffer.from(img.base64, "base64"));
  const slug = `ai-${words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${crypto.randomBytes(3).toString("hex")}`;
  const dir = ensureDir(`materials/${slug}`), raw = { raw: { width: SIZE, height: SIZE, channels: 3 } };
  await sharp(rgb, raw).jpeg({ quality: 90 }).toFile(path.join(dir, "color.jpg"));
  await sharp(normalMap(rgb), raw).jpeg({ quality: 92 }).toFile(path.join(dir, "normal.jpg"));
  await sharp(rgb, raw).resize(256, 256).jpeg({ quality: 85 }).toFile(path.join(dir, "thumb.jpg"));
  // a woven fabric repeats every ~60 cm; boards, stone and the rest every ~1.5 m
  const meta = { slug, name: words.replace(/^./, (c) => c.toUpperCase()), sizeM: SOFT.test(words) ? 0.6 : 1.5, prompt: words, ai: true, at: Date.now() };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  return described(slug, meta);
}

const described = (slug, meta) => ({
  slug, name: meta.name, thumb: publicUrl(`materials/${slug}`, "thumb.jpg"), sizeM: meta.sizeM, ai: true,
  maps: { color: publicUrl(`materials/${slug}`, "color.jpg"), normal: publicUrl(`materials/${slug}`, "normal.jpg") },
});

/** A stored AI material by slug (null if it isn't one). */
export function aiMaterial(slug) {
  if (!String(slug).startsWith("ai-")) return null;
  const file = path.join(ensureDir(`materials/${slug}`), "meta.json");
  if (!fs.existsSync(file)) return null;
  return described(slug, JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Every AI material made so far, newest first. */
export function aiMaterials() {
  const root = ensureDir("materials");
  return fs.readdirSync(root).filter((d) => d.startsWith("ai-")).map(aiMaterial).filter(Boolean)
    .sort((a, b) => (fs.statSync(path.join(root, b.slug)).mtimeMs - fs.statSync(path.join(root, a.slug)).mtimeMs));
}
