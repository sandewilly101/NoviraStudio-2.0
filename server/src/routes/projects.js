import express from "express";
import { agentEnabled, runAgent } from "../ai/agent.js";
import crypto from "node:crypto";
import { q, one, json } from "../db.js";
import { planFromBrief, variantsOf, editFromInstruction, applyOps } from "../ai/planner.js";
import { generateGraphic, imagesEnabled } from "../ai/images.js";
import { saveBase64 } from "../files.js";
import { addToLibrary } from "./media.js";
import { furnish } from "../ai/styles.js";
import { solveLayout, mergePlan, roomFromVenue, outdoorSite } from "../ai/layout.js";
import { accessible } from "../access.js";
import { buildDesign, sourceAhead } from "../ai/build.js";
import { mirrorMaterial } from "./materials.js";

// photo-scanned ground for open-air events (Poly Haven): a real lawn, beach sand or stone paving
const GROUND_SCANS = { grass: "leafy_grass", sand: "sand_03", paving: "pavement_02" };
function groundFinish(kind) {
  return mirrorMaterial(GROUND_SCANS[kind] || GROUND_SCANS.grass).catch((e) => { console.warn("[generate] ground scan:", e.message); return null; });
}
import { conceptFromScene } from "../ai/concept.js";
import { live } from "../live.js";

export const projects = express.Router();

// the owner and invited editors work on a project; renaming it away, deleting it and inviting are the owner's
const owned = (req, res, opts) => accessible(req, res, opts);
async function latestScene(projectId) {
  const v = await one("SELECT * FROM scene_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1", [projectId]);
  return v ? { ...v, scene: json(v.scene) } : null;
}
async function saveVersion(projectId, scene, label, by = "user") {
  const last = await one("SELECT MAX(version) AS v FROM scene_versions WHERE project_id = ?", [projectId]);
  const version = (last?.v || 0) + 1;
  await q("INSERT INTO scene_versions (project_id, version, label, scene, created_by) VALUES (?, ?, ?, ?, ?)", [projectId, version, label, JSON.stringify(scene), by]);
  await q("UPDATE projects SET updated_at = NOW() WHERE id = ?", [projectId]);
  return version;
}
async function roomFor(venueId) {
  const v = venueId ? await one("SELECT * FROM venues WHERE id = ?", [venueId]) : null;
  return { venue: v ? { ...v, analysis: json(v.analysis) } : null, room: roomFromVenue(v ? json(v.analysis) : null) };
}
// After a re-layout, keep the replacement models (and colour tints) the user
// chose: each type takes the most common choice from the previous scene.
export function carryAssets(oldObjects = [], newObjects = []) {
  const pick = {};
  for (const o of oldObjects) {
    if (!o.asset && !o.tint && !o.variant) continue;
    const key = `${o.type}|${o.asset?.url || ""}|${o.tint ? o.color : ""}|${o.variant || ""}`;
    (pick[o.type] ||= {})[key] = { n: (pick[o.type]?.[key]?.n || 0) + 1, o };
  }
  const best = Object.fromEntries(Object.entries(pick).map(([t, m]) => [t, Object.values(m).sort((a, b) => b.n - a.n)[0].o]));
  return newObjects.map((o) => {
    const b = best[o.type];
    if (!b) return o;
    return { ...o, ...(b.asset ? { asset: b.asset } : {}), ...(b.tint ? { tint: true, color: b.color } : {}), ...(b.variant ? { variant: b.variant, spec: b.spec } : {}) };
  });
}

function sceneFrom(solved, venue) {
  return {
    units: "m",
    venueId: venue?.id || null,
    plan: solved.plan,
    environment: { mode: solved.plan.mode, uplight: solved.plan.colors.uplight, ambient: 0.6 },
    objects: solved.objects,
    checks: solved.checks,
    stats: solved.stats,
  };
}

