import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repairGlbFile } from "../src/gltfRepair.js";

function glb(json, bin = Buffer.alloc(8)) {
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += " ";
  const j = Buffer.from(text);
  const h = Buffer.alloc(20);
  h.write("glTF", 0, "ascii"); h.writeUInt32LE(2, 4);
  h.writeUInt32LE(20 + j.length + 8 + bin.length, 8); h.writeUInt32LE(j.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, j, bh, bin]);
}
const readJson = (file) => { const b = fs.readFileSync(file); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); };

test("a texture with no image source gets a placeholder image", () => {
  const file = path.join(os.tmpdir(), `novira-repair-${Date.now()}.glb`);
  fs.writeFileSync(file, glb({ asset: { version: "2.0" }, images: [{ uri: "a.png" }], textures: [{ extensions: {}, sampler: 0 }, { source: 0 }] }));
  const r = repairGlbFile(file);
  assert.deepEqual(r, { changed: true, fixed: 1 });
  const j = readJson(file);
  assert.equal(j.textures[0].source, 1);
  assert.match(j.images[1].uri, /^data:image\/png;base64,/);
  const b = fs.readFileSync(file);
  assert.equal(b.readUInt32LE(8), b.length, "header length matches file");
  assert.equal(b.readUInt32LE(12) % 4, 0, "JSON chunk stays 4-byte aligned");
});

test("valid files are left untouched", () => {
  const file = path.join(os.tmpdir(), `novira-ok-${Date.now()}.glb`);
  const data = glb({ asset: { version: "2.0" }, images: [{ uri: "a.webp" }], textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }] });
  fs.writeFileSync(file, data);
  assert.deepEqual(repairGlbFile(file), { changed: false });
  assert.ok(fs.readFileSync(file).equals(data));
});
