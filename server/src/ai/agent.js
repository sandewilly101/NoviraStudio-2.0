// The scene agent: GPT-4o reads the whole scene and changes it with tools —
// add, change, remove, place relative to other objects, hang from a truss,
// re-lay-out the seating, set the lighting environment — repeating until the
// request is done. Positions come from code (geometry.js), so "hang the LED
// from a circular truss" ends up physically right, not roughly guessed.
import { chat, openai } from "./openai.js";
import { config } from "../config.js";
import { placeFree } from "./placement.js";
import { sourceModel } from "./sourcing.js";
import { bounds, hangFrom, keepInside, lightMount, placeRelative, rigSegments, roomSpot, screenRig, SCREEN_LAYOUTS } from "./geometry.js";
import { mirrorHdri, searchHdris } from "../routes/hdris.js";
import { mirrorMaterial, searchMaterials } from "../routes/materials.js";
import { aiMaterials, generateMaterial } from "./texture.js";
import { cachedSearch, importModel } from "../routes/assets.js";
import { imagesEnabled } from "./images.js";

const client = openai; // retries back off on rate limits
export const agentEnabled = () => !!client;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- what the agent can build ----------
const TYPES = {
  stage: { size: [7.3, 0.61, 4.9], note: "hire stage of 4 ft decks; size [width, height, depth]; spec: stairs (bool), rails (bool), top 'deck'|'carpet'|'gloss', skirt '#hex', skirtBack (bool), fascia 'none'|'printed'|'led' (branding across the stage front; give it `content` like an LED wall), fasciaSides (bool); color = deck colour; ledStrip (bool) is a top-level field; sizes are whole 1.219 m decks, heights 0.41/0.61/0.81/1.02/1.22 m" },
  led_screen: { size: [5, 3, 0.1], y: 0.9, note: "LED video wall; position y = height of the image's bottom edge; variant = panel: 'p1-9-indoor'|'p2-6-indoor'|'p3-9-indoor'|'p4-8-outdoor'|'p6-25-floor'|'p10-outdoor'; size snaps to 0.5 m cabinets; spec: frame 'ground-support'|'flown'|'wall-mount', curveDeg 0-40; shows `content`" },
  truss: { size: [8, 5, 0.3], note: "aluminium box truss; variant 'goalpost' (two towers + header, size [width, height, 0.3]) | 'arch' | 'square' (grid on 4 towers, size [w, h, d]) | 'u-shape' | 'circle' (flown ring, size [diameter, height of ring, diameter]) | 'straight' (flown bar); spec: system 'f34-square'|'f44-square'|'h40v-square'|'f33-tri'|'ladder-290', finish 'silver'|'black'. Lights and LED walls can hang from it" },
  light: { size: [0.4, 0.5, 0.4], y: 4, note: "lighting fixture; variant 'moving-head-wash'|'moving-head-spot'|'beam'|'par-can'|'wash'|'profile-spot'|'fresnel'|'blinder'|'strip-batten'|'uplighter'|'follow-spot'|'gobo-projector'|'pinspot'|'floor-wash'; color = light colour; spec: intensity 0-1, beamDeg, pan (deg, 0 = towards +z), tilt (deg, + = down, - = up), mount 'truss'|'stand'|'floor', haze (bool, visible beam), on (bool); spec.fx = a console effect that runs when the lighting plays: { move 'static'|'sweep'|'tilt-wave'|'circle'|'figure8'|'ballyhoo'|'fan'|'crossfire' (moving heads only), dimmer 'steady'|'pulse'|'chase'|'breathe'|'strobe'|'flicker', colour 'steady'|'fade'|'rainbow'|'chase', speed (BPM), size (degrees), spread 0-1 (how far apart the rig runs), palette ['#hex'], strobeHz, gobo 'none'|'dots'|'breakup'|'stars'|'rays'|'swirl'|'ring', goboSpin (turns per 10 s), prism (bool), group }. Truss lights clamp onto the nearest truss automatically" },
  dance_floor: { size: [5.6, 0.03, 5.6], note: "portable dance floor; variant 'checker'|'white-gloss'|'black-gloss'|'oak'|'starlit'" },
  curtain: { size: [6, 3, 0.2], note: "pipe and drape; size [run length, height, 0.2]; variant 'black'|'ivory'|'white' (sheer)|'navy'|'burgundy'|'gold' (champagne satin); color = fabric colour; spec: fullness 1-2.5" },
  booth: { size: [3, 2.5, 3], note: "exhibition stand; variant 'shell-scheme'|'inline'|'corner'|'peninsula'|'island'|'double-decker'; text.content = fascia name; color = wall panels; spec: carpet '#hex'; `content` = back-wall graphic" },
  sign: { size: [0.66, 1.75, 0.6], note: "display surface showing `content`; variant 'easel' (poster on easel) | 'rollup' (pull-up banner 0.85×2.13) | 'backdrop' (step-and-repeat 3×2.43) | 'media-wall' (backlit, 3×2.5) | 'hanging' (banner on wires; position y = its bottom edge) | 'tv' (screen on stand 1.48×1.85)" },
  round_table: { size: [1.8, 0.76, 1.8], note: "banquet round; color = linen colour (chairs are separate objects — prefer `relayout` for seating)" },
  long_table: { size: [2.4, 0.76, 0.9], note: "banquet trestle table; color = cloth" },
  cocktail_table: { size: [0.7, 1.1, 0.7], note: "high cocktail table" },
  chair: { size: [0.45, 0.92, 0.45], note: "banquet chair (a real model); spec.cover \"#hex\" = fitted chair cover, spec.sash \"#hex\" = satin sash tied round the back with a bow (update all chairs by type)" },
  centrepiece: { size: [0.32, 0.75, 0.32], note: "candelabra; place `on` a table" },
  sofa: { size: [2.2, 0.85, 0.9], note: "lounge sofa" },
  bar: { size: [0.7, 1.1, 5.3], note: "bar counter" },
  speaker: { size: [0.6, 2.2, 0.6], note: "PA speaker on tripod" },
  lectern: { size: [0.6, 1.15, 0.5], note: "lectern; place `on` the stage" },
  tent: { size: [6.1, 3.8, 12.2], note: "marquee; variant e.g. 'frame-20x40'; spec: canopyHidden" },
  chandelier: { size: [1.2, 1.3, 1.2], note: "chandelier hung from the ceiling (its height is set from the ceiling automatically); variant 'crystal-tiered' (crystal waterfall) | 'candle-gold' (gold candle arms) | 'crystal-ball'; spec.drop = rod length; place several over the tables or the dance floor (arrange grid/row)" },
  ceiling_drape: { size: [12, 1.2, 4], note: "fabric swags under the ceiling (height set automatically); size [span length, sag depth, spread across]; variant 'ivory'|'white' (sheer)|'gold' (champagne satin)|'burgundy'|'navy'|'black' + color for any colour; spec.count (runs), spec.layout 'parallel' | 'radial' (canopy from a centre); usually centered over the guest area" },
  arch: { size: [2.4, 2.6, 1.2], note: "wedding / ceremony arch; variant 'square' (draped 4-post canopy) | 'round' | 'hexagon'; spec.frame 'gold'|'white'|'wood'|'black', spec.drape fabric name, color = fabric colour, spec.flowers = up to 3 '#hex' bloom colours, spec.fabric false = frame and flowers only. Typical spots: on the stage, at the head of the aisle, behind the couple's table, as a photo spot" },
  model: { size: [1, 1, 1], note: "a real 3D model from the libraries (flowers, arches, plants, props, cultural decor…) — add it with find_models then add_model, not add_objects" },
};
const DEFAULT_COLOR = { chandelier: "#C9A24A", ceiling_drape: "#EFE7D6", arch: "#EFE7D6", light: "#FFFFFF", round_table: "#F7F3E8", long_table: "#F7F3E8", cocktail_table: "#F7F3E8", chair: "#C0C4CA", centrepiece: "#C9A227", curtain: "#141414", booth: "#F4F4F1", dance_floor: "#E9E4DA", sofa: "#2F4470", bar: "#3B2E25", tent: "#F7F6F3", truss: "#C2C7CE", sign: "#0E2A4A", led_screen: "#0E2A4A" };
// surfaces that take a material, per type (the first is the main one); everything else has "body"
const SURFACES = { stage: ["deck", "skirt"], dance_floor: ["floor"], curtain: ["fabric"], booth: ["carpet", "walls"], round_table: ["cloth"] };
// real default sizes of each variety, as the app's variety picker uses them
const VARIANT_SIZE = {
  sign: { easel: [0.66, 1.75, 0.6], rollup: [0.85, 2.13, 0.32], backdrop: [3, 2.43, 0.5], "media-wall": [3, 2.5, 0.35], hanging: [4, 1.2, 0.04], tv: [1.48, 1.85, 0.7] },
  truss: { goalpost: [8, 5, 0.3], arch: [6, 4.5, 0.3], square: [8, 5, 6], "u-shape": [8, 5, 4], circle: [8, 6, 8], straight: [8, 5, 0.3] },
  light: { "strip-batten": [1, 0.1, 0.12], uplighter: [0.2, 0.25, 0.2], "floor-wash": [0.3, 0.15, 0.2], "follow-spot": [0.4, 0.5, 0.9] },
  stage: { riser: [4.9, 0.41, 2.4], high: [9.8, 1.02, 4.9], runway: [2.44, 0.61, 9.75] },
};
const CONTENT = `content = { mode: "design", template: "headline"|"logo"|"split"|"agenda"|"sponsors"|"speaker"|"photo", title, subtitle, body (agenda lines like "19:00 - Dinner" or sponsor names, one per line), bg "#hex", fg "#hex", accent "#hex", font "sans"|"serif"|"display", align "center"|"left" } or { mode: "media", mediaUrl, mediaKind "image"|"video", fit "cover"|"contain" } (media URLs only from the scene or the user)`;

