// What the paid AI services cost: every call is recorded with who it was for
// (from the signed-in request, carried along automatically), the service and
// model, the feature it served, its tokens or images, and an estimated cost from
// list prices. Settings → AI usage charts it.
import { AsyncLocalStorage } from "node:async_hooks";
import { q } from "./db.js";

/** Who the current request is for: set by requireAuth, read wherever an AI call happens. */
export const usageContext = new AsyncLocalStorage();

// USD per 1M tokens (OpenAI list prices; update here if they change). The gpt-image models bill their pictures as tokens too.
const PRICES = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-image-1": { textIn: 5, imageIn: 10, out: 40 },
  "gpt-image-2": { textIn: 5, imageIn: 8, out: 30 }, // as published October 2026
};
const price = (model) => PRICES[model] || PRICES[Object.keys(PRICES).find((k) => model?.startsWith(k))] || null;

/** Estimated cost of a call, or null when the service's prices aren't known. */
export function estimateCost(model, { input = 0, output = 0, imageInput = 0 } = {}) {
  const p = price(model);
  if (!p) return null;
  if (p.textIn != null) return ((input - imageInput) * p.textIn + imageInput * p.imageIn + output * p.out) / 1e6;
  return (input * p.in + output * p.out) / 1e6;
}

/** Record one call. Never throws: accounting must not break the feature it accounts for. */
export function recordUsage({ provider, model, feature, kind, input = 0, output = 0, imageInput = 0, images = 0, ok = true, cost }) {
  const userId = usageContext.getStore()?.userId ?? null;
  const usd = cost !== undefined ? cost : estimateCost(model, { input, output, imageInput });
  q("INSERT INTO api_usage (user_id, provider, model, feature, kind, input_tokens, output_tokens, images, cost_usd, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, provider, String(model || "").slice(0, 60), String(feature || "Other").slice(0, 60), kind, Math.round(input), Math.round(output), images, usd, ok ? 1 : 0])
    .catch((e) => console.warn("[usage] not recorded:", e.message));
}

/** A user's usage over the last `days` days: totals, per day and service, per feature, and the latest calls. */
export async function usageSummary(userId, days = 30) {
  const since = `DATE_SUB(CURDATE(), INTERVAL ${Math.max(1, Math.min(365, days)) - 1} DAY)`;
  const mine = "(user_id = ? OR user_id IS NULL)"; // calls made outside a request (background work) count too
  const [totals] = await q(`SELECT COUNT(*) AS calls, SUM(ok = 0) AS failed, COALESCE(SUM(cost_usd), 0) AS cost, SUM(images) AS images,
      SUM(input_tokens + output_tokens) AS tokens, SUM(cost_usd IS NULL AND ok = 1) AS unpriced
    FROM api_usage WHERE ${mine} AND created_at >= ${since}`, [userId]);
  const daily = await q(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, CONCAT(provider, ' ', kind) AS service, COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls
    FROM api_usage WHERE ${mine} AND created_at >= ${since} GROUP BY day, service ORDER BY day`, [userId]);
  const features = await q(`SELECT feature, COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls, SUM(images) AS images
    FROM api_usage WHERE ${mine} AND created_at >= ${since} GROUP BY feature ORDER BY cost DESC, calls DESC`, [userId]);
  const recent = await q(`SELECT created_at, provider, model, feature, kind, input_tokens, output_tokens, images, cost_usd, ok
    FROM api_usage WHERE ${mine} ORDER BY id DESC LIMIT 25`, [userId]);
  return { days, totals, daily, features, recent };
}
