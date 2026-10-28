// Real, sourced 3D models used for each furniture type the layout solver places.
// All are free BlenderKit assets (royalty-free licence), downloaded once into
// uploads/assets and reused by every project.
//
// yaw:     rotation (radians) that turns the model to face -Z (Novira's "front").
// stretch: true = scale each axis to the object's size (tables), false = keep
//          proportions and fit inside it (chairs, sofas, decor).
import fs from "node:fs";
import path from "node:path";
import { q, one } from "./db.js";
import { config } from "./config.js";
import { optimizeGlb } from "./optimize.js";
import { providers } from "./routes/assets.js";

// Orientation was checked by rendering each model from four sides:
// chair/sofa/lectern face +Z out of the box, the bar is long along X with its
// cabinets on +Z, and the speaker file lies on its back (drivers facing +Y).
// stand: draw a tripod stand under the model (speakers).
export const CATALOG = [
  { type: "chair", assetBaseId: "c87d2dda-59e0-4ac4-ae4d-cb9407eaff0c", name: "Stacking banquet chair", yaw: Math.PI, stretch: false },
  { type: "round_table", assetBaseId: "e1988901-f927-463a-9765-04879b4216e7", name: "Round dining table", yaw: 0, stretch: true, linen: true },
  { type: "cocktail_table", assetBaseId: "9137779c-a0ba-4f94-8606-bd6b59935a2b", name: "High cocktail table", yaw: 0, stretch: true },
  { type: "long_table", assetBaseId: "272c9159-f5ef-4592-874f-ba28764b4dfc", name: "Banquet table, wood", yaw: 0, stretch: true },
  { type: "sofa", assetBaseId: "ebc31617-aa69-439a-bf88-9b1c2c83f932", name: "Three-seater sofa", yaw: Math.PI, stretch: false },
  { type: "bar", assetBaseId: "1481c301-8192-423b-ad1f-03177e49e8a1", name: "Bar counter", yaw: -Math.PI / 2, stretch: true },
  { type: "lectern", assetBaseId: "386b8bad-223b-4317-8d69-e82e6a0a969d", name: "Acrylic podium", yaw: Math.PI, stretch: false },
  { type: "centrepiece", assetBaseId: "b203a08e-7315-4868-aa3c-1168414236d6", name: "Five-candle candelabra", yaw: 0, stretch: false },
  { type: "speaker", assetBaseId: "9db1af77-d398-439a-b2f4-1eca1ce0f90b", name: "Speaker cabinet on stand", yaw: 0, pitch: Math.PI / 2, stretch: false, stand: true },
  // the table setting laid at every seat (kit: not a scene object of its own)
  { type: "place_setting", assetBaseId: "2908b4e1-9437-483a-be9b-f274d532e0d8", name: "Place setting: plate, fork, knife and spoon", yaw: 0, stretch: false, kit: true, maxTriangles: 4000 },
  { type: "wine_glass", assetBaseId: "f11df78b-4684-4f2d-9fc8-c77605bf43da", name: "Wine glass", yaw: 0, stretch: false, kit: true, glass: true, maxTriangles: 1200 },
  { type: "water_glass", assetBaseId: "b5b5775f-f5ee-408a-b606-34075d9af4e9", name: "Water glass", yaw: 0, stretch: false, kit: true, glass: true, maxTriangles: 1200 },
];

let ready = new Map(); // type -> catalog entry with file_url etc.

export function catalogEntries() { return [...ready.values()]; }

/** Re-simplify a model that is over its triangle budget (once: the optimiser's marker records the result). */
async function withinBudget(fileUrl, maxTriangles, log, geometryOnly = false) {
  const file = path.join(config.uploadsDir, decodeURIComponent(fileUrl.replace(/^\/uploads\//, ""))), marker = `${file}.opt`;
  const done = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : null;
  if (done && done.trisAfter <= maxTriangles * 1.5) return;
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
  const r = await optimizeGlb(file, { maxTriangles, error: 0.02, geometryOnly });
  log(`[catalog] ${path.basename(file)}: ${r.trisBefore} → ${r.trisAfter} triangles`);
}

// Download any missing catalogue models. Safe to call on every start.
export async function ensureCatalog(log = console.log) {
  for (const item of CATALOG) {
    try {
      let row = await one("SELECT * FROM assets WHERE source = 'blenderkit' AND external_id = ?", [item.assetBaseId]);
      if (!row?.file_url) {
        const results = await providers.blenderkit.lookup(item.assetBaseId);
        const fileUrl = await providers.blenderkit.download({ externalId: item.assetBaseId, downloadApiUrl: results?.downloadApiUrl });
        await providers.blenderkit.repair(fileUrl);
        await q(`INSERT INTO assets (user_id, source, external_id, name, author, license, thumbnail_url, file_url) VALUES (NULL, 'blenderkit', ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE file_url = VALUES(file_url)`, [item.assetBaseId, item.name, results?.author || null, results?.license || "Royalty free", results?.thumbnail || null, fileUrl]);
        row = await one("SELECT * FROM assets WHERE source = 'blenderkit' AND external_id = ?", [item.assetBaseId]);
        log(`[catalog] downloaded ${item.type}: ${item.name}`);
      }
      await providers.blenderkit.repair(row.file_url); // no-op once optimised
      // small things repeated at every seat (glasses, place settings) get a far smaller triangle budget
      if (item.maxTriangles) await withinBudget(row.file_url, item.maxTriangles, log, !!item.glass);
      ready.set(item.type, { ...item, file_url: row.file_url, thumbnail: row.thumbnail_url, author: row.author, license: row.license });
    } catch (e) {
      log(`[catalog] ${item.type} unavailable (${e.message}); the built-in shape is used instead`);
    }
  }
  return catalogEntries();
}
