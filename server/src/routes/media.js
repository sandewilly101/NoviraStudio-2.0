// The media library: images and videos uploaded or generated for display
// surfaces (LED walls, posters, banners, backdrops), reusable across projects.
import path from "node:path";
import express from "express";
import { q, one } from "../db.js";
import { uploader, publicUrl } from "../files.js";

export const media = express.Router();
const IMAGE = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"], VIDEO = [".mp4", ".webm", ".mov"];
const upload = uploader("media", { maxMb: 400, exts: [...IMAGE, ...VIDEO] });

media.get("/", async (req, res) => {
  res.json(await q("SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC LIMIT 300", [req.user.id]));
});

// multipart: file, width?, height? (measured in the browser)
media.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image or a video." });
  const kind = VIDEO.includes(path.extname(req.file.originalname).toLowerCase()) ? "video" : "image";
  const r = await q("INSERT INTO media (user_id, kind, source, name, file_url, width, height) VALUES (?, ?, 'upload', ?, ?, ?, ?)", [
    req.user.id, kind, req.file.originalname.slice(0, 200), publicUrl("media", req.file.filename), Number(req.body.width) || null, Number(req.body.height) || null,
  ]);
  res.json(await one("SELECT * FROM media WHERE id = ?", [r.insertId]));
});

media.delete("/:id", async (req, res) => {
  await q("DELETE FROM media WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

/** Record a file already saved under /uploads (e.g. an AI graphic) in the library. */
export async function addToLibrary(userId, { kind = "image", source, name, url, width = null, height = null }) {
  const r = await q("INSERT INTO media (user_id, kind, source, name, file_url, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)", [userId, kind, source, name.slice(0, 200), url, width, height]);
  return one("SELECT * FROM media WHERE id = ?", [r.insertId]);
}
