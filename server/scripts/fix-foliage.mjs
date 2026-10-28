// One-off: cut leaves out of their cards and make foliage matte on already-imported plants (backs each changed file up as .bak.glb first).
import fs from "node:fs";
import path from "node:path";
import { initDb, q } from "../src/db.js";
import { config } from "../src/config.js";
import { fixFoliage } from "../src/optimize.js";
await initDb();
const PLANT = /plant|palm|fern|tree|flower|bouquet|ivy|monstera|leaf|foliage|succulent|orchid|rose|dahlia|hydrangea|eucalyptus|garland|greenery|bush|shrub/i;
for (const a of await q("SELECT name, file_url FROM assets WHERE file_url LIKE '%.glb'")) {
  if (!PLANT.test(a.name)) continue;
  const file = path.join(config.uploadsDir, decodeURIComponent(a.file_url.replace(/^\/uploads\//, "")));
  if (!fs.existsSync(file) || fs.existsSync(`${file}.foliage`)) continue; // done already
  const before = fs.readFileSync(file), backup = file.replace(/\.glb$/, ".bak.glb");
  try {
    const changed = await fixFoliage(file, { name: a.name });
    if (changed.length) { if (!fs.existsSync(backup)) fs.writeFileSync(backup, before); fs.writeFileSync(`${file}.foliage`, JSON.stringify(changed)); console.log(`${a.name}: ${changed.filter((c) => c.includes("cut out")).length} leaf sets cut out, ${changed.filter((c) => c.includes("matte")).length} made matte`); }
  } catch (e) { console.log(`${a.name}: skipped (${e.message})`); }
}
process.exit(0);
