// Pictures: photoreal renders from a 3D screenshot (concepts, previews), brand
// graphics (backdrops, banners, LED-wall art) and fabric swatches from a prompt.
//
// Three providers, tried in order (IMAGE_PROVIDER first, default OpenAI), each only
// if its key is set; when one can't serve (no credits, quota, billing), the next takes over:
//  · OPENAI_API_KEY — OpenAI's gpt-image-1 (generate, and edit for 3D views).
//  · NANOBANANA_API_KEY — the nanobnana.com API (task + polling). Its edit
//    endpoint only accepts public image links, so the screenshot is hosted on
//    Cloudinary first (works from localhost).
//  · GEMINI_API_KEY — Google's Gemini image model directly.
// Every call is recorded in AI usage.
import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { imageEdit, imageGenerate, imageSize, openai } from "./openai.js";
import { recordUsage } from "../usage.js";

const gemini = config.gemini.apiKey ? new GoogleGenAI({ apiKey: config.gemini.apiKey }) : null;
const nano = config.nanobanana.apiKey ? config.nanobanana : null;
const cloud = config.cloudinary.cloud && config.cloudinary.key && config.cloudinary.secret ? config.cloudinary : null;

const LABEL = { openai: `OpenAI ${config.openai.imageModel}`, nanobanana: "Nano Banana (nanobnana.com)", gemini: `Gemini · ${config.gemini.imageModel}` };
const available = { openai: !!openai, nanobanana: !!nano, gemini: !!gemini };
/** The providers to try, in order: the chosen one first, then the others that are set up. */
const order = () => [config.imageProvider, "openai", "nanobanana", "gemini"].filter((v, i, a) => available[v] && a.indexOf(v) === i);
export const imagesEnabled = () => order().length > 0;
export const imagesProvider = () => LABEL[order()[0]] || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- prompts ----------
// The render must show *this* design, so the prompt pins down the geometry and
// lists what is in the frame with its real colours, instead of inviting the
// model to imagine a generic event.
// How the room is lit in the photograph: a real event is lit by its fixtures, not by flat studio light.
function lightingBrief({ eventType, mode, lighting }) {
  // celebrations happen in the evening; conferences and exhibitions by day unless the scene is set to night
  const evening = mode === "night" || ["wedding", "gala", "dinner", "party", "launch"].includes(eventType);
  return evening ? [
    "Light it as the event itself, in the evening: the venue's house lights dimmed to a warm low glow (about 2700 K), so the room's mood comes from the event lighting.",
    "Every fixture listed lights only where it is aimed — truss washes pour warm pools of light over the stage and the area in front of it; uplighters throw soft graded washes up the walls from the floor;",
    "the LED wall glows brightly and spills its colours onto the stage and the floor in front; candles flicker warm on the tables; tablecloths catch soft light while the room's edges fall gently into shadow.",
    "Natural light falloff, deep but not crushed blacks, a gentle haze only where beams are listed. Exactly the fixtures listed, in the numbers listed — never add uplighters, spotlights or any other light source; areas without a fixture get only the soft ambient glow.",
  ] : [
    `Light it as a real daytime event${lighting ? ` under a "${lighting}" mood` : ""}: soft natural ambient light filling the room, the venue's own ceiling lights on, the event fixtures adding gentle accents where they are aimed, the LED wall glowing.`,
    "Natural light falloff and soft, accurate shadows; no flat, shadowless studio look.",
  ];
}

function enhancePrompt({ lighting, eventType, extra, inventory = [], mode }) {
  return [
    `Re-render this 3D visualisation of a ${eventType} as a high-end, photorealistic event photograph:`,
    "shot on a full-frame camera with a wide rectilinear lens, straight verticals, high dynamic range, tack-sharp detail edge to edge.",
    "Physically real materials, each with its true finish: woven carpet stays matte (no reflections, no gloss, no wet look), linen and velour are soft and matte, brushed aluminium truss has a satin sheen; only genuinely glossy surfaces (a gloss dance floor, the LED wall, polished metal) reflect.",
    ...lightingBrief({ eventType, mode, lighting }),
    "Accurate contact shadows and ambient occlusion under every table and chair. Magazine-quality event photography — elegant, rich and inviting — with no noise, blur, plastic CG look, warped geometry or AI artefacts.",
    "Preserve exactly: the same camera angle, lens and framing; the same room, walls, floor and ceiling;",
    "every object in exactly the same position, size and rotation; the same number of every item;",
    "the same colours of every object, fabric and surface; and the same text and images on screens and signs, letter for letter.",
    "Do not add anything that is not already in the image (no extra furniture, people, plants, flowers, balloons, signage, lights or decoration).",
    "Do not remove, move, restyle or recolour anything. Do not change the layout. Do not crop or zoom.",
    "Every piece of furniture keeps its exact model and shape: square or rounded-square tables stay that shape, bare tables stay bare (never add tablecloths), and table tops keep their material.",
    inventory.length ? `The image contains: ${inventory.join("; ")}.` : "",
    "No watermark, no text overlays.",
    extra || "",
  ].filter(Boolean).join(" ");
}
function graphicPrompt(prompt, colors) {
  return `Design a flat event graphic for printing or an LED wall. ${prompt}. ` +
    (colors?.length ? `Use this colour palette: ${colors.join(", ")}. ` : "") +
    `High contrast, clean, elegant, no watermark. Absolutely no text, letters, numbers, words, dates or logos anywhere in the image unless the prompt above quotes the exact words to write.`;
}

