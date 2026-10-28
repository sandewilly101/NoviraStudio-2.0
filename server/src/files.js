import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { config } from "./config.js";

export function ensureDir(sub) {
  const dir = path.join(config.uploadsDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Stored relative to the API origin so a port or domain change never breaks saved links.
export const publicUrl = (sub, file) => `/uploads/${sub}/${encodeURIComponent(file)}`;
const stamp = () => `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

export function saveBase64(sub, base64, ext = "png") {
  const dir = ensureDir(sub);
  const name = `${stamp()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64"));
  return publicUrl(sub, name);
}

export async function saveFromUrl(sub, url, ext, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const dir = ensureDir(sub);
  const name = `${stamp()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
  return publicUrl(sub, name);
}

export function uploader(sub, { maxMb = 600, exts = null } = {}) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureDir(sub)),
    filename: (_req, file, cb) => cb(null, `${stamp()}${path.extname(file.originalname).toLowerCase()}`),
  });
  return multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!exts) return cb(null, true);
      const ok = exts.includes(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : new Error(`Allowed file types: ${exts.join(", ")}`), ok);
    },
  });
}
