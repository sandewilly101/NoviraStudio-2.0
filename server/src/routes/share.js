// Public, no-login client review pages: /api/share/:token
import express from "express";
import { q, one, json } from "../db.js";

export const share = express.Router();

async function byToken(req, res) {
  const p = await one("SELECT * FROM projects WHERE share_token = ?", [req.params.token]);
  if (!p) res.status(404).json({ error: "This review link is not valid any more." });
  return p;
}

share.get("/:token", async (req, res) => {
  const p = await byToken(req, res); if (!p) return;
  const v = await one("SELECT * FROM scene_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1", [p.id]);
  const venue = p.venue_id ? await one("SELECT id, name, file_url, analysis FROM venues WHERE id = ?", [p.venue_id]) : null;
  const owner = await one("SELECT name FROM users WHERE id = ?", [p.user_id]);
  const comments = await q("SELECT id, author_name, author_role, body, position, resolved, created_at FROM comments WHERE project_id = ? ORDER BY created_at", [p.id]);
  const approval = v ? await one("SELECT approver_name, created_at FROM approvals WHERE project_id = ? AND version = ?", [p.id, v.version]) : null;
  const renders = await q("SELECT id, kind, file_url, created_at FROM renders WHERE project_id = ? ORDER BY created_at DESC LIMIT 12", [p.id]);
  res.json({
    project: { id: p.id, name: p.name, status: p.status, event_type: p.event_type, guests: p.guests },
    owner: owner?.name || "",
    venue: venue && { ...venue, analysis: json(venue.analysis) },
    version: v?.version || 0,
    scene: v ? json(v.scene) : null,
    comments: comments.map((c) => ({ ...c, position: json(c.position) })),
    approval,
    renders,
  });
});

share.post("/:token/comments", async (req, res) => {
  const p = await byToken(req, res); if (!p) return;
  const { name, role, body, position } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: "Add your name and a comment." });
  const r = await q("INSERT INTO comments (project_id, author_name, author_role, body, position) VALUES (?, ?, ?, ?, ?)",
    [p.id, String(name).slice(0, 120), String(role || "client").slice(0, 40), String(body).slice(0, 4000), position ? JSON.stringify(position) : null]);
  const c = await one("SELECT * FROM comments WHERE id = ?", [r.insertId]);
  res.json({ ...c, position: json(c.position) });
});

share.post("/:token/approve", async (req, res) => {
  const p = await byToken(req, res); if (!p) return;
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Add your name to approve." });
  const v = await one("SELECT version FROM scene_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1", [p.id]);
  if (!v) return res.status(400).json({ error: "There is no design to approve yet." });
  await q("INSERT INTO approvals (project_id, version, approver_name) VALUES (?, ?, ?)", [p.id, v.version, String(name).slice(0, 120)]);
  await q("UPDATE projects SET status = 'approved' WHERE id = ?", [p.id]);
  res.json({ ok: true, version: v.version });
});
