// Who may open a project: its owner, and the people the owner invited to it.
import { one } from "./db.js";

/** The project with the caller's role on it ('owner' | 'editor' | 'viewer'), or null. */
export async function projectFor(id, userId) {
  const p = await one(
    `SELECT p.*, IF(p.user_id = ?, 'owner', m.role) AS my_role
       FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
      WHERE p.id = ? AND (p.user_id = ? OR m.user_id IS NOT NULL)`, [userId, userId, id, userId]);
  return p || null;
}

/**
 * Express helper: the project in req.params.id if the caller may use it this way,
 * else a 404 (or 403 for a member asking for an owner's action) and null.
 */
export async function accessible(req, res, { owner = false, edit = false, id = req.params.id } = {}) {
  const p = await projectFor(id, req.user.id);
  if (!p) { res.status(404).json({ error: "Project not found." }); return null; }
  if (owner && p.my_role !== "owner") { res.status(403).json({ error: "Only the project's owner can do that." }); return null; }
  if (edit && p.my_role === "viewer") { res.status(403).json({ error: "You can view this project but not change it." }); return null; }
  return p;
}