const PLACEMENT = {
  type: "object", description: "Where to put it (pick one). Default: centre of the room.",
  properties: {
    position: { type: "array", items: { type: "number" }, description: "[x, y, z] in metres" },
    relative_to: { type: "object", properties: { id: { type: "string" }, relation: { type: "string", enum: ["in_front_of", "behind", "left_of", "right_of", "on", "above", "centered_on", "hang_from", "around"], description: "around = several arranged in a ring around it" }, gap: { type: "number", description: "metres between them, default 0.3" } }, required: ["id", "relation"] },
    room_spot: { type: "string", enum: ["center", "back_wall", "front_wall", "left_wall", "right_wall", "back_left_corner", "back_right_corner", "front_left_corner", "front_right_corner", "entrance"] },
    rotation_deg: { type: "number", description: "turn about the vertical axis; 0 = front faces +z (the audience)" },
  },
};
const TARGET = {
  type: "object", description: "Which objects (ids, or a filter).",
  properties: { ids: { type: "array", items: { type: "string" } }, type: { type: "string" }, variant: { type: "string" }, name_contains: { type: "string" } },
};
const TOOLS = [
  { type: "function", function: { name: "add_objects", description: "Add one or more objects. With count > 1 they are arranged in a row, grid or ring around the placement point.", parameters: { type: "object", properties: {
    type: { type: "string", enum: Object.keys(TYPES) }, variant: { type: "string" }, name: { type: "string" }, size: { type: "array", items: { type: "number" }, description: "[width, height, depth] m; omit for the real default" },
    color: { type: "string" }, spec: { type: "object" }, content: { type: "object" }, text: { type: "object", properties: { content: { type: "string" } } },
    placement: PLACEMENT, count: { type: "integer" }, arrange: { type: "string", enum: ["row", "grid", "ring", "along_walls"], description: "how several are laid out: row (side by side), grid, ring (around the placement point, e.g. around the dance floor), along_walls (spread evenly around the room walls — use for uplighting, wall decor, perimeter lights)" }, spacing: { type: "number" },
  }, required: ["type"] } } },
  { type: "function", function: { name: "update_objects", description: "Change existing objects: colour, size, variant, settings (spec is merged), content (merged), text, name, or move them (placement / move).", parameters: { type: "object", properties: {
    target: TARGET, set: { type: "object", properties: { name: { type: "string" }, color: { type: "string" }, size: { type: "array", items: { type: "number" } }, scale: { type: "number" }, variant: { type: "string" }, spec: { type: "object" }, content: { type: "object" }, text: { type: "object" }, ledStrip: { type: "boolean" }, linen: { type: "boolean" }, move: { type: "array", items: { type: "number" }, description: "[dx, dy, dz] metres" } } },
    placement: PLACEMENT,
  }, required: ["target"] } } },
  { type: "function", function: { name: "remove_objects", description: "Delete objects.", parameters: { type: "object", properties: { target: TARGET }, required: ["target"] } } },
  { type: "function", function: { name: "relayout", description: "Re-run the seating layout solver (guests, layout style, tables, walkways, stage/LED/bar/dance floor inclusion, colours). Objects the user added are kept.", parameters: { type: "object", properties: {
    guests: { type: "integer" }, layout: { type: "string", enum: ["banquet", "theater", "feast", "cocktail"] }, seatsPerTable: { type: "integer", enum: [6, 8, 10, 12] }, walkway: { type: "number" },
    include: { type: "object", properties: { stage: { type: "boolean" }, ledScreen: { type: "boolean" }, lectern: { type: "boolean" }, speakers: { type: "boolean" }, bar: { type: "boolean" }, danceFloor: { type: "boolean" } } },
    stage: { type: "object", properties: { width: { type: "number" }, depth: { type: "number" }, height: { type: "number" } } },
    colors: { type: "object", properties: { linen: { type: "string" }, chair: { type: "string" }, accent: { type: "string" }, stage: { type: "string" } } }, screenText: { type: "string" },
  } } } },
  { type: "function", function: { name: "set_lighting_environment", description: "Light the scene with a Poly Haven HDRI (search words like 'sunset', 'indoor warm', 'studio', 'night'), or none for plain studio light.", parameters: { type: "object", properties: { search: { type: "string" }, none: { type: "boolean" }, intensity: { type: "number" }, background: { type: "boolean" }, rotation_deg: { type: "number" } } } } },
  { type: "function", function: { name: "apply_material", description: "Put a real material (Poly Haven PBR scan: velvet, satin, linen, oak, walnut, marble, terrazzo, brushed metal, carpet, leather, plaster…) on a surface of objects. Surfaces: stage deck|skirt, dance_floor floor, curtain fabric, booth carpet|walls, round_table cloth, everything else body. Use none: true to restore the built-in finish. When no scan matches (a cultural print, a branded pattern…) a seamless material is painted from the search words, so describe it precisely, e.g. \"red and blue Maasai shuka check fabric\".", parameters: { type: "object", properties: {
    target: TARGET, surface: { type: "string", description: "which surface; default the object's main one" }, search: { type: "string", description: "what material, in words" },
    group: { type: "string", enum: ["fabric", "wood", "floor", "stone", "metal", "wall", "leather"] }, scale: { type: "number", description: "pattern size, 1 = real size" }, none: { type: "boolean" },
  }, required: ["target"] } } },
  { type: "function", function: { name: "arrange_screens", description: "Rebuild the stage's LED walls as a real production layout (replaces the current LED walls, keeps their content): center (one 16:9 wall), center-sides (main wall + two side IMAG screens angled to the guests), triptych (three walls, outer ones angled), ultrawide (one 32:9 wall), columns (five tall LED columns), curved (one wall curved 30°). Afterwards give each screen its own content with update_objects if wanted.", parameters: { type: "object", properties: { layout: { type: "string", enum: SCREEN_LAYOUTS } }, required: ["layout"] } } },
  { type: "function", function: { name: "find_models", description: "Search the real 3D model libraries (BlenderKit, Poly Haven, Sketchfab) for things the catalogue doesn't build: flowers and floral arrangements, flower walls, wedding arches, plants and trees, lanterns, rugs, baskets, sculptures, cultural decor, props. Returns choices for add_model. Search in plain English, 1-3 simple words (e.g. 'flower arrangement', 'wedding arch', 'potted palm', 'lantern'), then add one. Not for lights, drapes, truss, signs or fabrics — those are built in.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "add_model", description: "Add a real 3D model found with find_models, scaled to a real height. Placement, count and arrange work like add_objects (e.g. on the stage: relative_to {id: stage, relation: 'on'}; several in a row along the stage front).", parameters: { type: "object", properties: {
    ref: { type: "string", description: "the ref from find_models" }, name: { type: "string" }, height_m: { type: "number", description: "real height in metres (e.g. floral arrangement 0.6-1.2, wedding arch 2.4, potted palm 1.8)" },
    placement: PLACEMENT, count: { type: "integer" }, arrange: { type: "string", enum: ["row", "grid", "ring", "along_walls"] }, spacing: { type: "number" },
    on_each: { type: "string", description: "put one on top of every object of this type instead (e.g. 'round_table' for a floral centrepiece on each table, 'cocktail_table')" },
  }, required: ["ref", "height_m"] } } },
  { type: "function", function: { name: "design_event", description: "Design or redesign the WHOLE event from a brief (e.g. 'an elegant traditional Maasai wedding', 'a gold corporate gala for 300'): a senior designer plans the concept, theme, seating layout, real furniture, decor, lighting and LED artwork, and the scene is rebuilt from it. Use whenever the request describes the event itself rather than a specific change.", parameters: { type: "object", properties: { brief: { type: "string", description: "the event, in the user's words plus anything known (guests, venue)" } }, required: ["brief"] } } },
  { type: "function", function: { name: "inspect_objects", description: "Full details of objects (all fields).", parameters: { type: "object", properties: { target: TARGET }, required: ["target"] } } },
];

