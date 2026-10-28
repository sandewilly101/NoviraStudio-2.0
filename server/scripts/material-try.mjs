// Try an AI material outside the app: node scripts/material-try.mjs "red maasai shuka check fabric"
import { generateMaterial } from "../src/ai/texture.js";
const t0 = Date.now();
console.log(await generateMaterial(process.argv[2]), Math.round((Date.now() - t0) / 1000), "s");