projects.get("/", async (req, res) => {
  const rows = await q(
    `SELECT p.*, v.name AS venue_name,
       (SELECT MAX(version) FROM scene_versions s WHERE s.project_id = p.id) AS version,
       (SELECT COUNT(*) FROM renders r WHERE r.project_id = p.id) AS render_count
       , IF(p.user_id = ?, 'owner', m.role) AS my_role, u.name AS owner_name
     FROM projects p LEFT JOIN venues v ON v.id = p.venue_id
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? OR m.user_id IS NOT NULL ORDER BY p.updated_at DESC`, [req.user.id, req.user.id, req.user.id]);
  res.json(rows);
});

projects.get("/:id", async (req, res) => {
  const p = await owned(req, res); if (!p) return;
  const latest = await latestScene(p.id);
  const venue = p.venue_id ? await one("SELECT * FROM venues WHERE id = ?", [p.venue_id]) : null;
  res.json({ project: p, venue: venue && { ...venue, analysis: json(venue.analysis) }, version: latest?.version || 0, scene: latest?.scene || null });
});

// A venue named in the brief ("in rotana") matched against the user's venue library.
const VENUE_NOISE = new Set(["hotel", "venue", "hall", "the", "and", "resort", "centre", "center", "gardens", "garden", "room", "club", "nairobi"]);
const words = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !VENUE_NOISE.has(w));
function matchVenue(mention, list) {
  const want = words(mention);
  if (!want.length) return null;
  const scored = list.map((v) => ({ v, n: want.filter((w) => words(v.name).some((x) => x.startsWith(w) || w.startsWith(x))).length })).filter((x) => x.n);
  return scored.sort((a, b) => b.n - a.n)[0]?.v || null;
}

// The LED wall's first look: the event's words in the theme colours (the AI artwork goes behind them when ready).
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
function ledContent(plan) {
  const pal = plan.design?.theme?.palette?.map((c) => c.hex) || [];
  const dark = [...pal].sort((a, b) => lum(a) - lum(b))[0] || "#1B1B1F";
  const accent = pal.find((c) => c !== dark && lum(c) > 60 && lum(c) < 200) || plan.colors.accent;
  return { mode: "design", template: "headline", title: plan.design?.screenTitle || plan.screenText || plan.eventName, subtitle: plan.design?.theme?.name || "", bg: dark, fg: "#FFFFFF", accent, font: "serif", align: "center" };
}



// One layout of a planned event, solved in the room with its real furniture and LED wall.
async function solvedOption(vp, venue, room) {
  const solved = solveLayout(vp, room);
  const scene = sceneFrom(solved, venue);
  scene.objects = (await furnish(scene.objects, vp.design)).map((o) => (o.type === "led_screen" ? { ...o, content: ledContent(vp) } : o));
  return { layout: vp.layout, scene, stats: solved.stats, checks: solved.checks };
}
// What the scene agent is asked to build: the concept image read as production steps when there is one.

/** The chat agent's "design the event": brief -> designer plan -> best layout -> furniture -> dressing -> LED art. */
async function designFromChat(brief, current, { venue, room, userId }) {
  const { plan } = await planFromBrief(brief, { guests: current.plan?.guests, eventName: current.plan?.eventName });
  const vp = variantsOf(plan)[0];
  const art = plan.design?.screenArt && imagesEnabled() ? generateGraphic(plan.design.screenArt, { aspect: "16:9", colors: plan.design.theme?.palette?.map((c) => `${c.name} ${c.hex}`), feature: "LED wall artwork" })
    .then((img) => saveBase64("graphics", img.base64, img.mimeType.includes("jpeg") ? "jpg" : "png")).catch(() => null) : Promise.resolve(null);
  let scene = (await solvedOption(vp, venue, room)).scene;
  // built from the designer's spec, like a new mockup; the app then renders its concept from this scene
  if (plan.design?.build) {
    const built = await buildDesign(scene, plan, { room, userId });
    scene = { ...built.scene, checks: scene.checks, stats: scene.stats };
  }
  scene.redesigned = true;
  const artUrl = await art;
  lap("artwork ready");
  scene.objects = scene.objects.map((x) => (x.type === "led_screen" ? { ...x, content: { ...ledContent(plan), ...(artUrl ? { template: "photo", imageUrl: artUrl, overlay: 0.3 } : {}) } } : x));
  return scene;
}

