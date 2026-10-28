// Sourcing a real 3D model the way a production buyer would, not by taking the
// first search hit:
//  1. GPT-4o turns the item and the event's theme into several precise searches
//     (synonyms, regional names, the specific object: a Tanzanian drum is an
//     "african drum", a "djembe", an "ngoma drum"…), a description of how it
//     should look, and its real size;
//  2. every search runs on BlenderKit, Sketchfab and Poly Haven, many results each;
//  3. GPT-4o looks at all the thumbnails and scores each one — the right object,
//     photoreal (scans first; never cartoon or low-poly), one clean object;
//  4. the best is imported and measured: a model lying on its side is stood up,
//     an absurd one (a whole scene, a flat panel) is passed over for the next.
// Choices are remembered per event, so every design of it uses the same models, and
// kept in the database: an item sourced once (for any event) costs nothing the next time.
import { chat, openai } from "./openai.js";
import { config } from "../config.js";
import { cachedSearch, importModel } from "../routes/assets.js";
import { q, one, json } from "../db.js";

const PROVIDERS = ["blenderkit", "sketchfab", "polyhaven"];
const remembered = new Map(); // `${theme}|${item}` → Promise<choice | null>

/** How a buyer would look for this item: searches, a description of the look, real size. */
async function briefFor(item, theme) {
  if (!openai) return { queries: [item], look: item, dims: null, upright: true };
  const res = await chat("Sourcing 3D models", {
    model: config.openai.model, temperature: 0.3, response_format: { type: "json_object" },
    messages: [{ role: "user", content:
      `An event designer needs a realistic 3D model of: "${item}" for ${theme || "an event"}. ` +
      `Return JSON {"queries": [5 short searches for 3D model libraries, most specific first: the object's own name, synonyms, regional or traditional names, the generic object — 1-3 plain words each], ` +
      `"look": "one sentence: what the right model looks like (shape, material, colour, style)", "dims": [width, height, depth] in metres as the real object stands, "upright": true if it stands taller than it is wide}.` }],
  });
  const out = JSON.parse(res.choices[0].message.content || "{}");
  const queries = [...new Set([...(Array.isArray(out.queries) ? out.queries : []), item].map((q) => String(q).toLowerCase().trim()).filter(Boolean))].slice(0, 6);
  const dims = Array.isArray(out.dims) && out.dims.length === 3 && out.dims.every((v) => Number(v) > 0) ? out.dims.map(Number) : null;
  return { queries, look: String(out.look || item), dims, upright: out.upright !== false };
}

/** Every importable result with a picture, from every library, for every search; no duplicates. */
async function candidates(queries) {
  const seen = new Set(), out = [];
  await Promise.all(queries.flatMap((q) => PROVIDERS.map(async (src) => {
    try {
      const r = await cachedSearch(src, q);
      for (const m of r.results.filter((x) => !x.needsKey && x.thumbnail).slice(0, 8)) {
        const key = `${m.source || src}:${m.externalId}`;
        if (!seen.has(key)) { seen.add(key); out.push({ ...m, source: m.source || src, foundBy: q }); }
      }
    } catch { /* that library is unreachable right now */ }
  })));
  return out.slice(0, 48);
}