// ---------- Cloudinary: give a local frame a public URL ----------
async function hostOnCloudinary(base64, mimeType = "image/png") {
  if (!cloud) throw new Error("Nano Banana needs a public image link. Add CLOUDINARY_* keys to server/.env, or set GEMINI_API_KEY instead.");
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "novira-studio/frames";
  const signature = crypto.createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${cloud.secret}`).digest("hex");
  const form = new FormData();
  form.append("file", `data:${mimeType};base64,${base64}`);
  form.append("api_key", cloud.key);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("signature", signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud.cloud}/image/upload`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) throw new Error(`Couldn't host the frame on Cloudinary: ${data.error?.message || res.status}`);
  return data.secure_url;
}

// ---------- nanobnana.com ----------
async function nanoFetch(path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${nano.base}${path}`, {
      method: body ? "POST" : "GET",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${nano.apiKey}`, "User-Agent": "NoviraStudio/0.1", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json().catch(() => ({}));
  } finally { clearTimeout(t); }
}

function imageUrlFrom(response) {
  if (!response) return null;
  if (Array.isArray(response)) return typeof response[0] === "string" ? response[0] : null;
  if (typeof response === "string") {
    const s = response.trim();
    if (/^https?:\/\//i.test(s)) return s;
    try { const p = JSON.parse(s); return Array.isArray(p) && typeof p[0] === "string" ? p[0] : null; } catch { return null; }
  }
  if (Array.isArray(response.images) && typeof response.images[0] === "string") return response.images[0];
  return null;
}

// The edit pipeline (v1) reports numeric status (3 running, 1 done, -1/2 failed);
// the generate pipeline (v2) reports strings (IN_PROGRESS / SUCCESS / FAILED).
async function nanoTask(createPath, body, statusPath) {
  const started = await nanoFetch(createPath, body);
  const taskId = started.data?.task_id || started.task_id;
  if (started.code !== 200 || !taskId) throw new Error(started.message || started.msg || "Nano Banana rejected the request.");
  const deadline = Date.now() + 8 * 60_000; // 4K renders on the pro model take a few minutes
  while (Date.now() < deadline) {
    await sleep(3000);
    const p = await nanoFetch(`${statusPath}?task_id=${encodeURIComponent(taskId)}`).catch(() => ({}));
    const d = p.data || {};
    const state = String(d.status ?? "").toUpperCase();
    const code = typeof d.status === "number" ? d.status : d.status_code;
    if (state === "SUCCESS" || code === 1) {
      const url = imageUrlFrom(d.response);
      if (!url) throw new Error("Nano Banana finished without returning an image.");
      return url;
    }
    if (state === "FAILED" || state === "ERROR" || code === -1 || code === 2) {
      throw new Error(d.error_message || (code === 2 ? "Nano Banana couldn't read the source frame." : "Nano Banana failed to render this image."));
    }
  }
  throw new Error("Nano Banana didn't finish within 8 minutes.");
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the result (${res.status}).`);
  return { base64: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: res.headers.get("content-type") || "image/png" };
}

// ---------- Gemini ----------
async function geminiGenerate(parts) {
  const res = await gemini.models.generateContent({ model: config.gemini.imageModel, contents: [{ role: "user", parts }] });
  const out = res.candidates?.[0]?.content?.parts || [];
  const img = out.find((p) => p.inlineData?.data);
  if (!img) throw new Error(out.map((p) => p.text).filter(Boolean).join(" ") || "The image model returned no image.");
  return { base64: img.inlineData.data, mimeType: img.inlineData.mimeType || "image/png" };
}

// ---------- public API ----------
// The width and height of a PNG / JPEG frame, so the render keeps its exact framing.
function frameSize(base64) {
  const b = Buffer.from(base64.slice(0, 200_000), "base64");
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let i = 2; i + 9 < b.length;) { // JPEG: walk to the start-of-frame marker
    if (b[i] !== 0xff) break;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

// A provider that couldn't serve (no credits, quota, billing, verification) is skipped for a while,
// so later requests don't wait on a failing call.
const downUntil = {};
async function draw(feature, ways) {
  let last = null;
  for (const p of order()) {
    if (!ways[p] || Date.now() < (downUntil[p] || 0)) continue;
    try {
      const img = await ways[p]();
      if (p !== "openai") recordUsage({ provider: p, model: p === "gemini" ? config.gemini.imageModel : nano.model, feature, kind: "image", images: 1, cost: null });
      return img;
    } catch (e) {
      last = e;
      if (p !== "openai") recordUsage({ provider: p, model: p === "gemini" ? config.gemini.imageModel : nano.model, feature, kind: "image", ok: false, cost: 0 });
      const unavailable = /credit|quota|balance|insufficient|billing|payment|verif|organi[sz]ation|402|403|429|limit/i.test(e.message);
      console.warn(`[images] ${LABEL[p]} failed (${e.message})${unavailable ? " — trying the next provider for 30 min" : ""}`);
      if (unavailable) downUntil[p] = Date.now() + 30 * 60 * 1000;
    }
  }
  throw last || new Error("No image service is set up: add OPENAI_API_KEY (or NANOBANANA_API_KEY / GEMINI_API_KEY) to server/.env.");
}

// Keeps the layout, changes only the look — on the best model, at high resolution, in the frame's own shape.
export async function enhanceRender(pngBase64, opts = {}) {
  const prompt = enhancePrompt({ lighting: opts.lighting, eventType: opts.eventType || "event", extra: opts.extra, inventory: opts.inventory, mode: opts.mode });
  const [w, h] = frameSize(pngBase64) || [16, 9];
  return draw(opts.feature || "Photoreal previews", {
    openai: () => imageEdit(opts.feature || "Photoreal previews", pngBase64, prompt, { size: imageSize(w, h) }),
    nanobanana: async () => {
      const source = await hostOnCloudinary(pngBase64);
      const body = { prompt, images: [source], model: nano.model, aspect_ratio: nearestAspect(`${w}:${h}`), resolution: opts.resolution || nano.resolution, output_format: "png" };
      return download(await nanoTask("/api/edit", body, "/api/status"));
    },
    gemini: () => geminiGenerate([{ text: prompt }, { inlineData: { mimeType: "image/png", data: pngBase64 } }]),
  });
}

const ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"];
function nearestAspect(aspect = "16:9") {
  const [w, h] = String(aspect).split(":").map(Number);
  if (!w || !h) return "16:9";
  const r = w / h;
  return ASPECTS.reduce((best, a) => { const [x, y] = a.split(":").map(Number); return Math.abs(x / y - r) < Math.abs(best[0] / best[1] - r) ? [x, y] : best; }, [16, 9]).join(":");
}

export async function generateGraphic(prompt, { aspect = "16:9", colors = [], feature = "Graphics" } = {}) {
  const text = graphicPrompt(prompt, colors);
  const [aw, ah] = String(aspect).split(":").map(Number);
  // medium: a banner or LED wall seen in the 3D view looks the same, made in a third of the time and cost
  return draw(feature, {
    openai: () => imageGenerate(feature, `${text} Composition for a ${aspect} frame.`, { size: imageSize(aw || 16, ah || 9), quality: "medium" }),
    nanobanana: async () => download(await nanoTask("/api/v2/generate", { prompt: text, aspect_ratio: nearestAspect(aspect), size: "2K", format: "png", samples: 1 }, "/api/v2/status")),
    gemini: () => geminiGenerate([{ text: `${text} Aspect ratio ${aspect}.` }]),
  });
}

// A material swatch: a flat, evenly lit, top-down texture that fills the frame (made seamless afterwards).
export async function generateTexture(prompt) {
  const text = `A flat, top-down, perfectly evenly lit texture scan of ${prompt}, filling the entire square frame edge to edge with the pattern repeating naturally — ` +
    "photographed straight on like a material sample for 3D rendering: true colours, fine real detail of the weave or grain, no folds, no wrinkles, no shadows, no perspective, no vignette, no borders, no objects, no text.";
  return draw("AI fabric textures", {
    openai: () => imageGenerate("AI fabric textures", text, { size: "1024x1024", quality: "medium" }),
    nanobanana: async () => download(await nanoTask("/api/v2/generate", { prompt: text, aspect_ratio: "1:1", size: "1K", format: "png", samples: 1 }, "/api/v2/status")),
    gemini: () => geminiGenerate([{ text: `${text} Square image.` }]),
  });
}