// Step 1 of a new mockup: the brief is read by a designer (GPT-4o), each of three
// layouts is solved and then dressed by the scene agent, and Nano Banana paints
// the LED wall artwork meanwhile. Nothing is saved yet.
projects.post("/generate", async (req, res) => {
  // venueMode: "auto" (a venue the brief names, else open air for an outdoor event, else a plain hall),
  // "venue" (venueId), "none" (a plain hall) or "outdoor" (open air)
  const { brief = "", venueId, venueChosen, guests, eventName, eventType, colors, include, layout } = req.body || {};
  const venueMode = req.body?.venueMode || (venueChosen && venueId ? "venue" : "auto");
  const t0 = Date.now(), lap = (what) => console.log(`[generate] ${what} at ${Math.round((Date.now() - t0) / 1000)} s`);
  const { plan, source } = await planFromBrief(brief, { guests, eventName, eventType, colors, include, layout });
  lap("planned");
  if (venueMode === "outdoor") plan.design = { ...(plan.design || {}), setting: "outdoor" };
  if (venueMode === "none" || venueMode === "venue") plan.design = { ...(plan.design || {}), setting: "indoor" };

  // the venue the brief names wins over a default pick; a venue we don't have yet is reported back
  const mine = await q("SELECT id, name FROM venues WHERE user_id = ?", [req.user.id]);
  let useId = venueMode === "venue" ? venueId || null : null, venueNote = null;
  const mention = plan.design?.venueMention;
  if (mention && venueMode === "auto") {
    const hit = matchVenue(mention, mine);
    if (hit) { useId = hit.id; venueNote = { mention, match: { id: hit.id, name: hit.name } }; plan.design.setting = "indoor"; }
    else if (plan.design?.setting !== "outdoor") venueNote = { mention, missing: true };
  }
  const outdoor = !useId && plan.design?.setting === "outdoor";
  sourceAhead(plan, req.user.id); // the props and furniture are searched for while the layouts are solved
  const ground = outdoor ? groundFinish(plan.design?.ground) : null; // and the ground scan is fetched
  const { venue, room } = outdoor ? { venue: null, room: outdoorSite(plan.guests) } : await roomFor(useId);

  const d = plan.design;
  const art = d?.screenArt && imagesEnabled()
    ? generateGraphic(d.screenArt, { aspect: "16:9", colors: d.theme?.palette?.map((c) => `${c.name} ${c.hex}`), feature: "LED wall artwork" })
      .then((img) => {
        const url = saveBase64("graphics", img.base64, img.mimeType.includes("jpeg") ? "jpg" : "png");
        addToLibrary(req.user.id, { source: "ai", name: `${plan.eventName} — LED artwork`, url }).catch(() => undefined);
        return url;
      })
      .catch((e) => { console.warn("[generate] LED artwork failed:", e.message); return null; })
    : Promise.resolve(null);

  const options = await Promise.all(variantsOf(plan).map((vp) => solvedOption(vp, venue, room)));
  lap("layouts solved");
  // every design is built from the designer's spec — the same decor, branding and light on each layout.
  // The concept pictures are rendered afterwards from these scenes (POST /projects/concept), so they show
  // exactly what was built.
  if (plan.design?.build) {
    const built = async (o) => {
      try {
        const { scene, log } = await buildDesign(o.scene, plan, { room, userId: req.user.id });
        o.scene = { ...scene, checks: o.scene.checks, stats: o.scene.stats };
        o.build = log;
      } catch (e) { console.warn("[generate] building the design failed:", e.message); }
    };
    await Promise.all(options.map(built)); // the models and graphics are shared promises, made once for all
    lap("built");
  }
  // the LED wall always shows the designed title, over the Nano Banana artwork when there is one
  const artUrl = await art;
  lap("artwork ready");
  for (const o of options) {
    o.scene.objects = o.scene.objects.map((x) => (x.type === "led_screen" ? { ...x, content: { ...ledContent(plan), ...(artUrl ? { template: "photo", imageUrl: artUrl, overlay: 0.3 } : {}) } } : x));
  }
  const groundScan = await ground;
  for (const o of options) {
    if (!outdoor) continue;
    const env = o.scene.environment || {};
    o.scene.environment = { ...env, setting: "outdoor", ground: plan.design?.ground || "grass", ...(groundScan && !env.venueFinishes?.floor ? { venueFinishes: { ...(env.venueFinishes || {}), floor: groundScan } } : {}) };
  }
  res.json({ source, plan, options, venue: venue ? { id: venue.id, name: venue.name } : null, setting: outdoor ? "outdoor" : "indoor", venueNote, art: artUrl });
});

