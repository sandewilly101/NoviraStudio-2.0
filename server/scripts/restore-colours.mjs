// One-off: give already-imported models the colours their export lost (backs each changed file up as .bak.glb first).
import fs from "node:fs";
import path from "node:path";
import { initDb, q } from "../src/db.js";
import { config } from "../src/config.js";
import { restoreColours } from "../src/optimize.js";
await initDb();
for (const a of await q("SELECT name, thumbnail_url, file_url FROM assets WHERE file_url LIKE '%.glb'")) {
  const file = path.join(config.uploadsDir, decodeURIComponent(a.file_url.replace(/^\/uploads\//, "")));
  if (!fs.existsSync(file)) continue;
  const backup = file.replace(/\.glb$/, ".bak.glb");
  const before = fs.readFileSync(file);
  try {
    const changed = await restoreColours(file, { name: a.name, thumbnail: a.thumbnail_url });
    if (changed.length) { if (!fs.existsSync(backup)) fs.writeFileSync(backup, before); console.log(`${a.name}: ${changed.join(", ")}`); }
  } catch (e) { console.log(`${a.name}: skipped (${e.message})`); }
}
process.exit(0);
