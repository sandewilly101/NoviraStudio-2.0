// One-off: remove simulation domains and other helper boxes from downloaded models.
import fs from "node:fs";
import { cleanGlb } from "../src/optimize.js";
const dir = new URL("../uploads/assets/", import.meta.url);
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".glb"))) {
  try { const r = await cleanGlb(new URL(f, dir).pathname.replace(/^\/(\w:)/, "$1")); if (r.length) console.log(f, "removed", r.join(", ")); }
  catch (e) { console.log(f, "skipped:", e.message); }
}
