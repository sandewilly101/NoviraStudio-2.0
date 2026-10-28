// A plain-English inventory of a scene for the image model: what is in the
// frame, how many, what colour and finish. Without it the model fills the gaps
// with a generic event (gold chairs, white floors…) instead of this design.

const NAMED = [
  ["black", "#111111"], ["charcoal", "#36393F"], ["dark grey", "#4A4F57"], ["grey", "#8A9099"], ["silver", "#C0C4CA"], ["white", "#FFFFFF"], ["ivory", "#F3EBDD"],
  ["cream", "#EFE3C8"], ["beige", "#D8C7A6"], ["champagne", "#D8C08A"], ["gold", "#C9A227"], ["yellow", "#F2C230"], ["orange", "#F08A24"], ["red", "#C62828"],
  ["burgundy", "#6E1F2C"], ["pink", "#F28AB2"], ["blush", "#E8B4B8"], ["purple", "#7E3FBF"], ["lavender", "#B9A6E3"], ["navy", "#1B2538"], ["royal blue", "#1F4FD1"],
  ["blue", "#2D6FD8"], ["sky blue", "#7FB8F0"], ["teal", "#1B8A8A"], ["green", "#2E8B4E"], ["emerald", "#1F5E3B"], ["olive", "#6B6B2E"], ["brown", "#6B4226"], ["wood brown", "#8A5A35"],
];
const rgb = (h) => { const n = parseInt(String(h).replace("#", "").padEnd(6, "0").slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export function colourName(hex) {
  if (!hex || !/^#?[0-9a-f]{3,8}$/i.test(String(hex))) return null;
  const [r, g, b] = rgb(hex);
  return NAMED.reduce((best, [name, h]) => { const [R, G, B] = rgb(h), d = (r - R) ** 2 * 0.3 + (g - G) ** 2 * 0.59 + (b - B) ** 2 * 0.11; return d < best.d ? { name, d } : best; }, { name: null, d: Infinity }).name;
}
const m = (v) => `${Math.round(v * 10) / 10} m`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const DANCE = { checker: "black-and-white checkerboard gloss", "white-gloss": "white high-gloss", "black-gloss": "black high-gloss", oak: "oak parquet", starlit: "black starlit (tiny embedded LEDs)" };
const TRUSS = { goalpost: "goalpost", arch: "arched", square: "square grid", "u-shape": "U-shaped", circle: "circular flown", straight: "straight flown" };
const FABRIC = { black: "black velour", ivory: "ivory velour", white: "white sheer voile", navy: "navy velour", burgundy: "burgundy velour", gold: "champagne satin" };

// What a display surface really shows — the same rules as the editor's contentOf():
// its content (a picture / video, or a designed layout) wins over the old placeholder text.
function shows(o) {
  const c = o.content || (o.imageUrl ? { mode: "media", mediaKind: "image" } : null);
  if (c?.mode === "media") return c.mediaKind === "video" ? "a video (show its picture exactly as in the input image, no added text)" : "the picture already on it (copy it exactly as in the input image; do not replace it with any other image or add any text)";
  if (c?.mode === "design") {
    const words = [c.title, c.subtitle, ...(String(c.body || "").split("\n"))].map((x) => String(x || "").trim()).filter(Boolean).join(" — ");
    const bg = colourName(c.bg);
    return `${bg ? `a ${bg} ` : "a "}graphic${words ? ` with the words "${words}"` : ""}${c.imageUrl || c.logoUrl ? " and the photo / logo already on it" : ""} (exactly as in the input image)`;
  }
  const text = [o.text?.content, o.text?.sub].filter(Boolean).join(" — ");
  return text ? `the words "${text}"` : null;
}

// The real model behind an object ("marble dining table"), when one was chosen.
const modelName = (o) => (o.asset?.name ? o.asset.name.replace(/[\s_-]*\d+$/, "").trim().toLowerCase() : null);
// Materials painted on its surfaces: "tablecloth in Velvet Red, top in Marble 01".
const SLOT = { cloth: "tablecloth", body: "finish", top: "top", deck: "deck", skirt: "skirting", fabric: "fabric", carpet: "carpet", panels: "panels" };
const finishes = (o) => Object.entries(o.finish || {}).filter(([, f]) => f?.name).map(([k, f]) => `${SLOT[k] || k} in ${String(f.name).toLowerCase()}`).join(", ");

export function describeScene(scene) {
  const objs = scene?.objects || [];
  const floorFinish = scene?.environment?.venueFinishes?.floor?.name;
  const by = (t) => objs.filter((o) => o.type === t);
  const lines = [];
  const colourOf = (o) => colourName(o.color);

  // tables: the real model, and whether they are dressed — a bare table must stay bare
  const tableLine = (list, generic, dressed) => {
    if (!list.length) return;
    // as the 3D view draws it: dressed in linen unless it was set bare, whichever model the table is
    const t = list[0], name = modelName(t), f = finishes(t), cloth = t.linen !== false;
    const what = name ? `${plural(list.length, name)} (${m(t.size[0])} across)` : `${plural(list.length, generic)} (${m(t.size[0])} across)`;
    const dress = !cloth
      ? " — bare, with NO tablecloth: the tabletop and legs stay visible exactly as shown"
      : ` ${dressed.replace("COLOUR", f.includes("tablecloth") ? "" : colourOf(t) || "white").replace(/\s+/g, " ")}`;
    lines.push(`${what}${dress}${f ? `; ${f}` : ""} (keep the table's exact shape${cloth ? "" : " — do not add cloths"})`);
  };
  tableLine(by("round_table"), "round banquet table", "dressed in floor-length COLOUR tablecloths");
  tableLine(by("long_table"), "rectangular banquet table", "set end to end in long rows, with COLOUR cloths");
  tableLine(by("cocktail_table"), "high cocktail table", "with COLOUR stretch covers");
  const chairs = by("chair");
  if (chairs.length) {
    const c = chairs[0], tint = c.tint ? colourOf(c) : null;
    const f = finishes(c);
    lines.push(`${plural(chairs.length, modelName(c) || "banquet chair")}${tint ? `, ${tint}` : ""}${f ? `, ${f}` : ""} (keep their exact colour and shape)`);
  }
  const centre = by("centrepiece");
  if (centre.length) lines.push(`${plural(centre.length, "centrepiece")} — a ${colourOf(centre[0]) || "gold"} five-candle candelabra on each table`);
  for (const s of by("stage")) {
    const top = s.spec?.top === "carpet" ? "carpeted" : s.spec?.top === "gloss" ? `${colourOf(s) || ""} gloss`.trim() : `${colourOf(s) || "black"} non-slip`;
    const front = s.spec?.fascia === "led" ? `, an LED fascia across its front showing ${shows(s) || "the event graphics"}` : s.spec?.fascia === "printed" ? `, its front skirt printed with ${shows(s) || "the event branding"}` : "";
    lines.push(`a ${m(s.size[0])} × ${m(s.size[2])} stage${front}, ${Math.round(s.size[1] * 100)} cm high, with a ${top} deck, ${colourName(s.spec?.skirt || "#121212")} pleated velour skirting${s.ledStrip !== false ? ", a thin blue LED strip along its front edge" : ""}${s.spec?.stairs !== false ? " and steps with handrails" : ""}`);
  }
  for (const l of by("led_screen")) {
    const what = shows(l);
    lines.push(`an LED video wall ${m(l.size[0])} wide × ${m(l.size[1])} high${l.spec?.curveDeg ? `, curved ${l.spec.curveDeg}°` : ""}${what ? ` showing ${what}` : ""}`);
  }
  for (const d of by("dance_floor")) lines.push(`a ${m(d.size[0])} × ${m(d.size[2])} ${DANCE[d.variant || "checker"] || "gloss"} dance floor with aluminium edge ramps`);
  for (const t of by("truss")) lines.push(`a ${TRUSS[t.variant || "goalpost"] || ""} ${t.spec?.finish === "black" ? "black" : "silver aluminium"} box truss ${m(t.size[0])} wide`);
  // lights, grouped as a lighting designer would list them: what, how many, colour, where, what they light
  const LIGHT = { "moving-head-wash": "moving-head wash", "moving-head-spot": "moving-head spot", beam: "beam light", "par-can": "PAR can", wash: "LED wash", "profile-spot": "profile spot", fresnel: "fresnel", blinder: "blinder", "strip-batten": "LED strip batten", uplighter: "uplighter", "follow-spot": "follow spot", "gobo-projector": "gobo projector", pinspot: "pinspot", "floor-wash": "floor wash" };
  const groups = new Map();
  for (const l of by("light")) {
    const mount = l.spec?.mount || (l.variant === "uplighter" || l.variant === "floor-wash" ? "floor" : "truss"), on = l.spec?.on !== false;
    const key = `${l.variant || "par-can"}|${mount}|${on ? colourName(l.color) || "white" : "off"}`;
    groups.set(key, { n: (groups.get(key)?.n || 0) + 1, l, mount, on, haze: (groups.get(key)?.haze || false) || !!l.spec?.haze });
  }
  for (const { n, l, mount, on, haze } of groups.values()) {
    const what = plural(n, LIGHT[l.variant] || "stage light"), colour = colourName(l.color) || "white";
    if (!on) { lines.push(`${what} (switched off — no light from them)`); continue; }
    const does = mount === "floor" ? (l.variant === "uplighter" ? `standing at the walls, washing them upward in ${colour} light` : `on the floor, washing the area in front in ${colour}`) : mount === "stand" ? `on stands, lighting the stage in ${colour}` : `hung on the truss, lighting the stage and the area in front in ${colour}`;
    const fx = l.spec?.fx, MOVE = { sweep: "sweeping side to side", "tilt-wave": "waving up and down", circle: "tracing circles", figure8: "tracing figure-eights", ballyhoo: "searching the room in big swings", fan: "fanning out across the room", crossfire: "criss-crossing each other" };
    const motion = fx ? [MOVE[fx.move], fx.dimmer === "strobe" ? "strobing" : fx.dimmer === "chase" ? "chasing in sequence" : "", fx.colour && fx.colour !== "steady" ? "changing colour" : "", fx.gobo && fx.gobo !== "none" ? `projecting a ${fx.gobo} gobo pattern` : "", fx.prism ? "split by a prism" : ""].filter(Boolean).join(", ") : "";
    lines.push(`${what} ${does}${motion ? `, ${motion} (caught mid-movement)` : ""}${haze ? ", their beams visible in a light haze" : ""}`);
  }
  const CHAND = { "crystal-tiered": "crystal waterfall chandelier", "candle-gold": "gold candle chandelier", "crystal-ball": "crystal sphere chandelier" };
  const chand = by("chandelier"); if (chand.length) lines.push(`${plural(chand.length, CHAND[chand[0].variant] || "crystal chandelier")} hanging from the ceiling, glowing warm`);
  for (const d of by("ceiling_drape")) lines.push(`${d.spec?.count || 3} ${colourName(d.color) || ""} fabric ceiling swags ${d.spec?.layout === "radial" ? "radiating from a central point like a draped canopy" : "draped across the ceiling"}, sagging softly`);
  for (const a of by("arch")) lines.push(`a ${a.spec?.frame || "gold"} ${a.variant === "round" ? "round" : a.variant === "hexagon" ? "hexagonal" : "four-post canopy"} wedding arch${a.spec?.fabric === false ? "" : ` draped in ${colourName(a.color) || "ivory"} fabric`} with flower clusters`);
  for (const c of by("curtain")) lines.push(`a ${m(c.size[0])} run of ${FABRIC[c.variant || "black"] || "fabric"} pipe-and-drape`);
  const booths = by("booth");
  if (booths.length) lines.push(`${plural(booths.length, "exhibition stand")} in a white shell-scheme system${booths.map((b) => b.text?.content).filter(Boolean).length ? ` with fascia names ${booths.map((b) => `"${b.text?.content}"`).join(", ")}` : ""}`);
  const bar = by("bar"); if (bar.length) lines.push(`${plural(bar.length, modelName(bar[0]) || "bar counter")}`);
  const sofas = by("sofa"); if (sofas.length) lines.push(`${plural(sofas.length, modelName(sofas[0]) || "lounge sofa")}${colourOf(sofas[0]) ? `, ${colourOf(sofas[0])}` : ""}`);
  const speakers = by("speaker"); if (speakers.length) lines.push(`${plural(speakers.length, "PA speaker")} on tripod stands`);
  const lectern = by("lectern"); if (lectern.length) lines.push("a lectern on the stage");
  const SIGN = { easel: "poster on an easel", rollup: "roll-up banner", backdrop: "printed backdrop", "media-wall": "media wall", hanging: "hanging banner", tv: "screen on a stand" };
  for (const s of by("sign")) { const what = shows(s); lines.push(`a ${SIGN[s.variant] || "sign"}${what ? ` showing ${what}` : " (blank)"}`); }
  // imported library models: name them, so the model keeps them instead of swapping in something generic
  const models = new Map();
  for (const o of by("model")) { const n = (o.asset?.name || o.name || "").replace(/[\s_-]*\d+$/, "").trim().toLowerCase(); if (n) models.set(n, (models.get(n) || 0) + 1); }
  for (const [n, k] of models) lines.push(`${k === 1 ? `a ${n}` : `${k} × ${n}`} (keep its exact shape, material and colour)`);
  const tents = by("tent"); if (tents.length) lines.push(`${plural(tents.length, "marquee tent")}`);
  lines.push(floorFinish ? `the venue floor in ${String(floorFinish).toLowerCase()}` : "the venue's own floor exactly as shown (a matte woven carpet stays matte carpet)");
  return lines;
}