// ---------- describing the scene to the model ----------
const deg = (rad) => Math.round(((rad || 0) * 180) / Math.PI);
function line(o) {
  const parts = [`${o.id} | ${o.type}${o.variant ? `:${o.variant}` : ""} "${o.name}" | pos (${o.position.map(r2).join(", ")}) | size ${o.size.map(r2).join("×")} | rot ${deg(o.rotation?.[1])}° | color ${o.color}`];
  if (o.spec && Object.keys(o.spec).length) parts.push(`spec ${JSON.stringify(o.spec)}`);
  if (o.content) parts.push(`content ${o.content.mode === "design" ? `design:${o.content.template || "headline"} "${o.content.title || ""}"` : `${o.content.mediaKind} ${o.content.mediaUrl}`}`);
  else if (o.text?.content) parts.push(`text "${o.text.content}"`);
  if (o.finish && Object.keys(o.finish).length) parts.push(`materials ${Object.entries(o.finish).map(([k, f]) => `${k}: ${f.name}`).join(", ")}`);
  if (o.userAdded) parts.push("user-added");
  return parts.join(" | ");
}
// Which way the event runs: the stage's wall and the way the audience looks.
function stageSide(scene) {
  const yaw = (scene.objects || []).find((o) => o.type === "stage")?.rotation?.[1] || 0;
  const f = [Math.round(Math.sin(yaw)), Math.round(Math.cos(yaw))];
  const wall = f[1] === 1 ? "low-z" : f[1] === -1 ? "high-z" : f[0] === 1 ? "low-x" : "high-x";
  return `The stage stands against the ${wall} wall and faces ${f[0] ? (f[0] > 0 ? "+x" : "-x") : f[1] > 0 ? "+z" : "-z"}; guests face the stage. Room spots follow the stage: back_wall = behind it, front_wall = the far end, left/right as the audience sees the stage.`;
}
export function describeForAgent(scene, room) {
  const objs = scene.objects || [], many = ["chair", "centrepiece"], lines = [];
  for (const o of objs) if (!many.includes(o.type) && !(o.type === "round_table" && objs.filter((x) => x.type === "round_table").length > 16)) lines.push(line(o));
  for (const t of [...many, "round_table"]) {
    const g = objs.filter((o) => o.type === t);
    if (g.length && (many.includes(t) || g.length > 16)) {
      const b = g.map(bounds), colors = [...new Set(g.map((o) => o.color))].slice(0, 3);
      lines.push(`${g.length} × ${t} (ids like ${g[0].id}) spread over x ${r2(Math.min(...b.map((v) => v.x0)))}..${r2(Math.max(...b.map((v) => v.x1)))}, z ${r2(Math.min(...b.map((v) => v.z0)))}..${r2(Math.max(...b.map((v) => v.z1)))}, colours ${colors.join(", ")} — target them by type`);
    }
  }
  return [
    `Room (walls): x ${r2(room.minX)}..${r2(room.maxX)}, z ${r2(room.minZ)}..${r2(room.maxZ)}, floor y ${room.floorY ?? 0}, ceiling ${r2(room.height || 8)} m. ${stageSide(scene)}`,
    `Plan: ${JSON.stringify(scene.plan || {})}`,
    `Lighting environment: ${scene.environment?.hdri ? scene.environment.hdri.name : "studio light"}`,
    "Objects:", ...lines,
  ].join("\n");
}