/** GPT-4o scores every thumbnail 0-10 for this item (right object, realism, one clean object). */
async function score(item, look, list) {
  if (!openai) return list.map((m) => ({ m, score: 5 }));
  const scored = [];
  for (let i = 0; i < list.length; i += 12) {
    const batch = list.slice(i, i + 12);
    try {
      const res = await chat("Choosing library models", {
        model: config.openai.model, temperature: 0, response_format: { type: "json_object" },
        messages: [{ role: "user", content: [
          { type: "text", text: `We need a 3D model of "${item}": ${look}. Images 0-${batch.length - 1} are model thumbnails from 3D libraries. ` +
            `Score each 0-10: 10 = exactly this object, photorealistic (real materials, a scan or high-quality model), a single standalone object shown clearly. ` +
            `Score 0-3 for: a different object, cartoon / stylised / low-poly / toy looks, a whole scene or room, a flat panel or texture, several unrelated objects, a person or animal unless asked. ` +
            `Return JSON {"scores": [{"i": index, "s": score}]}.` },
          ...batch.map((m) => ({ type: "image_url", image_url: { url: m.thumbnail, detail: "low" } })),
        ] }],
      });
      for (const { i: k, s } of JSON.parse(res.choices[0].message.content || "{}").scores || []) if (batch[k]) scored.push({ m: batch[k], score: Number(s) || 0 });
    } catch { /* this batch couldn't be looked at */ }
    if (scored.filter((x) => x.score >= 9).length >= 2) break; // two excellent ones: enough to choose from
  }
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * The best real model for `item` in this theme, imported and measured. Returns
 * { model, asset, upright: 'x'|'z'|null, score } or null when nothing good enough exists.
 */
export function sourceModel(item, { theme = "", userId = null, minScore = 6 } = {}) {
  const name = item.toLowerCase().trim().slice(0, 160), key = `${theme}|${name}`;
  if (!remembered.has(key)) remembered.set(key, (async () => {
    const saved = await savedChoice(name, theme.slice(0, 255));
    if (saved !== undefined) return saved && saved.score >= minScore ? saved : null;
    const choice = await search(item, theme, userId, minScore);
    q("INSERT INTO sourced_models (item, theme, choice, score) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE choice = VALUES(choice), score = VALUES(score), created_at = NOW()",
      [name, theme.slice(0, 255), choice ? JSON.stringify(choice) : null, choice?.score ?? null]).catch(() => undefined);
    return choice;
  })().catch(() => null));
  return remembered.get(key);
}

/**
 * A choice made before: for this theme, or an excellent one for any theme (a djembe is a djembe at a
 * wedding or a festival). `undefined` when never searched; `null` when searched recently and nothing
 * was good enough (searched again after a week: the libraries grow).
 */
async function savedChoice(item, theme) {
  try {
    const row = await one("SELECT choice, score, created_at FROM sourced_models WHERE item = ? AND theme = ?", [item, theme])
      || await one("SELECT choice, score, created_at FROM sourced_models WHERE item = ? AND score >= 8 ORDER BY score DESC LIMIT 1", [item]);
    if (!row) return undefined;
    const choice = json(row.choice);
    if (!choice) return Date.now() - new Date(row.created_at).getTime() < 7 * 86400e3 ? null : undefined;
    return choice;
  } catch { return undefined; } // no database (scripts): search
}

async function search(item, theme, userId, minScore) {
  const brief = await briefFor(item, theme).catch(() => ({ queries: [item], look: item, dims: null, upright: true }));
  const ranked = (await score(item, brief.look, await candidates(brief.queries))).filter((x) => x.score >= minScore);
  for (const { m, score: s } of ranked.slice(0, 4)) {
    try {
      const asset = await importModel(userId, m);
      const r = Array.isArray(asset.size) ? asset.size : null;
      if (!r || r.some((v) => !(v > 0))) continue;
      // modelled lying down: stand it on the axis that should be its height
      let upright = null, real = r;
      if (brief.upright && r[1] < Math.max(r[0], r[2]) * 0.6) { upright = r[0] >= r[2] ? "x" : "z"; real = upright === "x" ? [r[1], r[0], r[2]] : [r[0], r[2], r[1]]; }
      // nothing absurd: a whole scene or a flat panel, against the real object's proportions
      if (brief.dims) {
        const want = brief.dims[1] / Math.max(brief.dims[0], brief.dims[2]), got = real[1] / Math.max(real[0], real[2]);
        if (got < want / 4 || got > want * 4) continue;
      }
      return { model: m, asset: { ...asset, size: real }, upright, score: s, look: brief.look };
    } catch { /* that one wouldn't import: the next */ }
  }
  return null;
}
