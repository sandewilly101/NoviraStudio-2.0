// Repairs common faults in downloaded .glb files so three.js can load them.
//
// Seen in the wild (BlenderKit): a texture with no `source` and no extension
// source. GLTFLoader then reads `images[undefined].uri` and the whole model
// fails. The texture is pointed at a 1×1 white image instead, which keeps every
// index in the file valid and renders as "no texture".
import fs from "node:fs";

const WHITE_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const SOURCE_EXTS = ["EXT_texture_webp", "KHR_texture_basisu", "EXT_texture_avif", "MSFT_texture_dds"];

export function repairGlbFile(file) {
  if (fs.existsSync(`${file}.opt`)) return { changed: false }; // already repaired and optimised
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "glTF") return { changed: false };
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) return { changed: false }; // first chunk must be JSON
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const rest = buf.subarray(20 + jsonLen);

  let fixed = 0, white = -1;
  for (const tex of json.textures || []) {
    const hasExtSource = SOURCE_EXTS.some((e) => tex.extensions?.[e]?.source !== undefined);
    if (tex.source === undefined && !hasExtSource) {
      if (white < 0) { json.images = json.images || []; white = json.images.push({ uri: WHITE_PNG, mimeType: "image/png", name: "novira-placeholder" }) - 1; }
      tex.source = white;
      fixed++;
    }
  }
  if (!fixed) return { changed: false };

  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += " "; // chunks are 4-byte aligned
  const jsonBuf = Buffer.from(text, "utf8");
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonBuf.length + rest.length, 8);
  header.writeUInt32LE(jsonBuf.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(file, Buffer.concat([header, jsonBuf, rest]));
  return { changed: true, fixed };
}
