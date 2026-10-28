// Makes downloaded .glb models light enough for a laptop browser:
// weld + simplify to a triangle budget, textures resized to ≤1024 px (WebP),
// unused data pruned, geometry Draco-compressed. Runs once per file.
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, draco, flatten, join, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import sharp from "sharp";

let ioPromise;
function getIO() {
  ioPromise ||= (async () => {
    await MeshoptSimplifier.ready;
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });
  })();
  return ioPromise;
}

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices(), pos = p.getAttribute("POSITION");
    n += (idx ? idx.getCount() : pos?.getCount() || 0) / 3;
  }
  return Math.round(n);
}

// Venues: keep architecture accurate (low error), allow more triangles and
// sharper textures, and keep the uploaded original next to it.
// No simplification: architecture is made of many small meshes that
// simplification destroys. Instead, merge meshes that share a material
// (thousands of draw calls -> dozens), which is what makes big venues smooth.
export const VENUE_OPTIONS = { simplifyGeometry: false, merge: true, maxTexture: 2048, keepOriginal: true };

// Scene helpers that Blender hides at render time but a browser would draw as
// solid boxes: fire/smoke simulation domains, colliders, bounding/proxy boxes.
const HELPER_NAME = /^(domain|smoke|fluid|flow|effector|collider|collision|bounds?|bbox|bounding|proxy|ucx_|ubx_|ucp_|usp_)/i;
const HELPER_MATERIAL = /(flame|smoke|fire|volume|domain)/i;

export function stripHelpers(doc) {
  const removed = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const prims = mesh.listPrimitives();
    const tris = prims.reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")?.getCount() ?? 0) / 3, 0);
    const named = HELPER_NAME.test(node.getName()) || HELPER_NAME.test(mesh.getName());
    const volumeBox = tris <= 24 && prims.every((p) => HELPER_MATERIAL.test(p.getMaterial()?.getName() || ""));
    if (named || volumeBox) { removed.push(node.getName() || mesh.getName()); node.setMesh(null); }
  }
  return removed;
}

// Strip helpers from an already optimised file (in place); returns what was removed.
export async function cleanGlb(file) {
  const io = await getIO();
  const doc = await io.read(file);
  const removed = stripHelpers(doc);
  if (removed.length) { await doc.transform(prune()); await io.write(file, doc); }
  return removed;
}

export async function optimizeGlb(file, { maxTriangles = 20000, maxTexture = 1024, error = 0.05, keepOriginal = false, simplifyGeometry = true, merge = false, geometryOnly = false } = {}) {
  const marker = `${file}.opt`;
  if (!file.endsWith(".glb") || fs.existsSync(marker)) return { skipped: true };
  const before = fs.statSync(file).size;
  if (keepOriginal && !fs.existsSync(`${file}.orig`)) fs.copyFileSync(file, `${file}.orig`);
  const io = await getIO();
  const doc = await io.read(file);
  stripHelpers(doc);
  // geometry only (glassware drawn in its own material): texture seams would stop the vertices welding, and nothing could be simplified
  if (geometryOnly) for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) for (const sem of p.listSemantics()) if (sem !== "POSITION" && sem !== "NORMAL") p.setAttribute(sem, null);
  const trisBefore = triangles(doc);
  const ratio = Math.min(1, maxTriangles / Math.max(1, trisBefore));
  const steps = [dedup(), weld(geometryOnly ? { tolerance: 0.0005 } : {})];
  if (merge) steps.push(flatten(), join());
  if (simplifyGeometry && ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
  steps.push(prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [maxTexture, maxTexture] }), draco());
  await doc.transform(...steps);
  await io.write(file, doc);
  fs.writeFileSync(marker, JSON.stringify({ trisBefore, trisAfter: triangles(doc), bytesBefore: before, bytesAfter: fs.statSync(file).size }));
  return JSON.parse(fs.readFileSync(marker, "utf8"));
}

/** Real-world size of a model [w, h, d] in metres (files authored in cm/mm are scaled down). */
export async function measureGlb(file) {
  const { getBounds } = await import("@gltf-transform/core");
  const io = await getIO();
  const doc = await io.read(file);
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  if (!scene) return null;
  const { min, max } = getBounds(scene);
  const s = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (!s.every(Number.isFinite)) return null;
  const big = Math.max(...s), k = big > 300 ? 0.01 : big > 30 ? 0.1 : 1;
  return s.map((v) => Math.max(0.05, Math.round(v * k * 100) / 100));
}

// ---------- colours lost in export ----------
// Models built with Blender shader nodes often export their main material as
// plain white with no texture (the colour lived in the node graph). The model's
// own thumbnail still shows it: the main plain-white material takes the
// thumbnail's dominant colour; other plain ones take a colour named in their
// material (or the model's) name. Real white surfaces ("white", glass, metal…) stay.
const NAMED = { yellow: "#E8B92E", mustard: "#C9A227", orange: "#E07B2A", red: "#B3263A", burgundy: "#7A1E2C", pink: "#E7A3B4", blush: "#F0C9CF", purple: "#6E3FB0", blue: "#2D6FD8", navy: "#1B2538", teal: "#127A7A", green: "#2F7D4F", emerald: "#1E7A5A", olive: "#6B6B2E", brown: "#6B4226", tan: "#C19A6B", beige: "#D8C7A6", cream: "#EFE3C8", ivory: "#F3EBDD", grey: "#8A9099", gray: "#8A9099", black: "#1B1B1F", gold: "#C9A227", silver: "#C0C4CA" };
const KEEP_WHITE = /white|wei(ss|ß)|glass?|chrome|metal|mirror|spiegel|steel|light|emit|ceramic|porcelain|marble|candle|kerze|docht|wick|wax|cloth|linen|napkin|paper|plate|snow/i;
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** The dominant real colour of an image (ignoring white backdrops, greys and shadows), or null. */
export async function dominantColour(url) {
  try {
    const res = await fetch(url); if (!res.ok) return null;
    const { data } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().resize(48, 48, { fit: "cover" }).raw().toBuffer({ resolveWithObject: true });
    const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max ? (max - min) / max : 0;
      if (sat < 0.25 || max < 0.15 || max > 0.985 && sat < 0.35) continue;
      let h = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min); h = ((h * 60) + 360) % 360;
      const bin = bins[Math.floor(h / 15) % 24], w = sat * max;
      bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
    }
    const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
    if (best.w < 8) return null; // hardly any colour: a white or grey model really is
    return [best.r / best.w, best.g / best.w, best.b / best.w];
  } catch { return null; }
}

