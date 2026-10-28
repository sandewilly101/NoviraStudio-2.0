// The designer's spec, built. The planner describes a design as a structured
// "build" (what every surface wears, what stands where, how it is lit and
// branded); this carries it out on a solved layout, step by step, with the same
// tools the chat agent uses — so what the concept promises is what the 3D
// scene has. The concept image is then rendered from that scene (see
// /projects/concept), never imagined separately.
import { sceneTools } from "./agent.js";
import { generateGraphic, imagesEnabled } from "./images.js";
import { saveBase64 } from "../files.js";
import { sourceModel } from "./sourcing.js";

// ---------- the spec, as the planner writes it ----------
export const BUILD_SCHEMA = `{
    "linen": { "color": "#hex", "material": string|null },   // tablecloths: a theme colour; material only when special, in words ("black satin", "gold sequin", "red and black chequered cloth")
    "chairs": { "cover": "#hex"|null, "sash": "#hex"|null },  // fitted covers and/or satin sashes, or null to show the chairs bare
    "centrepiece": { "kind": "candelabra"|"model", "search": string|null, "height_m": number },  // model: 1-3 plain words for the 3D library ("white roses", "trophy", "lantern")
    "danceFloor": "checker"|"white-gloss"|"black-gloss"|"oak"|"starlit"|null,
    "stage": { "skirt": "#hex"|null, "skirtMaterial": string|null, "deck": "deck"|"carpet"|"gloss", "fascia": "none"|"printed"|"led" },
    "screens": "center"|"center-sides"|"triptych"|"ultrawide"|"columns"|"curved",
    "drapes": [{ "where": "behind_stage"|"side_walls"|"back_wall", "variant": "black"|"ivory"|"white"|"navy"|"burgundy"|"gold", "color": "#hex" }],
    "ceiling": { "kind": "none"|"drapes"|"chandeliers"|"both", "drapeColor": "#hex"|null, "chandelier": "crystal-tiered"|"candle-gold"|"crystal-ball"|null },
    "lighting": { "uplights": "#hex"|null, "stageWash": "#hex"|null, "movingHeads": number, "gobo": "none"|"dots"|"breakup"|"stars"|"rays"|"swirl"|"ring" },
    "branding": [{ "item": "rollup"|"backdrop"|"media-wall"|"hanging", "where": "entrance"|"stage_left"|"stage_right"|"walls", "count": number, "graphic": string }],
    "furniture": { "chair": string|null, "table": string|null },  // only when the theme needs a particular look the chair/table styles lack: plain words ("rattan chair", "wooden folding chair", "chiavari chair", "rustic farm table"), else null
    "props": [{ "search": string, "where": "entrance"|"stage_left"|"stage_right"|"stage_front"|"corners"|"walls", "count": number, "height_m": number }],
    "environment": string  // 2-3 words for the lighting environment ("indoor warm", "night city")
  }`;

