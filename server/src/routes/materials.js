// Materials library: Poly Haven PBR textures (CC0) — fabrics, woods, floors,
// tiles and stone, metals, plaster and leather. Browsing lists them (indoor
// event surfaces first); picking one mirrors its 1k colour, normal, roughness
// and AO maps into uploads/materials once, with its real-world tile size.
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { ensureDir, publicUrl } from "../files.js";
import { aiMaterial, aiMaterials, generateMaterial } from "../ai/texture.js";
import { imagesEnabled } from "../ai/images.js";

const POLYHAVEN = "https://api.polyhaven.com";
const UA = { "User-Agent": "NoviraStudio/1.0" };
const PAGE = 48;

/** The groups shown as chips, by Poly Haven category. */
export const GROUPS = {
  fabric: ["fabric", "cotton", "velvet", "satin", "denim", "wool", "fleece", "crepe", "jacquard", "corduroy", "woven", "knitted", "hessian", "suede", "carpet"],
  wood: ["wood"],
  floor: ["floor"],
  stone: ["tiles", "rock", "concrete", "sandstone", "brick", "cobblestone"],
  metal: ["metal"],
  wall: ["wall", "plaster", "plaster-concrete"],
  leather: ["leather", "fur"],
};
const OUTDOORSY = ["aerial", "terrain", "snow", "road", "asphalt", "gravel", "sand", "food", "bark", "roofing"];

const thumb = (id) => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`;
let cache = null, cachedAt = 0;

async function listAll() {
  if (cache && Date.now() - cachedAt < 3600_000) return cache;
  const r = await fetch(`${POLYHAVEN}/assets?t=textures`, { headers: UA });
  if (!r.ok) throw Object.assign(new Error(`Poly Haven is unavailable (${r.status}).`), { status: 502 });
  // indoor event surfaces first (fabric, wood, floors, tiles, metal…), then by popularity
  const score = (a) => (a.categories.some((c) => OUTDOORSY.includes(c)) ? 0 : 1) * 10 + (a.categories.includes("indoor") ? 2 : 0) + (a.categories.some((c) => GROUPS.fabric.includes(c)) ? 1 : 0);
  cache = Object.entries(await r.json()).map(([id, a]) => ({ id, ...a })).sort((a, b) => score(b) - score(a) || (b.download_count || 0) - (a.download_count || 0));
  cachedAt = Date.now();
  return cache;
}

export const materials = Router();

/** Poly Haven textures matching the words, optionally within a group. */
export async function searchMaterials(query = "", groupKey = "") {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean), group = GROUPS[groupKey];
  let list = await listAll();
  if (group) list = list.filter((a) => a.categories.some((c) => group.includes(c)));
  if (words.length) {
    const score = (a) => { const hay = [a.id, a.name, ...(a.tags || []), ...(a.categories || [])].join(" ").toLowerCase(); return words.filter((w) => hay.includes(w)).length; };
    list = list.map((a) => ({ a, s: score(a) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.a);
  }
  return list;
}

// ?q=velvet&group=fabric&cursor=48
materials.get("/", async (req, res) => {
  const start = Number(req.query.cursor) || 0;
  const list = await searchMaterials(req.query.q, req.query.group);
  res.json({
    results: list.slice(start, start + PAGE).map((a) => ({ slug: a.id, name: a.name, thumb: thumb(a.id), categories: a.categories.slice(0, 3), sizeM: a.dimensions ? a.dimensions[0] / 1000 : 2 })),
    next: start + PAGE < list.length ? String(start + PAGE) : null,
  });
});

// Materials painted with AI for things the libraries don't have.
materials.get("/mine", (_req, res) => res.json({ results: aiMaterials() }));
materials.post("/generate", async (req, res) => {
  if (!imagesEnabled()) return res.status(400).json({ error: "Add NANOBANANA_API_KEY (or GEMINI_API_KEY) to server/.env to create materials with AI." });
  try { res.json(await generateMaterial(req.body?.prompt)); }
  catch (e) { res.status(e.status || 502).json({ error: `Couldn't create this material: ${e.message}` }); }
});

// Mirror the 1k maps (once) and describe the material.
materials.post("/:slug", async (req, res) => res.json(await mirrorMaterial(req.params.slug)));

export async function mirrorMaterial(slugIn) {
  const slug = String(slugIn).replace(/[^a-z0-9_-]/gi, "");
  if (!slug) throw Object.assign(new Error("Unknown material."), { status: 400 });
  const mine = aiMaterial(slug);
  if (mine) return mine;
  const dir = ensureDir(`materials/${slug}`), maps = {};
  const want = { color: "Diffuse", normal: "nor_gl", roughness: "Rough", ao: "AO" };
  const have = (k) => fs.existsSync(path.join(dir, `${k}.jpg`));
  if (!Object.keys(want).every((k) => have(k) || k === "ao")) {
    const r = await fetch(`${POLYHAVEN}/files/${slug}`, { headers: UA });
    if (!r.ok) throw Object.assign(new Error(`Poly Haven couldn't list files (${r.status}).`), { status: 502 });
    const files = await r.json();
    for (const [k, key] of Object.entries(want)) {
      const url = files[key]?.["1k"]?.jpg?.url;
      if (!url || have(k)) continue;
      const d = await fetch(url, { headers: UA });
      if (d.ok) fs.writeFileSync(path.join(dir, `${k}.jpg`), Buffer.from(await d.arrayBuffer()));
    }
  }
  for (const k of Object.keys(want)) if (have(k)) maps[k] = publicUrl(`materials/${slug}`, `${k}.jpg`);
  if (!maps.color) throw Object.assign(new Error("This material has no colour map."), { status: 502 });
  const info = (await listAll().catch(() => [])).find((a) => a.id === slug);
  return { slug, name: info?.name || slug, thumb: thumb(slug), maps, sizeM: info?.dimensions ? info.dimensions[0] / 1000 : 2 };
}
