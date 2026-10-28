// The concept picture of a design, rendered FROM its 3D scene: a hero view of
// the built scene is re-rendered photoreal by Nano Banana with everything kept
// exactly as built (positions, counts, colours, graphics), then a vision check
// compares the two and the render is redone once, with what went wrong spelled
// out, if anything was invented, dropped, moved or recoloured. The concept and
// the 3D are one design, not two.
import { chat, openai } from "./openai.js";
import { config } from "../config.js";
import { describeScene } from "./describe.js";
import { enhanceRender } from "./images.js";

const client = openai;

/** Theme words for the render: how the materials and the light should feel — never new things (so not the concept's own words, which name objects). */
function mood(plan, scene) {
  const d = plan?.design || {};
  const colours = [...new Set((scene?.objects || []).filter((o) => o.color && o.type !== "model").map((o) => `${o.type.replace(/_/g, " ")} ${o.color}`))].slice(0, 14);
  return [
    colours.length ? `Keep every fabric and surface exactly its colour in the picture (${colours.join(", ")}); light may brighten or shade it but never change its hue.` : "",
    d.theme?.name ? `Theme "${d.theme.name}" in ${(d.theme.palette || []).map((c) => c.name).join(", ")}.` : "",
    plan?.design?.setting === "outdoor" ? "It is an open-air event: keep the open sky and the ground as they are — no walls, no ceiling, no tent unless one is in the picture." : "",
    "Make the materials and the light feel like the finished, professionally produced event (fabric sheen, light falling on the walls, depth), but only on what is already in the picture.",
  ].filter(Boolean).join(" ");
}

/** Whether the render shows the same design as the 3D view, and what differs if not. */
async function compare(snapshotB64, renderB64, inventory) {
  if (!client) return { same: true, issues: [] };
  const res = await chat("Checking concepts against the 3D", {
    model: config.openai.model, temperature: 0, response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You check that a photoreal render shows exactly the same event design as the 3D view it was made from. Compare them object by object. " +
        "Ignore rendering quality, realism, lighting mood, reflections and texture detail — those are supposed to improve. " +
        "Also ignore what a client would never count as a design change: the venue's own ceiling downlights, how the carpet pattern is rendered, a candle glow or small table-top sparkle, slight count differences in far-away repeated items. " +
        "The 3D view is a plain, often dark preview: the inventory list says what it contains, so never flag something the inventory lists (a tablecloth, a stage skirt, an LED strip) as added, and don't call it missing from the render because you can't make it out in a dark preview — only when the render clearly lacks it. " +
        "The ground or floor only differs if it is a different surface (grass, sand, tiles, carpet), not a different rendering of the same one; furniture only differs if it is a different kind (a chiavari chair became an armchair), not a more detailed version. " +
        "A colour is only changed when it is a different colour (blue became red, gold became silver, white became black) — not when it looks lighter, darker, warmer, cooler or more saturated under the light, which is expected. " +
        "Flag only design differences a client would notice: furniture, decor, props, plants or people added that the 3D view doesn't have; something missing; a clearly different count of tables, screens or big decor; a moved or resized object; a different colour of a fabric or surface; changed or invented text or graphics on a screen or sign; a changed camera angle. " +
        'Mark an issue major when a client would say "that is not my design" (something big added, missing, moved or a different colour); small things (a prop slightly different, a far detail) are minor. ' +
        'Answer as JSON {"same": boolean, "issues": [{"text": short concrete sentence, "major": boolean}] (at most 6)}. "same" is true when there is no major issue.' },
      { role: "user", content: [
        { type: "text", text: `The 3D view (first image) contains: ${inventory.join("; ")}. The second image is the render.` },
        // high detail: at low detail a dark night preview is a blur, and the check flags what it can't see
        { type: "image_url", image_url: { url: `data:image/png;base64,${snapshotB64}`, detail: "high" } },
        { type: "image_url", image_url: { url: `data:image/png;base64,${renderB64}`, detail: "high" } },
      ] },
    ],
  });
  const out = JSON.parse(res.choices[0].message.content || "{}");
  const all = (Array.isArray(out.issues) ? out.issues : []).map((i) => (typeof i === "string" ? { text: i, major: true } : { text: String(i?.text || ""), major: i?.major !== false })).filter((i) => i.text).slice(0, 6);
  // a side-by-side look misses things in a busy picture: each claimed difference is looked at again on its own
  const major = await confirmed(all.filter((i) => i.major).map((i) => i.text), snapshotB64, renderB64, inventory);
  // only what a client would object to is reported (and worth a second render); minor drift is fine
  return { same: !major.length, issues: major, minor: all.filter((i) => !i.major).map((i) => i.text) };
}

/** The claimed differences that hold up when each is checked carefully, one question at a time. */
async function confirmed(claims, snapshotB64, renderB64, inventory) {
  if (!claims.length) return [];
  const res = await chat("Checking concepts against the 3D", {
    model: config.openai.model, temperature: 0, response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You verify claims that a photoreal render differs from the 3D view it was made from. For each claim, look carefully at the exact part of both pictures it is about (zoom in mentally: the stage front, the back of the stage, the screen, the tables). " +
        "A claim that something is missing is FALSE if the render shows it anywhere, even small, softly lit or more realistic. A claim that something was added is FALSE if the 3D view or its inventory has it. A claim about text is FALSE if the same words are there in a nicer typeface. " +
        'Answer JSON {"verdicts": [{"i": index, "true": boolean}]}.' },
      { role: "user", content: [
        { type: "text", text: `The 3D view (first image) contains: ${inventory.join("; ")}. The second image is the render. Claims:\n${claims.map((c, i) => `${i}. ${c}`).join("\n")}` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${snapshotB64}`, detail: "high" } },
        { type: "image_url", image_url: { url: `data:image/png;base64,${renderB64}`, detail: "high" } },
      ] },
    ],
  }).catch(() => null);
  if (!res) return claims;
  const verdicts = JSON.parse(res.choices[0].message.content || "{}").verdicts || [];
  return claims.filter((_, i) => verdicts.find((v) => v.i === i)?.true !== false);
}

/**
 * The concept picture for a design: `snapshotB64` is a hero view of its 3D
 * scene (PNG). Returns the render and how well it matched (checked, issues left).
 */
export async function conceptFromScene(snapshotB64, scene, plan) {
  const inventory = describeScene(scene);
  const base = { lighting: scene?.environment?.hdri?.name, eventType: plan?.eventType || scene?.plan?.eventType || "event", inventory, mode: scene?.environment?.mode || plan?.mode };
  let img = await enhanceRender(snapshotB64, { ...base, extra: mood(plan, scene), feature: "Concept renders" });
  let check = await compare(snapshotB64, img.base64, inventory).catch(() => ({ same: true, issues: [] }));
  if (!check.same && check.issues.length) {
    // once more, told exactly what not to do
    const fix = `A previous attempt changed the design — avoid these mistakes: ${check.issues.join(" ")}`;
    const again = await enhanceRender(snapshotB64, { ...base, extra: `${mood(plan, scene)} ${fix}`, feature: "Concept renders" });
    const second = await compare(snapshotB64, again.base64, inventory).catch(() => ({ same: true, issues: [] }));
    if (second.same || second.issues.length < check.issues.length) { img = again; check = second; }
  }
  return { img, check };
}
