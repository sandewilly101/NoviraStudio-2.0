import express from "express";
import { q, one, json } from "../db.js";
import { uploader, publicUrl } from "../files.js";

export const brand = express.Router();
const logoUpload = uploader("brand", { maxMb: 20, exts: [".png", ".jpg", ".jpeg", ".svg", ".webp"] });
const shape = (b) => b && { ...b, colors: json(b.colors, []), fonts: json(b.fonts, {}) };

brand.get("/", async (req, res) => {
  res.json((await q("SELECT * FROM brand_kits WHERE user_id = ? ORDER BY created_at DESC", [req.user.id])).map(shape));
});

brand.post("/", logoUpload.single("logo"), async (req, res) => {
  const { name, colors, fonts } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name the brand kit." });
  const r = await q("INSERT INTO brand_kits (user_id, name, logo_url, colors, fonts) VALUES (?, ?, ?, ?, ?)", [
    req.user.id, name, req.file ? publicUrl("brand", req.file.filename) : null,
    typeof colors === "string" ? colors : JSON.stringify(colors || []), typeof fonts === "string" ? fonts : JSON.stringify(fonts || {}),
  ]);
  res.json(shape(await one("SELECT * FROM brand_kits WHERE id = ?", [r.insertId])));
});

brand.put("/:id", logoUpload.single("logo"), async (req, res) => {
  const b = await one("SELECT * FROM brand_kits WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!b) return res.status(404).json({ error: "Brand kit not found." });
  const { name, colors, fonts } = req.body || {};
  await q("UPDATE brand_kits SET name = ?, logo_url = ?, colors = ?, fonts = ? WHERE id = ?", [
    name || b.name, req.file ? publicUrl("brand", req.file.filename) : b.logo_url,
    colors ? (typeof colors === "string" ? colors : JSON.stringify(colors)) : JSON.stringify(json(b.colors, [])),
    fonts ? (typeof fonts === "string" ? fonts : JSON.stringify(fonts)) : JSON.stringify(json(b.fonts, {})), b.id,
  ]);
  res.json(shape(await one("SELECT * FROM brand_kits WHERE id = ?", [b.id])));
});

brand.delete("/:id", async (req, res) => {
  await q("DELETE FROM brand_kits WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});
