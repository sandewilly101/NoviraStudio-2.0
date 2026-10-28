import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const env = process.env;

export const config = {
  port: Number(env.PORT || 4000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 4000}`).replace(/\/$/, ""),
  jwtSecret: env.JWT_SECRET || "dev-only-secret-change-me",
  uploadsDir: path.join(root, "uploads"),
  db: {
    host: env.DB_HOST || "127.0.0.1",
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || "root",
    password: env.DB_PASSWORD || "",
    name: env.DB_NAME || "novira_studio",
  },
  // imageModel: OpenAI's picture model; imageProvider: which service draws pictures first ("openai" | "nanobanana" | "gemini")
  openai: { apiKey: env.OPENAI_API_KEY || "", model: env.OPENAI_MODEL || "gpt-4o", imageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-2" },
  imageProvider: (env.IMAGE_PROVIDER || "openai").toLowerCase(),
  gemini: { apiKey: env.GEMINI_API_KEY || "", imageModel: env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image" },
  // model: nano | nano2 | nano2pro (best); resolution: 1K | 2K | 4K
  nanobanana: { apiKey: env.NANOBANANA_API_KEY || "", base: (env.NANOBANANA_BASE || "https://nanobnana.com").replace(/\/$/, ""), model: env.NANOBANANA_MODEL || "nano2pro", resolution: env.NANOBANANA_RESOLUTION || "4K" },
  cloudinary: { cloud: env.CLOUDINARY_CLOUD_NAME || "", key: env.CLOUDINARY_API_KEY || "", secret: env.CLOUDINARY_API_SECRET || "" },
  sketchfab: { token: env.SKETCHFAB_API_TOKEN || "" },
  seedVenuePath: env.SEED_VENUE_PATH || "",
};
