import express from "express";
import { q, one } from "../db.js";
import { saveBase64, uploader, publicUrl } from "../files.js";
import { enhanceRender, generateGraphic, imagesEnabled } from "../ai/images.js";
import { describeScene } from "../ai/describe.js";
import { addToLibrary } from "./media.js";
import { accessible } from "../access.js";

export const renders = express.Router();
const videoUpload = uploader("renders", { maxMb: 300, exts: [".webm", ".mp4"] });

// renders of a project are made by its owner and the people invited to it
const ownedProject = (req, res, id) => accessible(req, res, { id });
const insert = async (projectId, kind, url, prompt, version) => {
  const r = await q("INSERT INTO renders (project_id, kind, file_url, prompt, version) VALUES (?, ?, ?, ?, ?)", [projectId, kind, url, prompt || null, version || null]);
  return one("SELECT * FROM renders WHERE id = ?", [r.insertId]);
};

// All renders for the user, newest first.
renders.get("/", async (req, res) => {
  res.json(await q(`SELECT r.*, p.name AS project_name FROM renders r JOIN projects p ON p.id = r.project_id
                    LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
                    WHERE p.user_id = ? OR m.user_id IS NOT NULL ORDER BY r.created_at DESC LIMIT 200`, [req.user.id, req.user.id]));
});

renders.get("/project/:id", async (req, res) => {
  const p = await ownedProject(req, res, req.params.id); if (!p) return;
  res.json(await q("SELECT * FROM renders WHERE project_id = ? ORDER BY created_at DESC", [p.id]));
});

// Save a browser capture: screenshot, 360° panorama or floor plan (PNG/JPEG data URL).
renders.post("/project/:id/capture", async (req, res) => {
  const p = await ownedProject(req, res, req.params.id); if (!p) return;
  const { kind = "image", dataUrl, version } = req.body || {};
  if (!dataUrl) return res.status(400).json({ error: "No image data." });
  const ext = dataUrl.startsWith("data:image/jpeg") ? "jpg" : "png";
  const url = saveBase64("renders", dataUrl, ext);
  if (kind === "image" && !p.thumbnail_url) await q("UPDATE projects SET thumbnail_url = ? WHERE id = ?", [url, p.id]);
  res.json(await insert(p.id, kind, url, null, version));
});

// Photoreal preview with Nano Banana. Without a Gemini key the plain capture is kept.
renders.post("/project/:id/enhance", async (req, res) => {
  const p = await ownedProject(req, res, req.params.id); if (!p) return;
  const { dataUrl, lighting, version, extra, scene } = req.body || {};
  if (!dataUrl) return res.status(400).json({ error: "No image data." });
  if (!imagesEnabled()) {
    const url = saveBase64("renders", dataUrl, "png");
    return res.json({ ...(await insert(p.id, "image", url, null, version)), note: "Add GEMINI_API_KEY to server/.env for photoreal AI previews. Saved the 3D capture instead." });
  }
  try {
    const img = await enhanceRender(dataUrl.replace(/^data:[^;]+;base64,/, ""), { lighting, eventType: scene?.plan?.eventType || p.event_type, extra, inventory: describeScene(scene), mode: scene?.environment?.mode || scene?.plan?.mode });
    const url = saveBase64("renders", img.base64, img.mimeType.includes("jpeg") ? "jpg" : "png");
    await q("UPDATE projects SET thumbnail_url = ? WHERE id = ?", [url, p.id]);
    res.json(await insert(p.id, "enhanced", url, extra, version));
  } catch (e) {
    res.status(502).json({ error: `Nano Banana couldn't render this: ${e.message}` });
  }
});

// Walkthrough video recorded in the browser.
renders.post("/project/:id/video", videoUpload.single("file"), async (req, res) => {
  const p = await ownedProject(req, res, req.params.id); if (!p) return;
  if (!req.file) return res.status(400).json({ error: "No video file." });
  res.json(await insert(p.id, "video", publicUrl("renders", req.file.filename), null, req.body.version));
});

// Brand graphic for a surface (LED wall, backdrop, banner).
renders.post("/graphic", async (req, res) => {
  if (!imagesEnabled()) return res.status(400).json({ error: "Add GEMINI_API_KEY to server/.env to generate graphics with Nano Banana." });
  const { prompt, aspect, colors } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Describe the graphic." });
  try {
    const img = await generateGraphic(prompt, { aspect, colors });
    const url = saveBase64("graphics", img.base64, img.mimeType.includes("jpeg") ? "jpg" : "png");
    const item = await addToLibrary(req.user.id, { source: "ai", name: prompt.slice(0, 80), url });
    res.json({ url, media: item });
  } catch (e) {
    res.status(502).json({ error: `Nano Banana couldn't create this: ${e.message}` });
  }
});

renders.delete("/:id", async (req, res) => {
  await q("DELETE r FROM renders r JOIN projects p ON p.id = r.project_id WHERE r.id = ? AND p.user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});