const SYSTEM = `You are the scene agent of Novira Studio, a 3D event design tool. You understand everything in the scene and you carry out the user's request completely by calling tools — adding, changing, connecting, moving and removing objects — then answer with one or two short sentences of what you did.

Rules:
- Real-world event production logic: LED walls and lights are supported (ground support, truss, stand, floor); flown items hang from truss; nothing floats or passes through walls, the stage or other objects.
- To support something with truss: add the truss with placement.relative_to {id: that object, relation: "above"} (it is sized and positioned to carry it), then update the object with placement.relative_to {id: the truss, relation: "hang_from"}.
- Use relative placement (in_front_of, behind, left_of, right_of from the audience's point of view; on; above; hang_from) or room spots rather than guessing coordinates.
- "left/right" mean as the audience sees the stage. Keep things inside the room.
- Target groups by type (e.g. all chairs) instead of listing ids.
- Send independent steps together in one turn (they run in order); wait for a result only when a later step needs an id it returns.
- For seating changes (guest count, table style, walkways) use relayout.
- Colours must be real event colours (gold #C9A227, champagne #E8D9B5, ivory #F7F3E8, navy #1B2538, black #1B1B1F, blush #F0C9CF, burgundy #7A1E2C, silver #AEB8C4, emerald #1E7A5A …).
- If something is impossible, do the closest real-world equivalent and say so. Never ask a question back; act.
- Real things the catalogue doesn't build (flowers, floral arrangements, arches, plants, lanterns, cultural decor…) come from the model libraries: find_models then add_model at a real height. Never pretend another object is one (a candelabra is not flowers).
- A request that describes the event itself ("an elegant traditional Maasai wedding") is a redesign: call design_event.

Object catalogue (type: default size, notes):
${Object.entries(TYPES).map(([k, v]) => `- ${k}: ${v.size.join("×")} m — ${v.note}`).join("\n")}
Display content: ${CONTENT}`;

// Pipe-and-drape fabrics (as the app draws them) and plain colour words, so "terracotta drape" becomes a real fabric in that colour.
const DRAPES = { black: "#141414", ivory: "#EFE7D6", white: "#F7F7F4", navy: "#1B2538", burgundy: "#6E1F2C", gold: "#D8C08A" };
const COLOUR_WORDS = { terracotta: "#B5553C", ochre: "#C8892B", red: "#A3262A", maroon: "#6E1F2C", cream: "#EFE3C8", champagne: "#E8D9B5", beige: "#D8C7A6", brown: "#6B4226", green: "#2F6B4F", emerald: "#1E7A5A", blue: "#2D4E8A", orange: "#D2702A", blush: "#E8B4B8", silver: "#C0C4CA" };

/**
 * Look at the library thumbnails before offering them: keep only models that
 * really are one standalone object of the kind asked for (a "wedding arch"
 * search also returns balloon columns, whole rooms and flat panels).
 */
/** The Poly Haven sky that best fits a description, chosen from the thumbnails of the closest matches. */
async function skyByLooks(search, look) {
  const pool = [];
  for (const q of [search, ...(/night/i.test(look) ? ["night"] : []), "outdoor"]) for (const h of (await searchHdris(q)).slice(0, 8)) if (!pool.some((p) => p.id === h.id)) pool.push(h);
  const list = pool.slice(0, 16);
  if (list.length < 2 || !client) return list[0];
  try {
    const res = await chat("Choosing library models", {
      model: config.openai.model, temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: `Environment photos 0-${list.length - 1} (360° skies). Which best fits: ${look}? It lights and backs an event scene, so avoid anything that contradicts it (city streets and buildings for a countryside event, a sunny noon for a night event, an indoor room for an outdoor one). Return JSON {"best": index}.` },
        ...list.map((h) => ({ type: "image_url", image_url: { url: `https://cdn.polyhaven.com/asset_img/thumbs/${h.id}.png?width=256`, detail: "low" } })),
      ] }],
    });
    return list[Number(JSON.parse(res.choices[0].message.content || "{}").best)] || list[0];
  } catch { return list[0]; }
}

async function pickByLooks(query, models) {
  const withThumbs = models.filter((m) => m.thumbnail).slice(0, 10);
  if (!withThumbs.length) return models;
  try {
    const res = await chat("Choosing library models", {
      model: config.openai.model, temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: `Event decor search: "${query}". Images 0-${withThumbs.length - 1} are 3D model thumbnails. Return JSON {"good": [indexes]} of ONLY those that clearly show a single, standalone, photorealistic "${query}" of the quality a high-end event designer would hire — lush and full where it should be (a floral arrangement is many blooms and greenery, never a single stem or one oversized flower), realistic materials and proportions — best first. Reject: whole scenes or rooms, flat panels, cartoonish or low-poly looks, toys, single stems, a different object.` },
        ...withThumbs.map((m) => ({ type: "image_url", image_url: { url: m.thumbnail, detail: "low" } })),
      ] }],
    });
    const good = JSON.parse(res.choices[0].message.content || "{}").good;
    return Array.isArray(good) ? good.map((i) => withThumbs[i]).filter(Boolean) : models;
  } catch { return models; } // can't look right now: offer them as they are
}

/** Drapes hang on a wall (or behind the stage), never across the guest floor: move one to its nearest wall, facing the room. */
function toWall(o, room) {
  const d = [["minZ", o.position[2] - room.minZ], ["maxZ", room.maxZ - o.position[2]], ["minX", o.position[0] - room.minX], ["maxX", room.maxX - o.position[0]]].sort((a, b) => a[1] - b[1])[0];
  if (d[1] <= 1.2) return o;
  const inset = 0.35, [x, z] = o.position.filter((_, i) => i !== 1);
  const at = { minZ: [x, room.minZ + inset, 0], maxZ: [x, room.maxZ - inset, Math.PI], minX: [room.minX + inset, z, Math.PI / 2], maxX: [room.maxX - inset, z, -Math.PI / 2] }[d[0]];
  return { ...o, position: [r2(at[0]), o.position[1], r2(at[1])], rotation: [0, at[2], 0] };
}

/** n points evenly spaced along a truss's hanging runs (inset from the ends). */
function spreadOnRig(t, n) {
  const segs = rigSegments(t), lens = segs.map(([a, b]) => Math.hypot(b.x - a.x, b.z - a.z)), total = lens.reduce((x, y) => x + y, 0);
  const closed = t.variant === "circle" || t.variant === "square";
  return Array.from({ length: n }, (_, i) => {
    let d = closed ? ((i + 0.5) / n) * total : n > 1 ? total * (0.08 + (0.84 * i) / (n - 1)) : total / 2;
    for (let k = 0; k < segs.length; k++) {
      if (d <= lens[k] || k === segs.length - 1) { const [a, b] = segs[k], f = lens[k] ? Math.min(1, d / lens[k]) : 0; return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }; }
      d -= lens[k];
    }
    return { x: t.position[0], z: t.position[2] };
  });
}

// ---------- executing tool calls on a working copy ----------
/**
 * The scene tools on a working copy of `scene`: the same actions the chat agent calls, for code that builds
 * a design step by step (the concept builder) as well as for the agent. `instruction` is what the user asked
 * (the design_event tool passes it on).
 */