const HEX = /^#[0-9a-f]{6}$/i;
const lum = (h) => { const n = parseInt(String(h).slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
const hex = (v) => (typeof v === "string" && HEX.test(v) ? v : null);
const one = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
const words = (v, n = 60) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/** The planner's build, made safe: only things the kit and the libraries can really make. */
export function normalizeBuild(b = {}, palette = []) {
  const pal = palette.map((c) => c.hex).filter(Boolean), first = pal[0] || "#1B1B1F", second = pal[1] || "#C9A227";
  return {
    linen: { color: hex(b.linen?.color) || second, material: words(b.linen?.material) },
    chairs: { cover: hex(b.chairs?.cover), sash: hex(b.chairs?.sash) },
    centrepiece: { kind: one(b.centrepiece?.kind, ["candelabra", "model"], "candelabra"), search: words(b.centrepiece?.search, 40), height_m: num(b.centrepiece?.height_m, 0.2, 1.2, 0.6) },
    danceFloor: one(b.danceFloor, ["checker", "white-gloss", "black-gloss", "oak", "starlit"], null),
    stage: { skirt: hex(b.stage?.skirt), skirtMaterial: words(b.stage?.skirtMaterial), deck: one(b.stage?.deck, ["deck", "carpet", "gloss"], "deck"), fascia: one(b.stage?.fascia, ["none", "printed", "led"], "printed") },
    screens: one(b.screens, ["center", "center-sides", "triptych", "ultrawide", "columns", "curved"], "center"),
    drapes: (Array.isArray(b.drapes) ? b.drapes : []).slice(0, 3).map((d) => ({ where: one(d?.where, ["behind_stage", "side_walls", "back_wall"], "behind_stage"), variant: one(d?.variant, ["black", "ivory", "white", "navy", "burgundy", "gold"], "black"), color: hex(d?.color) })),
    ceiling: { kind: one(b.ceiling?.kind, ["none", "drapes", "chandeliers", "both"], "none"), drapeColor: hex(b.ceiling?.drapeColor), chandelier: one(b.ceiling?.chandelier, ["crystal-tiered", "candle-gold", "crystal-ball"], "crystal-tiered") },
    lighting: { uplights: hex(b.lighting?.uplights) || first, stageWash: hex(b.lighting?.stageWash), movingHeads: Math.round(num(b.lighting?.movingHeads, 0, 8, 4)), gobo: one(b.lighting?.gobo, ["none", "dots", "breakup", "stars", "rays", "swirl", "ring"], "none") },
    branding: (Array.isArray(b.branding) ? b.branding : []).slice(0, 4).map((x) => ({ item: one(x?.item, ["rollup", "backdrop", "media-wall", "hanging"], "rollup"), where: one(x?.where, ["entrance", "stage_left", "stage_right", "walls"], "entrance"), count: Math.round(num(x?.count, 1, 6, 1)), graphic: words(x?.graphic, 300) })).filter((x) => x.graphic),
    furniture: { chair: words(b.furniture?.chair, 40), table: words(b.furniture?.table, 40) },
    props: (Array.isArray(b.props) ? b.props : []).slice(0, 3).map((x) => ({ search: words(x?.search, 40), where: one(x?.where, ["entrance", "stage_left", "stage_right", "stage_front", "corners", "walls"], "stage_left"), count: Math.round(num(x?.count, 1, 8, 2)), height_m: num(x?.height_m, 0.2, 4, 1.2) })).filter((x) => x.search),
    environment: words(b.environment, 40),
  };
}

// branding graphics are painted once per event and shared by all its designs
const graphics = new Map();
function graphicFor(prompt, item, palette, title) {
  const key = `${item}|${prompt}`;
  if (!graphics.has(key)) {
    const aspect = item === "rollup" ? "9:16" : item === "hanging" ? "21:9" : "4:3";
    const words = title ? `${prompt}. Write the words "${title}" large and legible, once.` : prompt;
    graphics.set(key, imagesEnabled()
      ? generateGraphic(words, { aspect, colors: palette, feature: "Branding graphics" }).then((img) => saveBase64("graphics", img.base64, img.mimeType.includes("jpeg") ? "jpg" : "png")).catch((e) => { console.warn("[build] graphic failed:", e.message); return null; })
      : Promise.resolve(null));
  }
  return graphics.get(key);
}

const PROTECT = ["stage", "led_screen", "round_table", "long_table", "cocktail_table", "chair", "dance_floor"];
const TABLES = ["round_table", "long_table", "cocktail_table"];

/**
 * Build the plan's design onto a solved scene. Returns the dressed scene and a
 * log of what was done (and what couldn't be), step by step.
 */
const furnitureTheme = (plan) => [plan.design.theme?.name, plan.eventType].filter(Boolean).join(", ");
const modelTheme = (plan) => [plan.design.theme?.name, plan.eventType, plan.design.setting === "outdoor" ? "outdoors" : ""].filter(Boolean).join(", ");

/**
 * Starts sourcing every model the design names and painting its graphics, all at once and without
 * waiting: both are shared promises, so the build then finds them ready instead of making them one by one.
 */
export function sourceAhead(plan, userId) {
  const b = plan.design?.build;
  if (!b) return;
  for (const w of [b.furniture?.chair, b.furniture?.table]) if (w) sourceModel(w, { theme: furnitureTheme(plan), userId, minScore: 7 });
  for (const w of [b.centrepiece?.kind === "model" && b.centrepiece.search, ...(b.props || []).map((p) => p.search)]) if (w) sourceModel(w, { theme: modelTheme(plan), userId });
  // and the branding graphics painted (the slowest part: a few image generations, now side by side)
  const palette = (plan.design.theme?.palette || []).map((c) => `${c.name} ${c.hex}`), title = plan.design.screenTitle || plan.eventName || "";
  for (const x of b.branding || []) graphicFor(x.graphic, x.item, palette, x.item === "rollup" || x.item === "backdrop" || x.item === "media-wall" ? title : "");
}

export async function buildDesign(scene, plan, { room, userId }) {
  const b = plan.design?.build;
  if (!b) return { scene, log: [] };
  const { run, s } = sceneTools(scene, { room, userId, protect: PROTECT });
  const log = [];
  const step = async (label, fn) => {
    try { const r = await fn(); log.push(r?.error ? `${label}: ${r.error}` : label); return r; }
    catch (e) { log.push(`${label}: ${e.message}`); return null; }
  };
  const palette = (plan.design.theme?.palette || []).map((c) => `${c.name} ${c.hex}`);
  const of = (type) => s.objects.find((o) => o.type === type);
  const tables = TABLES.filter((t) => s.objects.some((o) => o.type === t));
  const stage = of("stage");
  const outdoor = !!room.outdoor; // open air: no walls to drape or uplight, no ceiling
  const yaw = stage?.rotation?.[1] || 0, fx = Math.sin(yaw), fz = Math.cos(yaw);
  const ceiling = room.height || 6;
  // where something goes, in the tools' terms
  const near = (where, gap = 0.6) => (!stage || where === "entrance" ? { room_spot: "entrance" }
    : where === "stage_left" ? { relative_to: { id: stage.id, relation: "left_of", gap } }
      : where === "stage_right" ? { relative_to: { id: stage.id, relation: "right_of", gap } }
        : where === "stage_front" ? { relative_to: { id: stage.id, relation: "in_front_of", gap } }
          : { room_spot: "center" });

  // 0. themed furniture: the chairs and tables themselves, sourced and measured like any model
  const furnished = async (kind, types) => {
    const want = b.furniture?.[kind];
    if (!want || !types.some((t) => s.objects.some((o) => o.type === t))) return;
    const pick = await sourceModel(want, { theme: furnitureTheme(plan), userId, minScore: 7 });
    if (!pick) { log.push(`${kind}: no realistic "${want}" found, keeping the styled ${kind}s`); return; }
    const a = pick.asset, asset = { url: a.file_url, name: a.name, thumbnail: a.thumbnail_url, author: a.author, license: a.license, source: pick.model.source, externalId: pick.model.externalId, kind: want };
    s.objects = s.objects.map((o) => (types.includes(o.type) ? (({ tint: _t, ...rest }) => ({ ...rest, asset, ...(o.type === "round_table" ? { linen: false } : {}) }))(o) : o));
    log.push(`${kind}s: ${pick.model.name} (${pick.model.source}, score ${pick.score})`);
  };
  await furnished("chair", ["chair"]);
  await furnished("table", ["round_table", "long_table"]);

  // 1. what every surface wears
  for (const t of tables) {
    if (b.furniture?.table && s.objects.some((o) => o.type === t && o.asset?.kind === b.furniture.table)) continue; // a sourced table is shown bare, as chosen
    await step(`${t} linen ${b.linen.color}`, () => run.update_objects({ target: { type: t }, set: { color: b.linen.color, ...(t === "cocktail_table" ? {} : { linen: true }) } }));
    if (b.linen.material) await step(`${t} cloth: ${b.linen.material}`, () => run.apply_material({ target: { type: t }, surface: t === "round_table" ? "cloth" : undefined, search: b.linen.material, group: "fabric" }));
  }
  // a chair model in its own off-theme colour (the default and stacking chairs are royal blue) is dressed in covers
  const bareOk = ["gold-banquet", "cane-wood", "wood-dining", "upholstered"].includes(plan.design.chairStyle);
  if (!b.chairs.cover && !b.chairs.sash && !bareOk) {
    const dark = [...(plan.design.theme?.palette || [])].sort((p, q) => lum(p.hex) - lum(q.hex))[0]?.hex;
    if (dark) b.chairs.cover = dark;
  }
  if (b.chairs.cover || b.chairs.sash) await step("chair covers and sashes", () => run.update_objects({ target: { type: "chair" }, set: { spec: { ...(b.chairs.cover ? { cover: b.chairs.cover } : {}), ...(b.chairs.sash ? { sash: b.chairs.sash } : {}) } } }));
  if (b.danceFloor && of("dance_floor")) await step(`dance floor ${b.danceFloor}`, () => run.update_objects({ target: { type: "dance_floor" }, set: { variant: b.danceFloor } }));
  if (stage) {
    await step("stage dressing", () => run.update_objects({ target: { type: "stage" }, set: { spec: { ...(b.stage.skirt ? { skirt: b.stage.skirt } : {}), top: b.stage.deck, fascia: b.stage.fascia } } }));
    if (b.stage.skirtMaterial) await step(`stage skirt: ${b.stage.skirtMaterial}`, () => run.apply_material({ target: { type: "stage" }, surface: "skirt", search: b.stage.skirtMaterial, group: "fabric" }));
  }
  if (of("led_screen") && b.screens !== "center") await step(`screens ${b.screens}`, () => run.arrange_screens({ layout: b.screens }));

  // 2. drapes and the ceiling
  for (const d of outdoor ? b.drapes.filter((x) => x.where === "behind_stage") : b.drapes) {
    const height = Math.min(ceiling - 0.4, 6);
    if (d.where === "behind_stage" && stage) {
      // a backdrop hangs on the wall behind the stage, centred on it, facing the guests
      let t = 0;
      while (t < 100) { const x = stage.position[0] - fx * (t + 0.1), z = stage.position[2] - fz * (t + 0.1); if (x < room.minX || x > room.maxX || z < room.minZ || z > room.maxZ) break; t += 0.1; }
      // outdoors there's no wall: a free-standing pipe-and-drape just behind the stage
      if (outdoor) t = Math.min(t, Math.min(stage.size[0], stage.size[2]) / 2 + 0.8);
      const at = [stage.position[0] - fx * (t - 0.25), 0, stage.position[2] - fz * (t - 0.25)];
      await step(`${d.variant} drape behind the stage`, () => run.add_objects({ type: "curtain", variant: d.variant, color: d.color || undefined, size: [Math.min(Math.abs(fx) > 0.5 ? room.maxZ - room.minZ - 1 : room.maxX - room.minX - 1, stage.size[0] + 4), height, 0.2], placement: { position: at, rotation_deg: (yaw * 180) / Math.PI } }));
    } else if (d.where === "side_walls") {
      // on both side walls, running along them (parallel to the way the guests face the stage), 30 cm off the wall
      const along = (Math.atan2(-fz, fx) * 180) / Math.PI, len = Math.min(10, (Math.abs(fz) > 0.5 ? room.maxZ - room.minZ : room.maxX - room.minX) * 0.55);
      const cx = (room.minX + room.maxX) / 2, cz = (room.minZ + room.maxZ) / 2;
      for (const [side, name] of [[1, "left"], [-1, "right"]]) {
        const sx = -fz * side, sz = fx * side;
        let t = 0;
        while (t < 100) { const x = cx + sx * (t + 0.1), z = cz + sz * (t + 0.1); if (x < room.minX || x > room.maxX || z < room.minZ || z > room.maxZ) break; t += 0.1; }
        await step(`${d.variant} drape on the ${name} wall`, () => run.add_objects({ type: "curtain", variant: d.variant, color: d.color || undefined, size: [len, height, 0.2], placement: { position: [cx + sx * (t - 0.3), 0, cz + sz * (t - 0.3)], rotation_deg: along } }));
      }
    } else {
      await step(`${d.variant} drape on the back wall`, () => run.add_objects({ type: "curtain", variant: d.variant, color: d.color || undefined, size: [Math.min(12, room.maxX - room.minX - 1), height, 0.2], placement: { room_spot: "front_wall", rotation_deg: (yaw * 180) / Math.PI } }));
    }
  }
  // over the seating: the ceiling treatment spans the tables
  const seats = s.objects.filter((o) => TABLES.includes(o.type));
  if (seats.length && b.ceiling.kind !== "none" && !outdoor) {
    const xs = seats.map((o) => o.position[0]), zs = seats.map((o) => o.position[2]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, w = Math.max(...xs) - Math.min(...xs) + 2, d = Math.max(...zs) - Math.min(...zs) + 2;
    if (b.ceiling.kind === "drapes" || b.ceiling.kind === "both") {
      const longX = w >= d;
      await step("ceiling drapes over the tables", () => run.add_objects({ type: "ceiling_drape", color: b.ceiling.drapeColor || undefined, size: [longX ? w : d, 1.2, longX ? d * 0.8 : w * 0.8], spec: { count: Math.max(3, Math.round((longX ? d : w) / 2.5)), layout: "parallel" }, placement: { position: [cx, 0, cz], rotation_deg: longX ? 0 : 90 } }));
    }
    if (b.ceiling.kind === "chandeliers" || b.ceiling.kind === "both") {
      const n = Math.min(9, Math.max(2, Math.round(seats.length / 3)));
      await step(`${n} ${b.ceiling.chandelier} chandeliers`, () => run.add_objects({ type: "chandelier", variant: b.ceiling.chandelier, count: n, arrange: "grid", spacing: Math.max(3, Math.min(w, d) / Math.ceil(Math.sqrt(n))), placement: { position: [cx, 0, cz] } }));
    }
  }

  // 3. light: the walls washed in the theme colour, the stage lit from a truss
  if (b.lighting.uplights && !outdoor) {
    const per = 2 * (room.maxX - room.minX + room.maxZ - room.minZ), n = Math.max(8, Math.min(24, Math.round(per / 3.5)));
    await step(`${n} uplighters ${b.lighting.uplights}`, () => run.add_objects({ type: "light", variant: "uplighter", color: b.lighting.uplights, count: n, arrange: "along_walls" }));
  }
  if (stage && b.lighting.movingHeads > 0) {
    const truss = await step("lighting truss over the stage", () => run.add_objects({ type: "truss", variant: "goalpost", placement: { relative_to: { id: stage.id, relation: "above" } } }));
    const t = truss?.added?.[0];
    if (t) await step(`${b.lighting.movingHeads} moving heads`, () => run.add_objects({ type: "light", variant: "moving-head-wash", color: b.lighting.stageWash || b.lighting.uplights, count: b.lighting.movingHeads, spec: b.lighting.gobo !== "none" ? { fx: { gobo: b.lighting.gobo } } : {}, placement: { relative_to: { id: t.id, relation: "hang_from" } } }));
  }

  // 4. branding: the graphics painted in the theme, on real display hardware
  const title = plan.design.screenTitle || plan.eventName || "";
  for (const x of b.branding) {
    const url = await graphicFor(x.graphic, x.item, palette, x.item === "rollup" || x.item === "backdrop" || x.item === "media-wall" ? title : "");
    const content = url ? { mode: "media", mediaUrl: url, mediaKind: "image", fit: "cover", mediaBg: "#000000" } : { mode: "design", template: "headline", title, subtitle: plan.design.theme?.name || "", bg: plan.design.theme?.palette?.[0]?.hex || "#111111", fg: "#FFFFFF", accent: plan.design.theme?.palette?.[1]?.hex || "#C9A227", font: "display" };
    if (x.item === "hanging") {
      const truss = s.objects.find((o) => o.type === "truss");
      if (truss) { await step("hanging banner over the stage", () => run.add_objects({ type: "sign", variant: "hanging", content, placement: { relative_to: { id: truss.id, relation: "hang_from" } } })); continue; }
    }
    const where = x.where === "walls" ? { room_spot: "center" } : near(x.where);
    await step(`${x.count} ${x.item} (${x.where})`, () => run.add_objects({ type: "sign", variant: x.item === "hanging" ? "backdrop" : x.item, content, count: x.count, ...(x.where === "walls" ? { arrange: "along_walls" } : x.count > 1 ? { arrange: "row" } : {}), placement: where }));
  }

  // 5. the centrepieces and themed props: real models from the libraries
  // sourced like a production buyer would: several precise searches over every library, the thumbnails
  // scored for the right object and realism, the best imported and measured (see sourcing.js)
  sourceAhead(plan, userId); // (already under way when called from /generate)
  const theme = modelTheme(plan);
  const findRef = async (words) => {
    const pick = await sourceModel(words, { theme, userId });
    log.push(pick ? `sourced "${words}": ${pick.model.name} (${pick.model.source}, score ${pick.score}${pick.upright ? ", stood upright" : ""})` : `sourced "${words}": nothing good enough found`);
    return pick ? run.use_model(pick) : null;
  };
  if (b.centrepiece.kind === "model" && b.centrepiece.search && tables.length) {
    const ref = await findRef(b.centrepiece.search);
    if (ref) for (const t of tables.filter((x) => x !== "cocktail_table")) await step(`centrepiece on each ${t}`, () => run.add_model({ ref, height_m: b.centrepiece.height_m, on_each: t }));
  }
  for (const p of b.props) {
    const ref = await findRef(p.search);
    if (!ref) continue;
    if (p.where === "corners") {
      for (const c of ["front_left_corner", "front_right_corner", "back_left_corner", "back_right_corner"].slice(0, p.count)) await step(`${p.search} (${c})`, () => run.add_model({ ref, height_m: p.height_m, placement: { room_spot: c } }));
    } else {
      await step(`${p.count} ${p.search} (${p.where})`, () => run.add_model({ ref, height_m: p.height_m, count: p.count, ...(p.where === "walls" ? { arrange: "along_walls" } : p.count > 1 ? { arrange: "row", spacing: Math.max(1.2, p.height_m * 0.8) } : {}), placement: p.where === "walls" ? { room_spot: "center" } : near(p.where, 0.8) }));
    }
  }

  // 6. the light the photograph is taken in
  // the sky is picked by looking at it, to fit the theme, the setting and the time of day
  const skyLook = `${b.environment}; ${outdoor ? "an open-air" : "an indoor"} ${plan.eventType} with the theme "${plan.design.theme?.name || ""}"${plan.mode === "night" ? ", at night" : ", by day"}`;
  if (b.environment) await step(`lighting environment "${b.environment}"`, () => run.set_lighting_environment({ search: b.environment, look: skyLook, ...(outdoor ? { background: true } : {}) }));
  s.environment = { ...s.environment, mode: plan.mode };
  return { scene: s, log };
}
