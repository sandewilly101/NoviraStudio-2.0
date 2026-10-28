import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { initDb } from "./db.js";
import { ensureDir } from "./files.js";
import { authRouter, requireAuth } from "./auth.js";
import { venues } from "./routes/venues.js";
import { projects } from "./routes/projects.js";
import { assets, warmAssetFeeds } from "./routes/assets.js";
import { renders } from "./routes/renders.js";
import { share } from "./routes/share.js";
import { brand } from "./routes/brand.js";
import { hdris } from "./routes/hdris.js";
import { media } from "./routes/media.js";
import { materials } from "./routes/materials.js";
import { aiEnabled } from "./ai/planner.js";
import { imagesProvider } from "./ai/images.js";
import { usageSummary } from "./usage.js";
import { catalogEntries, ensureCatalog } from "./catalog.js";

// Express 4 doesn't catch rejected promises from async handlers; route them to the error handler.
for (const m of ["get", "post", "put", "patch", "delete"]) {
  const orig = express.Router[m];
  express.Router[m] = function (path, ...handlers) {
    return orig.call(this, path, ...handlers.map((h) => (typeof h === "function" && h.length < 4 ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h)));
  };
}

// A provider timing out (Poly Haven, BlenderKit, Nano Banana…) must never take the API down.
process.on("unhandledRejection", (e) => console.error("[novira] unhandled:", e?.message || e));
process.on("uncaughtException", (e) => console.error("[novira] uncaught:", e?.message || e));

const app = express();
app.use(cors());
app.use(express.json({ limit: "60mb" }));
ensureDir("");
// maxAge 0 + ETag: browsers revalidate, so a repaired or replaced file is never served stale.
app.use("/uploads", express.static(config.uploadsDir, { maxAge: 0, setHeaders: (res) => res.set("Access-Control-Allow-Origin", "*") }));

app.get("/api/health", (_req, res) => res.json({ ok: true, ai: aiEnabled() ? config.openai.model : "rules", images: imagesProvider(), sketchfabImport: !!config.sketchfab.token, assetProviders: ["sketchfab", "blenderkit", "polyhaven"] }));
app.use("/api/auth", authRouter);
app.use("/api/share", share);
app.use("/api/venues", requireAuth, venues);
app.use("/api/projects", requireAuth, projects);
app.use("/api/assets", requireAuth, assets);
// Real furniture models used by the layout solver's object types (public: the client review page needs them too).
app.get("/api/catalog", (_req, res) => res.json(catalogEntries()));
app.use("/api/renders", requireAuth, renders);
app.use("/api/brand-kits", requireAuth, brand);
app.use("/api/hdris", requireAuth, hdris);
app.use("/api/media", requireAuth, media);
app.use("/api/materials", requireAuth, materials);
// what the AI services have cost this account (Settings → AI usage)
app.get("/api/usage", requireAuth, async (req, res, next) => {
  try { res.json({ ...(await usageSummary(req.user.id, Number(req.query.days) || 30)), provider: imagesProvider() }); } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.status || 500;
  res.status(status).json({ error: err.message || "Something went wrong." });
});

await initDb();
ensureCatalog().then((items) => console.log(`  Furniture catalogue: ${items.length} real models ready`));
warmAssetFeeds().then(() => console.log("  Asset libraries warmed (BlenderKit, Poly Haven, Sketchfab)"));
setInterval(() => warmAssetFeeds().catch(() => undefined), 30 * 60_000).unref(); // keep the opening feeds fresh
app.listen(config.port, () => {
  console.log(`Novira Studio API on ${config.publicUrl}`);
  console.log(`  AI planner: ${aiEnabled() ? config.openai.model : "built-in rules (no OPENAI_API_KEY)"}`);
  console.log(`  Images:     ${imagesProvider() || "off (no NANOBANANA_API_KEY or GEMINI_API_KEY)"}`);
});