export function sceneTools(scene, { room, relayout, design, userId = null, protect = [], instruction = "" }) {
  const s = JSON.parse(JSON.stringify(scene));
  s.objects = s.objects || [];
  const changes = [];
  let seq = 0, generated = 0;
  // ceiling pieces hang from the room's real ceiling
  const ceiling = room.height || 6;
  const hangHeight = (type, def) => (type === "ceiling_drape" ? r2(ceiling - 0.25) : type === "chandelier" ? r2(Math.max(2.8, ceiling - 0.8 - 1.3)) : def.y || 0);
  const found = new Map(); // find_models results by ref, for add_model
  let modelsPlaced = 0;
  const newId = (t) => `${t}_${Date.now().toString(36)}${(seq++).toString(36)}`;
  const pick = (t = {}) => s.objects.filter((o) => (t.ids?.length ? t.ids.includes(o.id) : true) && (t.type ? o.type === t.type : true) && (t.variant ? o.variant === t.variant : true) && (t.name_contains ? o.name.toLowerCase().includes(String(t.name_contains).toLowerCase()) : true) && (t.ids?.length || t.type || t.variant || t.name_contains));
  const byId = (id) => s.objects.find((o) => o.id === id);
  const settle = (o, from) => {
    // chandeliers and ceiling drapes always hang from the ceiling, wherever they were placed ("above the tables"),
    // at a real size
    if (o.type === "chandelier" || o.type === "ceiling_drape") {
      const size = o.type === "chandelier" ? [Math.min(2, Math.max(0.5, o.size[0])), Math.min(1.8, Math.max(0.5, o.size[1])), Math.min(2, Math.max(0.5, o.size[2]))] : o.size;
      return keepInside({ ...o, size, position: [o.position[0], o.type === "chandelier" ? r2(Math.max(2.8, ceiling - 0.8 - size[1])) : r2(ceiling - 0.25), o.position[2]] }, room);
    }
    // truss lights clamp onto a truss, floor fixtures sit on the floor; nothing
    // stands inside something else or passes through a wall
    if (o.type === "light" && lightMount(o) === "truss" && s.objects.some((t) => t.type === "truss" && rigSegments(t).length)) o = hangFrom(o, s.objects) || o;
    if (o.type === "light" && lightMount(o) === "floor") o = { ...o, position: [o.position[0], room.floorY ?? 0, o.position[2]] };
    if (o.position[1] > 2.5 && o.type !== "light") return o;
    // a drape hung on a wall stays on its wall (it isn't standing on the guest floor)
    if (o.type === "curtain") {
      const b = bounds(o);
      if (Math.min(b.x0 - room.minX, room.maxX - b.x1, b.z0 - room.minZ, room.maxZ - b.z1) < 0.6) return keepInside(o, room);
    }
    // somewhere it can really stand: on a real surface or the floor, clear of everything, inside the walls
    return placeFree(keepInside(o, room), s.objects, room, { from, floorY: room.floorY ?? 0 });
  };

  function place(o, p = {}) {
    if (p.rotation_deg != null) o = { ...o, rotation: [0, (p.rotation_deg * Math.PI) / 180, 0] };
    if (p.position) return { ...o, position: [p.position[0], p.position[1] ?? o.position[1], p.position[2]] };
    if (p.room_spot) { const [x, z] = roomSpot(room, p.room_spot, s.objects.find((x) => x.type === "stage")?.rotation?.[1] || 0); return { ...o, position: [x, o.position[1], z] }; }
    if (p.relative_to) {
      const ref = byId(p.relative_to.id);
      if (!ref) throw new Error(`No object with id ${p.relative_to.id}`);
      if (o.type === "truss" && p.relative_to.relation === "above") return trussOver(o, ref);
      return placeRelative(o, ref, p.relative_to.relation, p.relative_to.gap ?? 0.3, s.objects);
    }
    return o;
  }
  // a truss sized and placed to carry `ref` (an LED wall, banner or lights) at its current height
  function trussOver(t, ref) {
    const b = bounds(ref), top = b.y1 + 0.25, H = Math.min((room.height || 8) - 0.3, top + 0.32);
    const facing = ref.rotation?.[1] || 0, fx = Math.sin(facing), fz = Math.cos(facing);
    // over a stage, dance floor or seating it is a lighting truss: rigged at working height, not carrying the object
    if (!["led_screen", "sign", "curtain"].includes(ref.type)) {
      const trim = Math.min((room.height || 8) - 0.5, Math.max(4.5, b.y1 + 3.5)), v = t.variant || "goalpost";
      if (v === "square" || v === "circle") return { ...t, size: [ref.size[0] + 1.2, trim, v === "circle" ? ref.size[0] + 1.2 : ref.size[2] + 1.2], rotation: [0, facing, 0], position: [ref.position[0], 0, ref.position[2]] };
      // a goalpost just in front of the stage lip, its towers clear of the sides
      const lip = ref.size[2] / 2 + 0.6;
      return { ...t, size: [Math.max(t.size[0], ref.size[0] + 1.4), trim, t.size[2]], rotation: [0, facing, 0], position: [r2(ref.position[0] + fx * lip), 0, r2(ref.position[2] + fz * lip)] };
    }
    if ((t.variant || "goalpost") === "circle") {
      // the ring reaches forward over the stage; the load hangs from its back arc
      const dia = Math.max(t.size[0], ref.size[0] * 1.6, 6), r = dia / 2 - 0.15;
      return { ...t, size: [dia, H, dia], rotation: [0, facing, 0], position: [r2(ref.position[0] + fx * r), 0, r2(ref.position[2] + fz * r)] };
    }
    const width = Math.max(t.size[0], ref.size[0] + 1.4);
    return { ...t, size: [width, H, t.size[2]], rotation: [0, facing, 0], position: [ref.position[0], 0, ref.position[2]] };
  }

  const run = {
    async add_objects(a) {
      const def = TYPES[a.type];
      if (!def) throw new Error(`Unknown type ${a.type}`);
      // the model sometimes nests these inside placement
      for (const k of ["arrange", "count", "spacing"]) if (a[k] == null && a.placement?.[k] != null) a[k] = a.placement[k];
      const rel = a.placement?.relative_to;
      if (rel && ["ring", "around", "surrounding"].includes(rel.relation)) { rel.relation = "centered_on"; a.arrange = "ring"; }
      if (a.placement && !a.placement.position && !a.placement.relative_to && !a.placement.room_spot && a.placement.rotation_deg == null) delete a.placement;
      if (!a.arrange && (a.count || 1) > 1 && a.type === "light" && ["uplighter", "floor-wash"].includes(a.variant) && !a.placement) a.arrange = "along_walls";
      const n = Math.max(1, Math.min(60, a.count || 1)), out = [];
      if (a.type === "curtain" && a.variant && !DRAPES[a.variant]) {
        // a colour asked for as a variety: that colour, in velour (or sheer voile)
        const word = String(a.variant).toLowerCase(), pal = s.plan?.design?.theme?.palette || [];
        a.color ||= pal.find((c) => c.name.toLowerCase().includes(word) || word.includes(c.name.toLowerCase()))?.hex || COLOUR_WORDS[Object.keys(COLOUR_WORDS).find((k) => word.includes(k))] || null;
        a.variant = /sheer|voile|white/.test(word) ? "white" : "ivory";
      }
      // new things face the audience as the stage does (in a lengthways room that isn't the default direction)
      const base = {
        type: a.type, name: a.name || a.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), rotation: [0, s.objects.find((x) => x.type === "stage")?.rotation?.[1] || 0, 0], size: a.size?.length === 3 ? a.size.map(Number) : [...(VARIANT_SIZE[a.type]?.[a.variant] || def.size)],
        color: a.color || (a.type === "curtain" && DRAPES[a.variant]) || DEFAULT_COLOR[a.type] || "#1C1E21", position: [0, hangHeight(a.type, def), 0], userAdded: true,
        ...(a.variant ? { variant: a.variant } : {}), ...(a.spec ? { spec: a.spec } : {}), ...(a.content ? { content: a.content } : {}), ...(a.text ? { text: a.text } : {}),
        ...(a.color && !["light", "round_table"].includes(a.type) ? { tint: true } : {}),
      };
      let anchor = place({ ...base, id: "tmp" }, a.placement || { room_spot: "center" });
      if (a.type === "curtain" && a.placement?.relative_to?.relation !== "behind") anchor = toWall(anchor, room); // a run of drape follows the wall
      const step = a.spacing || Math.max(base.size[0], base.size[2]) + 0.6;
      const refObj = a.placement?.relative_to && byId(a.placement.relative_to.id);
      // several truss lights are spread evenly along the truss they hang on
      const rigTruss = a.type === "light" && lightMount(base) === "truss" && n > 1
        ? (refObj?.type === "truss" ? refObj : s.objects.filter((t) => t.type === "truss" && rigSegments(t).length).sort((p, q) => Math.hypot(p.position[0] - anchor.position[0], p.position[2] - anchor.position[2]) - Math.hypot(q.position[0] - anchor.position[0], q.position[2] - anchor.position[2]))[0])
        : null;
      const rigPts = rigTruss ? spreadOnRig(rigTruss, n) : null;
      let skipped = 0;
      for (let i = 0; i < n; i++) {
        let o = { ...anchor, id: newId(a.type) };
        if (rigPts) o = hangFrom({ ...o, position: [rigPts[i].x, o.position[1], rigPts[i].z] }, s.objects, rigTruss.id) || o;
        else if (n > 1) {
          const [cx, , cz] = anchor.position;
          if (a.arrange === "ring") { const ang = (i / n) * Math.PI * 2, clear = refObj ? Math.hypot(refObj.size[0], refObj.size[2]) / 2 + 0.6 + Math.max(base.size[0], base.size[2]) / 2 : 0, rad = Math.max(step * n / (2 * Math.PI), 1.5, clear); o.position = [r2(cx + Math.cos(ang) * rad), o.position[1], r2(cz + Math.sin(ang) * rad)]; o.rotation = [0, Math.atan2(cx - o.position[0], cz - o.position[2]), 0]; }
          else if (a.arrange === "grid") { const cols = Math.ceil(Math.sqrt(n)); o.position = [r2(cx + ((i % cols) - (cols - 1) / 2) * step), o.position[1], r2(cz + (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * step)]; }
          else if (a.arrange === "along_walls") {
            const per = room.maxX - room.minX + room.maxZ - room.minZ, d = ((i + 0.5) / n) * per * 2, inset = 0.4;
            const W = room.maxX - room.minX, D = room.maxZ - room.minZ;
            const [x, z, face] = d < W ? [room.minX + d, room.minZ + inset, 0] : d < W + D ? [room.maxX - inset, room.minZ + d - W, -Math.PI / 2] : d < 2 * W + D ? [room.maxX - (d - W - D), room.maxZ - inset, Math.PI] : [room.minX + inset, room.maxZ - (d - 2 * W - D), Math.PI / 2];
            // uplighters and floor washes face the wall they light; everything else faces the room
            const atWall = o.type === "light" && lightMount(o) === "floor";
            o.position = [r2(x), o.position[1], r2(z)]; o.rotation = [0, face + (atWall ? Math.PI : 0), 0];
          } else { const { cos, sin } = Math, yaw = anchor.rotation?.[1] || 0, off = (i - (n - 1) / 2) * step; o.position = [r2(cx + cos(yaw) * off), o.position[1], r2(cz - sin(yaw) * off)]; }
        }
        if (!rigPts) {
          const free = settle(o, refObj && a.placement.relative_to.relation !== "on" ? refObj.position : undefined);
          if (!free) { skipped++; continue; }
          o = free;
        }
        s.objects.push(o); out.push({ id: o.id, position: o.position, size: o.size });
      }
      if (!out.length) return { error: `There is no free space for ${a.type === "model" ? "that" : `a ${a.type}`} there — everything near that spot is taken (tables and their walkways, the dance floor, the stage edge). Choose another spot, e.g. a wall or a corner.` };
      changes.push(`added ${out.length} ${a.type}`);
      return skipped ? { added: out, note: `${skipped} didn't fit without standing in something, so they were left out.` } : { added: out };
    },
    async update_objects(a) {
      const hit = pick(a.target);
      if (!hit.length) return { error: "No objects match that target.", available_types: [...new Set(s.objects.map((o) => o.type))] };
      const set = a.set || {};
      for (const o of hit) {
        let n = { ...o };
        if (set.name) n.name = set.name;
        if (set.color) { n.color = set.color; if (!["round_table", "light", "stage", "curtain", "booth", "sign"].includes(o.type)) n.tint = true; }
        if (set.size?.length === 3) n.size = set.size.map(Number);
        if (set.scale) n.size = n.size.map((v) => r2(v * set.scale));
        if (set.variant) n.variant = set.variant;
        if (set.spec) n.spec = { ...(o.spec || {}), ...set.spec };
        if (set.content) n.content = { ...(o.content || {}), ...set.content, mode: set.content.mode || o.content?.mode || "design" };
        if (set.text) n.text = { ...(o.text || {}), ...set.text };
        if (set.ledStrip != null) n.ledStrip = set.ledStrip;
        if (set.linen != null) n.linen = set.linen;
        if (set.move?.length) n.position = n.position.map((v, i) => r2(v + (Number(set.move[i]) || 0)));
        if (a.placement) n = place(n, a.placement);
        if (a.placement?.relative_to?.relation !== "hang_from") {
          // it is moving, so it mustn't count itself as being in its own way
          const others = s.objects;
          s.objects = others.filter((x) => x !== o);
          const free = settle(n);
          s.objects = others;
          if (free) n = free; else continue; // no room there: it stays where it was
        }
        Object.assign(o, n);
      }
      changes.push(`changed ${hit.length} ${hit[0].type}`);
      return { updated: hit.map((o) => ({ id: o.id, position: o.position, size: o.size, spec: o.spec })) };
    },
    async remove_objects(a) {
      const hit = new Set(pick(a.target).filter((o) => !protect.includes(o.type)).map((o) => o.id));
      if (!hit.size && pick(a.target).length) return { error: "Those are part of the design and stay; change them instead of removing them." };
      s.objects = s.objects.filter((o) => !hit.has(o.id) && !hit.has(o.group));
      changes.push(`removed ${hit.size}`);
      return { removed: hit.size };
    },
    async relayout(a) {
      const next = await relayout(s, a);
      s.plan = next.plan; s.checks = next.checks; s.stats = next.stats; s.objects = next.objects;
      changes.push("re-laid out the seating");
      return { stats: next.stats, checks: next.checks.map((c) => c.text) };
    },
    async set_lighting_environment(a) {
      if (a.none) { s.environment = { ...(s.environment || {}), hdri: null }; return { lighting: "studio" }; }
      // with a description of the setting, the sky is chosen by looking at it (no city skyline for a bush festival)
      const found = a.look ? await skyByLooks(a.search || "outdoor", a.look) : (await searchHdris(a.search || "studio"))[0];
      if (!found) return { error: "No HDRI matches that." };
      const h = await mirrorHdri(found.id);
      s.environment = { ...(s.environment || {}), hdri: { ...h, intensity: a.intensity ?? 0.8, background: !!a.background, rotationDeg: a.rotation_deg || 0 } };
      changes.push(`lighting: ${h.name}`);
      return { lighting: h.name };
    },
    async apply_material(a) {
      const hit = pick(a.target);
      if (!hit.length) return { error: "No objects match that target." };
      const surfaceOf = (o) => a.surface && (SURFACES[o.type] || ["body"]).includes(a.surface) ? a.surface : (SURFACES[o.type] || ["body"])[0];
      if (a.none) { for (const o of hit) { const f = { ...(o.finish || {}) }; delete f[surfaceOf(o)]; o.finish = f; } changes.push(`restored ${hit[0].type} finish`); return { restored: hit.length }; }
      // cloth stays cloth: a tablecloth or skirting never gets tiles or stone because a colour word matched them
      const soft = ["cloth", "fabric", "skirt"].includes(surfaceOf(hit[0])), group = a.group || (soft ? "fabric" : "");
      // a scan only counts when it matches what makes the request distinctive ("shuka", "check", "red"), not "fabric"
      const GENERIC = new Set(["and", "with", "the", "for", "fabric", "cloth", "material", "texture", "pattern", "style", "inspired", "like", "fine", "rich"]);
      const words = String(a.search || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
      const matchOf = (it) => words.filter((w) => [it.id, it.name, ...(it.tags || []), ...(it.categories || [])].join(" ").toLowerCase().includes(w)).length;
      const need = Math.max(1, Math.ceil(words.length * 0.6));
      const found = [...(await searchMaterials(a.search || "", group)), ...(soft ? [] : await searchMaterials(a.search || ""))].find((it) => matchOf(it) >= need) || null;
      // painted before with the same words? use it again
      let made = found ? null : aiMaterials().find((m) => words.length && words.every((w) => m.name.toLowerCase().includes(w))) || null;
      // nothing like it in the library (a Maasai shuka check, a kente weave…): paint it with Nano Banana — a couple per request
      if (!found && !made && a.search && imagesEnabled() && generated < 3) { generated++; made = await generateMaterial(`${a.search}${soft && !/fabric|cloth|weave/i.test(a.search) ? " fabric" : ""}`).catch(() => null); }
      if (!found && !made) return { error: `No ${group || ""} material matches "${a.search}" — set the colour (update_objects color) instead.` };
      const f = { ...(made || await mirrorMaterial(found.id)), ...(a.scale ? { scale: a.scale } : {}) };
      for (const o of hit) o.finish = { ...(o.finish || {}), [surfaceOf(o)]: f };
      changes.push(`${f.name} on ${hit.length} ${hit[0].type}`);
      return { material: f.name, applied_to: hit.length, surface: surfaceOf(hit[0]), ...(made ? { painted_for_this: true } : {}), done: true };
    },
    async arrange_screens(a) {
      const stage = s.objects.find((o) => o.type === "stage");
      if (!stage) return { error: "There is no stage to arrange screens around — add a stage first." };
      const old = s.objects.filter((o) => o.type === "led_screen");
      s.objects = s.objects.filter((o) => o.type !== "led_screen");
      const rig = screenRig(stage, a.layout, ceiling, old[0]?.content).map((o) => ({ ...o, id: newId("led") }));
      s.objects.push(...rig);
      changes.push(`${a.layout} screen layout`);
      return { screens: rig.map((o) => ({ id: o.id, name: o.name, size: o.size })) };
    },
    async find_models(a) {
      const q = String(a.query || "").toLowerCase().trim();
      // built-in kit and materials are not library models
      const kit = [[/chandelier/, "chandeliers: add_objects type chandelier"], [/arch|canopy|gazebo/, "arches: add_objects type arch (with spec.flowers)"], [/ceiling|swag/, "ceiling draping: add_objects type ceiling_drape"],
        [/light|uplight|wash|spot|beam|led|lamp/, "lights: add_objects type light (e.g. variant uplighter, along_walls)"], [/drape|curtain|backdrop drape|pipe/, "drapes: add_objects type curtain with a color"], [/truss/, "truss: add_objects type truss"],
        [/fabric|runner|linen|cloth|pattern|print|skirting/, "fabrics and patterns: apply_material with a precise description (it is painted if no scan matches)"], [/sash|chair cover/, "chair covers and sashes: update_objects type chair, spec.cover / spec.sash"], [/banner|sign|poster|backdrop/, "signs: add_objects type sign"]];
      const hit = kit.find(([re]) => re.test(q));
      if (hit) return { error: `Not a library model — ${hit[1]}.` };
      if (found.has(`q:${q}`)) return { already_searched: true, models: found.get(`q:${q}`), note: "Same results as before: pick one ref and call add_model, try simpler words once, or skip this step if none fit." };
      const pool = [];
      // greenery, flowers and other vegetation come from BlenderKit only (its plants are built for close-up event use)
      const green = /flower|floral|bloom|bouquet|plant|green|foliage|leaf|leaves|garland|eucalyptus|palm|fern|tree|shrub|bush|hedge|moss|ivy|succulent|pampas|grass|vegetation|vine|orchid|rose|peony|lily|dahlia|hydrangea/i.test(q);
      for (const src of green ? ["blenderkit"] : ["blenderkit", "polyhaven", "sketchfab"]) {
        try { pool.push(...(await cachedSearch(src, String(a.query || ""))).results.filter((x) => !x.needsKey).slice(0, green ? 10 : 4).map((m) => ({ ...m, source: m.source || src }))); }
        catch { /* that library is unreachable right now */ }
      }
      const models = [];
      for (const m of await pickByLooks(String(a.query || ""), pool)) { const ref = `${m.source}:${m.externalId}`; found.set(ref, m); models.push({ ref, name: m.name, source: m.source }); }
      if (!models.length) {
        const pick = await sourceModel(String(a.query || ""), { theme: s.plan?.design?.theme?.name || s.plan?.eventType || "", userId });
        if (pick) models.push({ ref: run.use_model(pick), name: pick.model.name, source: pick.model.source });
      }
      found.set(`q:${q}`, models);
      return models.length ? { models } : { error: `No models found for "${a.query}" — try simpler words (e.g. "flower arrangement", "vase", "lantern").` };
    },
    /** A model the sourcing step chose (imported and measured), ready for add_model. Not offered to the chat model. */
    use_model(pick) {
      const ref = `${pick.model.source}:${pick.model.externalId}`;
      found.set(ref, { ...pick.model, asset: pick.asset, upright: pick.upright });
      return ref;
    },
    async add_model(a) {
      for (const k of ["on_each", "count", "arrange", "spacing"]) if (a[k] == null && a.placement?.[k] != null) a[k] = a.placement[k]; // often nested
      const m = found.get(a.ref);
      if (!m) return { error: "Unknown ref — call find_models first and use one of its refs." };
      const on = a.placement?.relative_to?.id && byId(a.placement.relative_to.id);
      if (on?.type === "model") return { error: "Don't stack models on other models — place it relative to the stage, a table, a wall or a room spot." };
      if (!a.on_each && (modelsPlaced + (a.count || 1)) > 16) return { error: "That's plenty of loose decor already — use on_each for table pieces, or finish." };
      // a model the sourcing step chose comes measured (and stood up if it was modelled lying down)
      const asset = m.asset || await importModel(userId, m);
      const real = Array.isArray(asset.size) ? asset.size : [1, 1, 1];
      const uprightSpec = m.upright ? { upright: m.upright } : null;
      const k = Number(a.height_m) > 0 ? Number(a.height_m) / (real[1] || 1) : 1;
      const size = real.map((v) => Math.max(0.05, r2(v * k)));
      // a flat panel, a whole scene or a model lying on its side would come out absurd at that height: pick another
      const foot = Math.max(size[0], size[2]);
      if (foot > Math.max(3, Number(a.height_m) * 3.5) || real[1] < 0.02) return { error: `"${m.name}" is ${real.map((v) => r2(v)).join(" × ")} m as modelled (wide and flat, not a ${a.name || "standing object"}) — choose a different ref.` };
      let r;
      if (a.on_each) {
        // one on each table (replacing what was there, e.g. the candelabras), centred on its top
        const hosts = s.objects.filter((o) => o.type === a.on_each);
        if (!hosts.length) return { error: `There is no ${a.on_each} in the scene.` };
        const ids = new Set(hosts.map((h) => h.id));
        s.objects = s.objects.filter((o) => !(o.type === "centrepiece" && ids.has(o.group)));
        r = { added: hosts.map((h) => {
          // it fits the middle of the table, leaving the place settings their room
          const fit = Math.min(1, (Math.min(h.size[0], h.size[2]) * 0.42) / Math.max(size[0], size[2]));
          const sz = fit < 1 ? size.map((v) => r2(v * fit)) : size;
          const o = { id: newId("model"), type: "model", name: a.name || m.name.slice(0, 60), position: [h.position[0], r2(h.position[1] + h.size[1]), h.position[2]], rotation: [0, 0, 0], size: sz, color: "#CBD3DD", userAdded: true, group: h.id, ...(uprightSpec ? { spec: uprightSpec } : {}) };
          s.objects.push(o); return { id: o.id, position: o.position, size: sz };
        }) };
        changes.push(`added ${hosts.length}`);
      } else {
        r = await run.add_objects({ type: "model", name: a.name || m.name.slice(0, 60), size, ...(uprightSpec ? { spec: uprightSpec } : {}), placement: a.placement, count: a.count, arrange: a.arrange, spacing: a.spacing });
        // decor never stands on the dance floor
        const floors = s.objects.filter((o) => o.type === "dance_floor").map(bounds);
        const onFloor = (o) => { const b = bounds(o); return floors.some((f) => b.x0 < f.x1 && b.x1 > f.x0 && b.z0 < f.z1 && b.z1 > f.z0); };
        const bad = new Set((r.added || []).map((x) => byId(x.id)).filter((o) => o && onFloor(o)).map((o) => o.id));
        if (bad.size) { s.objects = s.objects.filter((o) => !bad.has(o.id)); r.added = r.added.filter((x) => !bad.has(x.id)); if (!r.added.length) return { error: "That spot is on the dance floor — place it beside the stage, along its front edge or at the walls instead." }; }
        modelsPlaced += r.added.length;
      }
      for (const it of r.added || []) {
        const o = byId(it.id);
        if (!o) continue;
        delete o.tint;
        Object.assign(o, { color: "#CBD3DD", modelUrl: asset.file_url, asset: { url: asset.file_url, name: m.name, thumbnail: m.thumbnail || null, author: m.author || null, license: m.license || null, source: m.source, externalId: m.externalId } });
      }
      changes[changes.length - 1] = `added ${r.added?.length || 0} × ${m.name}`;
      return { added: r.added, model: m.name, size };
    },
    async design_event(a) {
      if (!design) return { error: "Redesigning isn't available here." };
      // the user's own words are the brief: the agent's paraphrase tends to drag in the current scene ("in a cocktail layout")
      const extra = String(a.brief || "").replace(/\b(in )?an? (cocktail|banquet|feast|theat(er|re))[- ]?(style )?(layout|setup|arrangement)\b,?/gi, "").trim();
      const next = await design(extra && extra !== instruction ? `${instruction} (${extra})` : instruction, s);
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, next);
      changes.push("redesigned the event");
      return { designed: true, concept: next.plan?.design?.concept, theme: next.plan?.design?.theme?.name, objects: next.objects.length, note: "The event is rebuilt. Only make further changes if the user asked for something specific beyond the redesign." };
    },
    async inspect_objects(a) { return { objects: pick(a.target).slice(0, 20) }; },
  };

  return { run, s, changes };
}

