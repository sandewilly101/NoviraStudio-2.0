// Try a preview render outside the app: node scripts/render-try.mjs <frame.png> <out.png>
import fs from "node:fs";
import { enhanceRender } from "../src/ai/images.js";
const [src, out] = process.argv.slice(2);
const t0 = Date.now();
const img = await enhanceRender(fs.readFileSync(src).toString("base64"), { eventType: "corporate gala", inventory: ["12 round banquet tables with white floor-length cloths", "a 6.1 m stage with a white deck"] });
const b = Buffer.from(img.base64, "base64");
fs.writeFileSync(out, b);
console.log("done in", Math.round((Date.now() - t0) / 1000), "s ·", img.mimeType, "·", b.readUInt32BE(16), "x", b.readUInt32BE(20), "·", Math.round(b.length / 1024), "KB");