/** Give plain-white, untextured materials their real colour back. Returns what changed. */
export async function restoreColours(file, { name = "", thumbnail = null } = {}) {
  const io = await getIO();
  const doc = await io.read(file);
  const plain = doc.getRoot().listMaterials().filter((m) => !m.getBaseColorTexture() && m.getBaseColorFactor().slice(0, 3).every((v) => v > 0.93) && !KEEP_WHITE.test(m.getName() || ""));
  if (!plain.length) return [];
  // the thumbnail's colour belongs to the model's main material — the one covering the most triangles of all —
  // and only when that one is plain (so a second run never paints the legs or trim)
  const tris = new Map();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { const mt = p.getMaterial(); if (mt) tris.set(mt, (tris.get(mt) || 0) + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")?.getCount() ?? 0) / 3); }
  const top = [...tris.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const main = plain.includes(top) ? top : null;
  const fromThumb = thumbnail ? await dominantColour(thumbnail) : null;
  const word = (t) => Object.keys(NAMED).find((k) => new RegExp(`\b${k}\b`, "i").test(t || ""));
  const changed = [];
  for (const m of plain) {
    const named = word(m.getName()) || (m === main ? word(name) : null);
    const srgb = m === main && fromThumb ? fromThumb : named ? hexRgb(NAMED[named]) : null;
    if (!srgb) continue;
    const a = m.getBaseColorFactor()[3];
    m.setBaseColorFactor([...srgb.map(toLinear), a]);
    changed.push(`${m.getName() || "material"} → ${m === main && fromThumb ? "thumbnail colour" : named}`);
  }
  if (changed.length) await io.write(file, doc);
  return changed;
}

// ---------- foliage exported as solid cards ----------
// Many plants arrive with their leaves on flat cards whose cut-out was lost in
// export (no alpha, so the card's background shows) and with a baked roughness
// near zero (so every card is a black mirror). The leaf is cut back out of its
// card — the card's background colour, read from the texture's border, becomes
// transparent — and leaves get the soft, matte finish real foliage has.
const FOLIAGE = /leaf|leaves|foliage|plant|monstera|palm|fern|tree|bush|shrub|ivy|grass|flower|petal|bloom|frond|areca|ficus|eucalyptus|branch|twig|moss|succulent|orchid|rose|lily|dahlia|hydrangea|utescens|bouquet/i;
async function cutOut(imageBytes) {
  const { data, info } = await sharp(Buffer.from(imageBytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info, at = (x, y) => (y * W + x) * 4;
  // the card's background: the commonest colour along the texture's border
  const counts = new Map();
  const add = (x, y) => { const i = at(x, y), k = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`; counts.set(k, (counts.get(k) || 0) + 1); };
  for (let x = 0; x < W; x += 2) { add(x, 0); add(x, H - 1); }
  for (let y = 0; y < H; y += 2) { add(0, y); add(W - 1, y); }
  const [bg, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n < (W + H) * 0.35) return null; // no uniform background: this texture isn't a leaf card
  const [br, bgc, bb] = bg.split(",").map((v) => Number(v) * 16 + 8);
  let cleared = 0;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - br, data[i + 1] - bgc, data[i + 2] - bb);
    const a = d < 26 ? 0 : d < 48 ? Math.round(((d - 26) / 22) * 255) : 255; // a soft edge, cut at 50 %
    if (a < 128) cleared++;
    data[i + 3] = Math.min(data[i + 3], a);
  }
  if (cleared < data.length / 4 * 0.08 || cleared > data.length / 4 * 0.85) return null; // barely any background, or nearly all of it: not a leaf card
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** Cut leaves out of their cards and give foliage a matte finish. Returns what changed. */
export async function fixFoliage(file, { name = "" } = {}) {
  const io = await getIO();
  const doc = await io.read(file);
  const plantModel = FOLIAGE.test(name), changed = [];
  for (const m of doc.getRoot().listMaterials()) {
    const label = m.getName() || "";
    if (!FOLIAGE.test(label) && !(plantModel && /baked|material|plane|card/i.test(label))) continue;
    if (/pot|soil|stone|wood|metal|vase|planter|tanah|ground|earth|rock|cylinder/i.test(label)) continue; // the pot and its soil stay as they are
    const tex = m.getBaseColorTexture();
    if (tex && m.getAlphaMode() === "OPAQUE") {
      const png = await cutOut(tex.getImage()).catch(() => null);
      if (png) { tex.setImage(new Uint8Array(png)).setMimeType("image/png"); m.setAlphaMode("MASK").setAlphaCutoff(0.5); changed.push(`${label}: leaves cut out`); }
    }
    // a near-mirror bake on a leaf: matte, non-metallic, as real leaves are
    m.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.62).setDoubleSided(true);
    changed.push(`${label}: matte foliage`);
  }
  if (changed.length) await io.write(file, doc);
  return changed;
}
