// Render a frame against a project's latest scene description: node scripts/render-scene.mjs <projectId> <frame.png> <out.png>
import fs from "node:fs";
import { initDb, q, json } from "../src/db.js";
import { enhanceRender } from "../src/ai/images.js";
import { describeScene } from "../src/ai/describe.js";
const [pid, src, out] = process.argv.slice(2);
await initDb();
const [v] = await q("SELECT scene FROM scene_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1", [pid]);
const scene = json(v.scene);
const t0 = Date.now();
const img = await enhanceRender(fs.readFileSync(src).toString("base64"), { eventType: scene.plan?.eventType || "wedding", inventory: describeScene(scene), mode: scene.environment?.mode, resolution: "2K" });
fs.writeFileSync(out, Buffer.from(img.base64, "base64"));
console.log("done in", Math.round((Date.now() - t0) / 1000), "s;", describeScene(scene).filter((l) => /light|floor/.test(l)).join(" | "));
process.exit(0);