// Step 2: create the project from the chosen option.
projects.post("/", async (req, res) => {
  const { name, venueId, brief, scene, eventType, guests, brandKitId } = req.body || {};
  if (!name) return res.status(400).json({ error: "Give the project a name." });
  const r = await q("INSERT INTO projects (user_id, venue_id, brand_kit_id, name, event_type, guests, brief) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.user.id, venueId || null, brandKitId || null, name, eventType || scene?.plan?.eventType || "gala", guests || scene?.plan?.guests || 100, brief || null]);
  if (scene) await saveVersion(r.insertId, scene, "Design chosen", "ai");
  if (req.body?.concept) {
    await q("INSERT INTO renders (project_id, kind, file_url, prompt, version) VALUES (?, 'enhanced', ?, ?, 1)", [r.insertId, req.body.concept, "AI concept of the design"]);
    await q("UPDATE projects SET thumbnail_url = ? WHERE id = ?", [req.body.concept, r.insertId]);
  }
  res.json(await one("SELECT * FROM projects WHERE id = ?", [r.insertId]));
});

projects.patch("/:id", async (req, res) => {
  const p = await owned(req, res, { edit: true }); if (!p) return;
  const { name, status, thumbnailUrl } = req.body || {};
  await q("UPDATE projects SET name = COALESCE(?, name), status = COALESCE(?, status), thumbnail_url = COALESCE(?, thumbnail_url) WHERE id = ?", [name || null, status || null, thumbnailUrl || null, p.id]);
  res.json(await one("SELECT * FROM projects WHERE id = ?", [p.id]));
});

projects.delete("/:id", async (req, res) => {
  const p = await owned(req, res, { owner: true }); if (!p) return;
  await q("DELETE FROM projects WHERE id = ?", [p.id]);
  res.json({ ok: true });
});

// Save the editor's scene as a new version.
projects.post("/:id/versions", async (req, res) => {
  const p = await owned(req, res, { edit: true }); if (!p) return;
  if (!req.body?.scene) return res.status(400).json({ error: "Nothing to save." });
  if (req.body.autosave) {
    // autosaves fold into one running version (until a manual save, or after 10 minutes), so history stays readable
    const last = await one("SELECT id, version, created_by, created_at FROM scene_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1", [p.id]);
    if (last && last.created_by === "autosave" && Date.now() - new Date(last.created_at).getTime() < 10 * 60_000) {
      await q("UPDATE scene_versions SET scene = ? WHERE id = ?", [JSON.stringify(req.body.scene), last.id]);
      await q("UPDATE projects SET updated_at = NOW() WHERE id = ?", [p.id]);
      return res.json({ version: last.version, autosaved: true });
    }
    return res.json({ version: await saveVersion(p.id, req.body.scene, "Autosaved", "autosave"), autosaved: true });
  }
  const version = await saveVersion(p.id, req.body.scene, req.body.label || "Edited", "user");
  res.json({ version });
});

projects.get("/:id/versions", async (req, res) => {
  const p = await owned(req, res); if (!p) return;
  const rows = await q("SELECT id, version, label, created_by, created_at FROM scene_versions WHERE project_id = ? ORDER BY version DESC", [p.id]);
  const approvals = await q("SELECT version, approver_name, created_at FROM approvals WHERE project_id = ?", [p.id]);
  res.json(rows.map((r) => ({ ...r, approval: approvals.find((a) => a.version === r.version) || null })));
});

projects.get("/:id/versions/:version", async (req, res) => {
  const p = await owned(req, res); if (!p) return;
  const v = await one("SELECT * FROM scene_versions WHERE project_id = ? AND version = ?", [p.id, req.params.version]);
  if (!v) return res.status(404).json({ error: "Version not found." });
  res.json({ ...v, scene: json(v.scene) });
});

// AI chat edit: returns the new scene (not saved until the editor saves it).
projects.post("/:id/ai-edit", async (req, res) => {
  const p = await owned(req, res, { edit: true }); if (!p) return;
  const { instruction, scene, history } = req.body || {};
  if (!instruction || !scene) return res.status(400).json({ error: "Send an instruction and the current scene." });
  // an open-air project keeps its open-air site
  const { venue, room } = !p.venue_id && scene.environment?.setting === "outdoor" ? { venue: null, room: outdoorSite(scene.plan?.guests) } : await roomFor(p.venue_id);
  // re-lay-out the seating, keeping everything the user placed, the chosen models and the lighting
  const relayout = (current, patch) => {
    const solved = solveLayout(mergePlan(current.plan || {}, patch || {}), room);
    return { ...sceneFrom(solved, venue), environment: current.environment, objects: [...carryAssets(current.objects, solved.objects), ...(current.objects || []).filter((o) => o.userAdded)] };
  };
  if (agentEnabled()) {
    try {
      const out = await runAgent(instruction, scene, { room, history, userId: req.user.id, maxSteps: 16, relayout: async (s, patch) => relayout(s, patch), design: (brief, s) => designFromChat(brief, s, { venue, room, userId: req.user.id }) });
      // after a redesign the app renders the concept picture from the new 3D scene itself
      const { concept: _old, redesigned, ...scene2 } = out.scene;
      return res.json({ reply: out.reply, source: "agent", scene: scene2, redesigned: !!redesigned });
    } catch (e) {
      console.warn("[ai] agent failed, falling back:", e.message);
    }
  }
  const result = await editFromInstruction(instruction, scene);
  let next = { ...scene };
  if (result.planPatch) next = relayout(scene, result.planPatch);
  if (result.ops?.length) next.objects = applyOps(next.objects, result.ops);
  res.json({ reply: result.reply, source: result.source, scene: next });
});

// Re-run the solver for the current plan (e.g. after the guest count changes).
projects.post("/:id/relayout", async (req, res) => {
  const p = await owned(req, res, { edit: true }); if (!p) return;
  const { venue, room } = await roomFor(p.venue_id);
  const solved = solveLayout(mergePlan(req.body.plan || {}, req.body.patch || {}), room);
  const scene = sceneFrom(solved, venue);
  scene.objects = carryAssets(req.body.objects, scene.objects);
  res.json({ scene });
});

projects.post("/:id/share", async (req, res) => {
  const p = await owned(req, res); if (!p) return;
  const token = p.share_token || crypto.randomBytes(12).toString("hex");
  await q("UPDATE projects SET share_token = ?, status = IF(status = 'approved', status, 'in_review') WHERE id = ?", [token, p.id]);
  res.json({ token });
});

projects.get("/:id/comments", async (req, res) => {
  const p = await owned(req, res); if (!p) return;
  res.json(await q("SELECT * FROM comments WHERE project_id = ? ORDER BY created_at", [p.id]));
});

projects.patch("/:id/comments/:cid", async (req, res) => {
  const p = await owned(req, res, { edit: true }); if (!p) return;
  await q("UPDATE comments SET resolved = ? WHERE id = ? AND project_id = ?", [req.body.resolved ? 1 : 0, req.params.cid, p.id]);
  res.json({ ok: true });
});

// The concept picture of a design, rendered from its 3D: the app sends a hero view of the built scene.
projects.post("/concept", async (req, res) => {
  const { dataUrl, scene: whole, plan, visible } = req.body || {};
  // only what the camera sees is described to the renderer, so nothing off-camera is painted into the picture
  const scene = whole && Array.isArray(visible) ? { ...whole, objects: whole.objects.filter((o) => visible.includes(o.id)) } : whole;
  if (!dataUrl || !scene) return res.status(400).json({ error: "Send a view of the scene to render." });
  if (!imagesEnabled()) return res.status(400).json({ error: "Add GEMINI_API_KEY (or Nano Banana) to server/.env to render concepts." });
  try {
    const view = dataUrl.replace(/^data:[^;]+;base64,/, "");
    // the 3D view is kept with its concept, so the two can always be compared
    const viewUrl = saveBase64("graphics", view, "png");
    const { img, check } = await conceptFromScene(view, scene, plan || whole.plan);
    const url = saveBase64("graphics", img.base64, img.mimeType.includes("jpeg") ? "jpg" : "png");
    res.json({ url, view: viewUrl, matches: check.same, issues: check.issues });
  } catch (e) {
    const credits = /credit|quota|balance|billing|payment/i.test(e.message);
    res.status(502).json({ error: credits
      ? "The image service is out of credits, so the concept can't be rendered. Top up Nano Banana (nanobnana.com) or add GEMINI_API_KEY to server/.env, then try again."
      : `The concept couldn't be rendered: ${e.message}` });
  }
});

// ---------- people working on the project together ----------

projects.get("/:id/members", async (req, res) => {
  const p = await owned(req, res); if (!p) return;
  const owner = await one("SELECT id, name, email FROM users WHERE id = ?", [p.user_id]);
  const rows = await q(`SELECT u.id, u.name, u.email, m.role, m.created_at FROM project_members m JOIN users u ON u.id = m.user_id
                         WHERE m.project_id = ? ORDER BY m.created_at`, [p.id]);
  res.json({ owner, members: rows, myRole: p.my_role });
});

// Invite someone with a Novira account by email; they find the project in their list and can edit it live.
projects.post("/:id/members", async (req, res) => {
  const p = await owned(req, res, { owner: true }); if (!p) return;
  const email = String(req.body?.email || "").toLowerCase().trim(), role = req.body?.role === "viewer" ? "viewer" : "editor";
  if (!email) return res.status(400).json({ error: "Enter their email address." });
  const u = await one("SELECT id, name, email FROM users WHERE email = ?", [email]);
  if (!u) return res.status(404).json({ error: `No one has a Novira account with ${email} yet. Ask them to sign up, then invite them again.` });
  if (u.id === p.user_id) return res.status(400).json({ error: "That's you — you already own this project." });
  await q("INSERT INTO project_members (project_id, user_id, role, invited_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [p.id, u.id, role, req.user.id]);
  res.json({ ...u, role });
});

projects.delete("/:id/members/:userId", async (req, res) => {
  // the owner removes anyone; a member can leave
  const p = await owned(req, res); if (!p) return;
  if (p.my_role !== "owner" && Number(req.params.userId) !== req.user.id) return res.status(403).json({ error: "Only the project's owner can do that." });
  await q("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", [p.id, req.params.userId]);
  res.json({ ok: true });
});

// The live channel: changes and who is where, between everyone with the project open.
projects.get("/:id/live", async (req, res) => {
  const p = await owned(req, res); if (!p) return;
  live.join(p, req, res);
});
projects.post("/:id/live", async (req, res) => {
  const p = await owned(req, res); if (!p) return;
  if (req.body?.kind === "ops" && p.my_role === "viewer") return res.status(403).json({ error: "You can view this project but not change it." });
  live.send(p, req, res);
});