export async function runAgent(instruction, scene, { room, history = [], relayout, design, userId = null, maxSteps = 10, protect = [] }) {
  const { run, s, changes } = sceneTools(scene, { room, relayout, design, userId, protect, instruction });
  const messages = [
    { role: "system", content: SYSTEM },
    ...history.slice(-8).map((m) => ({ role: m.from === "you" ? "user" : "assistant", content: m.text })),
    { role: "user", content: `Current scene:\n${describeForAgent(s, room)}\n\nRequest: ${instruction}` },
  ];
  for (let step = 0; step < maxSteps; step++) {
    const res = await chat("AI assistant", { model: config.openai.model, temperature: 0.2, messages, tools: TOOLS, tool_choice: "auto", parallel_tool_calls: true }); // several independent steps per round trip; they still run in order
    const msg = res.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return { reply: msg.content || "Done.", scene: s, changes };
    for (const call of msg.tool_calls) {
      let out;
      if (process.env.DEBUG_AGENT) console.log("[agent]", call.function.name, call.function.arguments);
      try { out = await run[call.function.name](JSON.parse(call.function.arguments || "{}")); }
      catch (e) { out = { error: e.message }; }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out).slice(0, 6000) });
    }
    // after a change, show the model the scene as it now is — only the latest state, so each step stays small
    for (const m of messages) if (m.role === "user" && typeof m.content === "string" && m.content.startsWith("Scene now:")) m.content = "(an earlier scene state — superseded below)";
    messages.push({ role: "user", content: `Scene now:\n${describeForAgent(s, room)}\nContinue if anything in the request is not done yet; otherwise reply with what you did.` });
  }
  return { reply: `Done: ${changes.join(", ")}.`, scene: s, changes };
}
