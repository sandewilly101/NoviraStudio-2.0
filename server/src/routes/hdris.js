// Lighting environments (HDRIs) from Poly Haven — CC0, no key needed, the same
// source Nozila uses. Browsing lists them; picking one mirrors the 1k .hdr into
// uploads/hdri once, so the viewport never depends on a third-party CDN.
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { ensureDir, publicUrl } from "../files.js";

const POLYHAVEN = "https://api.polyhaven.com";
const UA = { "User-Agent": "NoviraStudio/1.0" };
const PAGE = 40;
// Nozila's lighting presets come first, in this order.
const PRESETS = ["studio_small_03", "st_fagans_interior", "empty_warehouse_01", "venice_sunset", "kiara_1_dawn", "dikhololo_night",
  "potsdamer_platz", "adams_place_bridge", "rooitou_park", "forest_slope", "lebombo", "immenstadter_horn"];

const thumb = (id) => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=320&height=160`;
let cache = null, cachedAt = 0;

async function listAll() {
  if (cache && Date.now() - cachedAt < 3600_000) return cache;
  const r = await fetch(`${POLYHAVEN}/assets?t=hdris`, { headers: UA });
  if (!r.ok) throw Object.assign(new Error(`Poly Haven is unavailable (${r.status}).`), { status: 502 });
  const all = Object.entries(await r.json()).map(([id, a]) => ({ id, ...a })).sort((a, b) => (b.download_count || 0) - (a.download_count || 0));
  const first = PRESETS.map((id) => all.find((a) => a.id === id)).filter(Boolean);
  cache = [...first, ...all.filter((a) => !PRESETS.includes(a.id))];
  cachedAt = Date.now();
  return cache;
}

export const hdris = Router();

/** Poly Haven HDRIs matching the words (presets first when there are none). */
export async function searchHdris(query = "") {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const list = await listAll();
  if (!words.length) return list;
  const score = (a) => { const hay = [a.id, a.name, ...(a.tags || []), ...(a.categories || [])].join(" ").toLowerCase(); return words.filter((w) => hay.includes(w)).length; };
  return list.map((a) => ({ a, s: score(a) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.a);
}

/** Mirror the 1k .hdr of an HDRI (once) and describe it for a scene. */
export async function mirrorHdri(slugIn) {
  const slug = String(slugIn).replace(/[^a-z0-9_-]/gi, "");
  if (!slug) throw Object.assign(new Error("Unknown HDRI."), { status: 400 });
  const dir = ensureDir("hdri"), name = `${slug}_1k.hdr`, file = path.join(dir, name);
  if (!fs.existsSync(file) || fs.statSync(file).size < 10_000) {
    const r = await fetch(`${POLYHAVEN}/files/${slug}`, { headers: UA });
    if (!r.ok) throw Object.assign(new Error(`Poly Haven couldn't list files (${r.status}).`), { status: 502 });
    const url = (await r.json()).hdri?.["1k"]?.hdr?.url;
    if (!url) throw Object.assign(new Error("This HDRI has no 1k download."), { status: 502 });
    const d = await fetch(url, { headers: UA });
    if (!d.ok) throw Object.assign(new Error(`Download failed (${d.status}).`), { status: 502 });
    fs.writeFileSync(file, Buffer.from(await d.arrayBuffer()));
  }
  const info = (await listAll().catch(() => [])).find((a) => a.id === slug);
  return { slug, name: info?.name || slug, url: publicUrl("hdri", name), thumb: thumb(slug) };
}

// ?q=indoor&cursor=40
hdris.get("/", async (req, res) => {
  const start = Number(req.query.cursor) || 0;
  const list = await searchHdris(req.query.q);
  res.json({
    results: list.slice(start, start + PAGE).map((a) => ({ slug: a.id, name: a.name, thumb: thumb(a.id), categories: a.categories || [], preset: PRESETS.includes(a.id) })),
    next: start + PAGE < list.length ? String(start + PAGE) : null,
  });
});

// Mirror the 1k .hdr (once) and return its local URL.
hdris.post("/:slug", async (req, res) => {
  res.json(await mirrorHdri(req.params.slug));
});
