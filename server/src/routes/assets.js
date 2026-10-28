import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "../config.js";
import { q, one } from "../db.js";
import { ensureDir, saveFromUrl } from "../files.js";
import { repairGlbFile } from "../gltfRepair.js";
import { fixFoliage, measureGlb, optimizeGlb, restoreColours } from "../optimize.js";

export const assets = express.Router();
const SKETCHFAB = "https://api.sketchfab.com/v3";
const POLYHAVEN = "https://api.polyhaven.com";
const BLENDERKIT = "https://www.blenderkit.com/api/v1";
const UA = { "User-Agent": "NoviraStudio/0.1 (event 3D mockups)" };
const PAGE = 24;

// What each library shows before the user types anything: an endless feed of
// event-relevant categories, two pages each, in this order.
const BROWSE = { sketchfab: "event furniture" };
const EVENT_FEED = ["banquet", "chair", "round table", "sofa", "chandelier", "flower", "candle", "stage", "plant", "lamp", "bar stool", "decoration", "table", "curtain", "carpet"];
const PH_FIRST = ["furniture", "seating", "table", "lighting", "decorative", "props"];

// Fix known faults, then make the model light enough for a laptop browser.
const repair = async (fileUrl) => {
  if (!fileUrl.endsWith(".glb")) return;
  const file = path.join(config.uploadsDir, decodeURIComponent(fileUrl.replace(/^\/uploads\//, "")));
  try { repairGlbFile(file); } catch (e) { console.warn("[assets] repair skipped:", e.message); }
  try { await optimizeGlb(file); } catch (e) { console.warn("[assets] optimise skipped:", e.message); }
};

// ---------- providers ----------
// search(query, cursor) -> { results, next }   (next = opaque cursor or null)
// download(item)        -> public file URL
export const providers = {
  // BlenderKit: search and download both work without a key for free assets.
  // The download endpoint needs a `scene_uuid` (any UUID) and answers with a
  // short-lived signed link, so it is exchanged at import time.
  blenderkit: {
    label: "BlenderKit",
    OK_LICENCES: new Set(["royalty_free", "cc0", "cc-0", "public_domain"]),
    gltfFile: (a) => (a.files || []).find((f) => f.fileType === "gltf" && f.downloadUrl),
    shape(a) {
      return {
        source: "blenderkit", externalId: a.assetBaseId, name: a.name,
        author: [a.author?.firstName, a.author?.lastName].filter(Boolean).join(" ") || "BlenderKit contributor",
        license: a.license === "royalty_free" ? "Royalty free" : "CC0", thumbnail: a.thumbnailMiddleUrl || a.thumbnailLargeUrl || null,
        downloadApiUrl: this.gltfFile(a)?.downloadUrl, needsKey: false,
      };
    },
    usable(a) { return a.isFree && a.assetType === "model" && this.OK_LICENCES.has(String(a.license || "").toLowerCase()) && this.gltfFile(a); },
    async page(text, page) {
      const r = await fetch(`${BLENDERKIT}/search/?query=${encodeURIComponent(`${text} asset_type:model is_free:true`)}&page_size=40&page=${page}`, { headers: { ...UA, Accept: "application/json" } });
      if (!r.ok) throw new Error(`BlenderKit search failed (${r.status}).`);
      const data = await r.json();
      return { results: (data.results || []).filter((a) => this.usable(a)).map((a) => this.shape(a)), more: !!data.next };
    },
    async search(query, cursor) {
      if (query) {
        const page = Number(cursor) || 1;
        const { results, more } = await this.page(query, page);
        return { results, next: more ? String(page + 1) : null };
      }
      // browse: cursor "feedIndex:page" walks EVENT_FEED, two pages per category
      const [fi, pg] = String(cursor || "0:1").split(":").map(Number);
      const { results, more } = await this.page(EVENT_FEED[fi], pg);
      const next = more && pg < 2 ? `${fi}:${pg + 1}` : fi + 1 < EVENT_FEED.length ? `${fi + 1}:1` : null;
      return { results, next };
    },
    async lookup(assetBaseId) {
      const r = await fetch(`${BLENDERKIT}/search/?query=${encodeURIComponent(`asset_base_id:${assetBaseId}`)}&page_size=1`, { headers: { ...UA, Accept: "application/json" } });
      const a = (await r.json()).results?.[0];
      return a ? this.shape(a) : null;
    },
    async download(item) {
      const api = item.downloadApiUrl || (await this.lookup(item.externalId))?.downloadApiUrl;
      if (!api || !/^https:\/\/www\.blenderkit\.com\/api\//.test(api)) throw Object.assign(new Error("BlenderKit has no glTF for this asset."), { status: 502 });
      const r = await fetch(`${api}${api.includes("?") ? "&" : "?"}scene_uuid=${crypto.randomUUID()}`, { headers: { ...UA, Accept: "application/json" } });
      const signed = await r.json().catch(() => ({}));
      const link = signed.filePath || signed.file_path || signed.url;
      if (!link) throw Object.assign(new Error("BlenderKit refused the download link."), { status: 502 });
      return saveFromUrl("assets", link, /\.gltf(\?|$)/i.test(link) ? "gltf" : "glb");
    },
    repair,
  },

  sketchfab: {
    label: "Sketchfab",
    async search(query, cursor) {
      const params = new URLSearchParams({ type: "models", downloadable: "true", count: String(PAGE), q: query || BROWSE.sketchfab });
      if (!query) params.set("sort_by", "-likeCount");
      if (cursor) params.set("cursor", cursor);
      const r = await fetch(`${SKETCHFAB}/search?${params}`, { headers: UA });
      if (!r.ok) throw new Error(`Sketchfab search failed (${r.status}).`);
      const data = await r.json();
      const results = (data.results || []).map((m) => {
        const imgs = m.thumbnails?.images || [];
        const thumb = imgs.filter((i) => i.width >= 200).sort((a, b) => a.width - b.width)[0] || imgs[0];
        return { source: "sketchfab", externalId: m.uid, name: m.name, author: m.user?.displayName || m.user?.username || "", license: m.license?.label || m.license || "", thumbnail: thumb?.url || null, viewerUrl: m.viewerUrl, needsKey: !config.sketchfab.token };
      });
      const next = data.next ? new URL(data.next).searchParams.get("cursor") : null;
      return { results, next };
    },
    async download(item) {
      if (!config.sketchfab.token) throw Object.assign(new Error("Add SKETCHFAB_API_TOKEN to server/.env to import models from Sketchfab."), { status: 400 });
      const r = await fetch(`${SKETCHFAB}/models/${item.externalId}/download`, { headers: { ...UA, Authorization: `Token ${config.sketchfab.token}` } });
      if (!r.ok) throw Object.assign(new Error(`Sketchfab refused the download (${r.status}). Check the model is downloadable and your token is valid.`), { status: 502 });
      const links = await r.json();
      if (!links.glb?.url) throw Object.assign(new Error("This model has no GLB download. Try another one."), { status: 502 });
      return saveFromUrl("assets", links.glb.url, "glb");
    },
  },

  // Poly Haven: free CC0 models, no key needed. Models are glTF with separate
  // .bin and texture files, so every file is mirrored next to the .gltf.
  polyhaven: {
    label: "Poly Haven",
    _list: null, _at: 0,
    async list() {
      if (this._list && Date.now() - this._at < 3600_000) return this._list;
      const r = await fetch(`${POLYHAVEN}/assets?t=models`, { headers: UA });
      if (!r.ok) throw new Error(`Poly Haven is unavailable (${r.status}).`);
      this._list = Object.entries(await r.json()).map(([id, a]) => ({ id, ...a })).sort((a, b) => (b.download_count || 0) - (a.download_count || 0));
      this._at = Date.now();
      return this._list;
    },
    async search(query, cursor) {
      const start = Number(cursor) || 0;
      const words = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
      const score = (a) => {
        const hay = [a.id, a.name, ...(a.tags || []), ...(a.categories || [])].join(" ").toLowerCase();
        return words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      };
      let list = await this.list();
      if (words.length) list = list.map((a) => ({ a, s: score(a) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.a);
      else { // browse: furniture, seating, lighting and decor before plants and rocks
        const first = list.filter((a) => (a.categories || []).some((c) => PH_FIRST.includes(c)));
        list = [...first, ...list.filter((a) => !first.includes(a))];
      }
      const slice = list.slice(start, start + PAGE);
      return {
        results: slice.map((a) => ({
          source: "polyhaven", externalId: a.id, name: a.name, author: Object.keys(a.authors || {}).join(", "), license: "CC0",
          thumbnail: `https://cdn.polyhaven.com/asset_img/thumbs/${a.id}.png?width=256&height=256`, needsKey: false,
        })),
        next: start + PAGE < list.length ? String(start + PAGE) : null,
      };
    },
    async download(item) {
      const r = await fetch(`${POLYHAVEN}/files/${encodeURIComponent(item.externalId)}`, { headers: UA });
      if (!r.ok) throw Object.assign(new Error(`Poly Haven couldn't list files (${r.status}).`), { status: 502 });
      const files = await r.json();
      const res = files.gltf?.["1k"]?.gltf || files.gltf?.["2k"]?.gltf;
      if (!res?.url) throw Object.assign(new Error("This Poly Haven model has no glTF download."), { status: 502 });
      const sub = `assets/ph-${item.externalId.replace(/[^a-z0-9_-]/gi, "")}`;
      const dir = ensureDir(sub);
      const fetchTo = async (url, rel) => {
        const safe = path.normalize(rel).replace(/^(\.\.[\\/])+/, "");
        const dest = path.join(dir, safe);
        if (!dest.startsWith(dir)) throw new Error("Unsafe file path in model.");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const f = await fetch(url, { headers: UA });
        if (!f.ok) throw new Error(`Download failed (${f.status}).`);
        fs.writeFileSync(dest, Buffer.from(await f.arrayBuffer()));
      };
      const main = path.basename(new URL(res.url).pathname);
      await fetchTo(res.url, main);
      await Promise.all(Object.entries(res.include || {}).map(([rel, f]) => fetchTo(f.url, rel)));
      return `/uploads/${sub}/${encodeURIComponent(main)}`;
    },
  },
};

assets.get("/providers", (_req, res) => {
  res.json(Object.entries(providers).map(([key, p]) => ({ key, label: p.label, canImport: key !== "sketchfab" || !!config.sketchfab.token })));
});

// Search or browse (empty q) one library, a page at a time.
// Searches are cached (and shared while in flight), so switching provider or
// scrolling back is instant: a cached answer is returned at once even when it is
// old, and refreshed in the background (stale-while-revalidate). A page with
// only a few results is topped up from the next pages, so a feed never opens thin.
const searchCache = new Map();
const FRESH = 20 * 60_000, MIN_PAGE = 24;
async function fullPage(p, query, cursor) {
  let page = await p.search(query, cursor), results = [...page.results], next = page.next;
  for (let extra = 0; results.length < MIN_PAGE && next && extra < 4; extra++) { page = await p.search(query, next); results.push(...page.results); next = page.next; }
  return { results, next };
}
export function cachedSearch(source, query = "", cursor = null) {
  const p = providers[source];
  if (!p) return Promise.reject(Object.assign(new Error("Unknown asset provider."), { status: 400 }));
  const key = `${source}|${query.toLowerCase()}|${cursor || ""}`, hit = searchCache.get(key);
  const load = () => {
    const promise = fullPage(p, query, cursor);
    promise.then((data) => searchCache.set(key, { at: Date.now(), promise: Promise.resolve(data) })).catch(() => { if (searchCache.get(key)?.promise === promise) searchCache.delete(key); });
    return promise;
  };
  if (hit) {
    if (Date.now() - hit.at > FRESH && !hit.refreshing) { hit.refreshing = true; load().catch(() => undefined); } // stale: answer now, refresh behind
    return hit.promise;
  }
  const promise = load();
  searchCache.set(key, { at: Date.now(), promise });
  return promise;
}
export async function warmAssetFeeds() {
  for (const source of Object.keys(providers)) {
    try { const first = await cachedSearch(source); if (first.next) await cachedSearch(source, "", first.next); }
    catch (e) { console.warn(`[assets] couldn't warm ${source}:`, e.message); }
  }
}

assets.get("/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  try { res.json(await cachedSearch(String(req.query.source || "blenderkit"), query, req.query.cursor ? String(req.query.cursor) : null)); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

// Import a model into the library (downloads it once, then reuses it). The
// editor starts this as soon as a model is pressed or dragged, so by the time
// it is dropped it is usually ready; concurrent requests share one download.
const importing = new Map();
async function importAsset(userId, { externalId, name, author, license, thumbnail, downloadApiUrl, source = "blenderkit" }) {
  const p = providers[source];
  if (!p || !externalId) throw Object.assign(new Error("Missing model or provider."), { status: 400 });
  const existing = await one("SELECT * FROM assets WHERE source = ? AND external_id = ?", [source, externalId]);
  if (existing?.file_url) {
    if (!existing.size) {
      const size = await measureGlb(path.join(config.uploadsDir, decodeURIComponent(existing.file_url.replace(/^\/uploads\//, "")))).catch(() => null);
      if (size) { await q("UPDATE assets SET size = ? WHERE id = ?", [JSON.stringify(size), existing.id]); existing.size = size; }
    }
    return existing;
  }
  const fileUrl = await p.download({ externalId, downloadApiUrl });
  await repair(fileUrl);
  // colours the export lost (a Blender node colour), taken back from the model's own thumbnail or its name
  try { const fixed = await restoreColours(path.join(config.uploadsDir, decodeURIComponent(fileUrl.replace(/^\/uploads\//, ""))), { name, thumbnail }); if (fixed.length) console.log(`[assets] ${name}: restored ${fixed.join(", ")}`); }
  catch (e) { console.warn("[assets] colour restore skipped:", e.message); }
  // plants whose leaves came out as solid mirror cards
  try { const fixed = await fixFoliage(path.join(config.uploadsDir, decodeURIComponent(fileUrl.replace(/^\/uploads\//, ""))), { name }); if (fixed.length) console.log(`[assets] ${name}: ${fixed.join(", ")}`); }
  catch (e) { console.warn("[assets] foliage fix skipped:", e.message); }
  const size = await measureGlb(path.join(config.uploadsDir, decodeURIComponent(fileUrl.replace(/^\/uploads\//, "")))).catch(() => null);
  await q(`INSERT INTO assets (user_id, source, external_id, name, author, license, thumbnail_url, file_url, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE file_url = VALUES(file_url), size = VALUES(size)`, [userId, source, externalId, name || "Model", author || null, license || null, thumbnail || null, fileUrl, size ? JSON.stringify(size) : null]);
  return one("SELECT * FROM assets WHERE source = ? AND external_id = ?", [source, externalId]);
}
/** Import a library model once (concurrent requests share the download); size is its real [w, h, d] in metres. */
export async function importModel(userId, m) {
  const key = `${m.source || "blenderkit"}|${m.externalId}`;
  if (!importing.has(key)) importing.set(key, importAsset(userId, m || {}).finally(() => importing.delete(key)));
  const a = await importing.get(key);
  return { ...a, size: typeof a.size === "string" ? JSON.parse(a.size) : a.size };
}
assets.post("/import", async (req, res) => {
  try { res.json(await importModel(req.user.id, req.body || {})); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

assets.get("/", async (req, res) => {
  res.json(await q("SELECT * FROM assets WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC", [req.user.id]));
});
