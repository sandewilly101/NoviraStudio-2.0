// One OpenAI client for the whole server, and the calls through it recorded in
// AI usage (tokens, images, estimated cost) under the feature they served.
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { config } from "../config.js";
import { recordUsage } from "../usage.js";

export const openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey, maxRetries: 6 }) : null;

/** A chat completion, recorded as `feature`. */
export async function chat(feature, params) {
  try {
    const res = await openai.chat.completions.create(params);
    recordUsage({ provider: "openai", model: params.model, feature, kind: "text", input: res.usage?.prompt_tokens || 0, output: res.usage?.completion_tokens || 0 });
    return res;
  } catch (e) {
    recordUsage({ provider: "openai", model: params.model, feature, kind: "text", ok: false, cost: 0 });
    throw e;
  }
}

const IMAGE_MODEL = config.openai.imageModel;
/** gpt-image-1's three canvas sizes: the one nearest the wanted shape. */
export function imageSize(w, h) {
  const r = w / h;
  return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
}
function recordImage(feature, res, ok = true) {
  const u = res?.usage || {};
  recordUsage({ provider: "openai", model: IMAGE_MODEL, feature, kind: "image", input: u.input_tokens || 0, output: u.output_tokens || 0, imageInput: u.input_tokens_details?.image_tokens || 0, images: ok ? 1 : 0, ok, ...(ok ? {} : { cost: 0 }) });
}

/** A new picture from words. */
export async function imageGenerate(feature, prompt, { size = "1536x1024", quality = "high" } = {}) {
  try {
    const res = await openai.images.generate({ model: IMAGE_MODEL, prompt, size, quality, n: 1 });
    recordImage(feature, res);
    return { base64: res.data[0].b64_json, mimeType: "image/png" };
  } catch (e) { recordImage(feature, null, false); throw e; }
}

/** A picture redrawn from another (a 3D view made photoreal), keeping its composition. */
export async function imageEdit(feature, pngBase64, prompt, { size = "1536x1024", quality = "high" } = {}) {
  // the view cut to exactly the canvas's shape (from its centre), so the model never has to reframe it
  const [tw, th] = size.split("x").map(Number), src = sharp(Buffer.from(pngBase64, "base64")), meta = await src.metadata();
  let w = meta.width, h = meta.height;
  if (w / h > tw / th) w = Math.round(h * (tw / th)); else h = Math.round(w / (tw / th));
  const framed = await src.extract({ left: Math.floor((meta.width - w) / 2), top: Math.floor((meta.height - h) / 2), width: w, height: h }).resize(tw, th).png().toBuffer();
  const image = await toFile(framed, "view.png", { type: "image/png" });
  const call = (extra) => openai.images.edit({ model: IMAGE_MODEL, image, prompt, size, quality, n: 1, ...extra });
  try {
    // high input fidelity holds the composition and details of the view closely
    let res;
    try { res = await call({ input_fidelity: "high" }); }
    catch (e) { if (e.status === 400 && /input_fidelity/i.test(e.message)) res = await call({}); else throw e; }
    recordImage(feature, res);
    return { base64: res.data[0].b64_json, mimeType: "image/png" };
  } catch (e) { recordImage(feature, null, false); throw e; }
}
