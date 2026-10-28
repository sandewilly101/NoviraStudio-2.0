import express from "express";
import { q, one, json } from "../db.js";
import { uploader, publicUrl } from "../files.js";
import { optimizeGlb, VENUE_OPTIONS } from "../optimize.js";

export const venues = express.Router();
const upload = uploader("venues", { maxMb: 600, exts: [".glb", ".gltf"] });

const shape = (v) => v && { ...v, analysis: json(v.analysis) };

venues.get("/", async (req, res) => {
  const rows = await q(
    `SELECT v.*, (SELECT COUNT(*) FROM projects p WHERE p.venue_id = v.id) AS project_count
     FROM venues v WHERE v.user_id = ? ORDER BY v.created_at DESC`, [req.user.id]);
  res.json(rows.map(shape));
});

venues.get("/:id", async (req, res) => {
  const v = await one("SELECT * FROM venues WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!v) return res.status(404).json({ error: "Venue not found." });
  res.json(shape(v));
});

venues.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a .glb or .gltf file." });
  const name = (req.body.name || req.file.originalname.replace(/\.[^.]+$/, "")).slice(0, 160);
  // make big venue files smooth in the browser (original kept as .orig)
  try { await optimizeGlb(req.file.path, VENUE_OPTIONS); } catch (e) { console.warn("[venues] optimise skipped:", e.message); }
  const r = await q("INSERT INTO venues (user_id, name, file_url, file_name, file_size) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, name, publicUrl("venues", req.file.filename), req.file.originalname, req.file.size]);
  res.json(shape(await one("SELECT * FROM venues WHERE id = ?", [r.insertId])));
});

// The app measures the model in the browser (three.js) and saves the result here.
venues.put("/:id/analysis", async (req, res) => {
  const v = await one("SELECT id FROM venues WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!v) return res.status(404).json({ error: "Venue not found." });
  await q("UPDATE venues SET analysis = ?, status = 'ready' WHERE id = ?", [JSON.stringify(req.body || {}), v.id]);
  res.json(shape(await one("SELECT * FROM venues WHERE id = ?", [v.id])));
});

venues.patch("/:id", async (req, res) => {
  await q("UPDATE venues SET name = COALESCE(?, name) WHERE id = ? AND user_id = ?", [req.body.name || null, req.params.id, req.user.id]);
  res.json(shape(await one("SELECT * FROM venues WHERE id = ?", [req.params.id])));
});

venues.delete("/:id", async (req, res) => {
  await q("DELETE FROM venues WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});
