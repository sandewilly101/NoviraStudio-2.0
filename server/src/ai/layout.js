// Layout solver: turns an event plan (what the AI decides) into exact object
// positions inside the venue (what code decides). Units are metres; the floor
// is the X/Z plane, the stage sits against the wall at minZ.

export const DEFAULT_PLAN = {
  eventName: "Gala Dinner",
  eventType: "gala",
  guests: 120,
  layout: "banquet", // banquet | theater | feast | cocktail
  seatsPerTable: 8,
  walkway: 1.5,
  include: { stage: true, ledScreen: true, lectern: true, speakers: true, bar: true, danceFloor: false },
  stage: { width: 0, depth: 0, height: 0.6 }, // 0 = auto from room size
  colors: { linen: "#F7F3E8", chair: "#C9A227", accent: "#C9A227", stage: "#1B2538", uplight: "#3FA2FF" },
  screenText: "",
  mode: "day",
};

const MIN_WALKWAY = 0.9;
const DECK = 1.219; // 4 ft stage deck module

const defined = (o = {}) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));

export function mergePlan(base, patch = {}) {
  const out = { ...base, ...defined(patch) };
  out.include = { ...base.include, ...defined(patch.include) };
  out.stage = { ...base.stage, ...defined(patch.stage) };
  out.colors = { ...base.colors, ...defined(patch.colors) };
  out.guests = clamp(Math.round(Number(out.guests) || base.guests), 1, 5000);
  out.seatsPerTable = [6, 8, 10, 12].includes(Number(out.seatsPerTable)) ? Number(out.seatsPerTable) : 8;
  out.walkway = clamp(Number(out.walkway) || 1.5, MIN_WALKWAY, 4);
  if (!["banquet", "theater", "feast", "cocktail"].includes(out.layout)) out.layout = "banquet";
  return out;
}

// room = { minX, maxX, minZ, maxZ, floorY }
// In a long, shallow room the stage goes on a short wall and the event runs
// lengthways, as planners do — instead of stringing guests along the long wall.
// The plan is solved in a turned copy of the room and turned back (90° about y).
export function solveLayout(planInput, room) {
  const W = room.maxX - room.minX, D = room.maxZ - room.minZ;
  if (W <= D * 1.4) return solveFacing(planInput, room);
  const turned = { ...room, minX: -room.maxZ, maxX: -room.minZ, minZ: room.minX, maxZ: room.maxX };
  const out = solveFacing(planInput, turned);
  out.objects = out.objects.map((o) => ({ ...o, position: [round(o.position[2], 1000), o.position[1], round(-o.position[0], 1000)], rotation: [o.rotation?.[0] || 0, (o.rotation?.[1] || 0) + Math.PI / 2, o.rotation?.[2] || 0] }));
  return out;
}

function solveFacing(planInput, room) {
  const plan = mergePlan(DEFAULT_PLAN, planInput);
  const objects = [];
  const checks = [];
  let n = 0;
  const id = (p) => `${p}_${++n}`;
  const W = room.maxX - room.minX, D = room.maxZ - room.minZ, y0 = room.floorY ?? 0;
  const cx = (room.minX + room.maxX) / 2;
  const wallGap = 0.6;
  const c = plan.colors;

  // --- stage zone ---
  let frontZ = room.minZ + wallGap;
  if (plan.include.stage) {
    // a real stage is built from 4 ft (1.219 m) decks
    const deck = (v) => Math.max(2, Math.round(v / DECK)) * DECK;
    const sw = round(deck(plan.stage.width || Math.min(12, Math.max(4, W * 0.42))), 1000);
    const sd = round(deck(plan.stage.depth || Math.min(5, Math.max(2.5, D * 0.14))), 1000);
    const sh = plan.stage.height || 0.61;
    // a ground-supported LED wall stands behind the stage: leave room for its frame and ballast
    const ledBehind = plan.include.ledScreen ? 1.3 : 0;
    const sz = room.minZ + wallGap + ledBehind + sd / 2;
    objects.push({ id: id("stage"), type: "stage", name: "Stage", position: [cx, y0, sz], rotation: [0, 0, 0], size: [sw, sh, sd], color: c.stage, material: "matte", spec: { rails: false, stairs: true } });
    if (plan.include.ledScreen) {
      // built from 0.5 m cabinets, 16:9, bottom edge 0.3 m above the stage, top below the ceiling
      const bottom = sh + 0.3;
      const maxH = Math.max(1, (room.height ?? 8) - 0.5 - bottom);
      let lw = Math.round(Math.min(sw * 0.8, W - 2) / 0.5) * 0.5, lh = Math.round((lw * 9) / 16 / 0.5) * 0.5;
      if (lh > maxH) { lh = Math.floor(maxH / 0.5) * 0.5; lw = Math.round((lh * 16) / 9 / 0.5) * 0.5; }
      objects.push({ id: id("led"), type: "led_screen", name: "LED wall", position: [cx, y0 + bottom, sz - sd / 2 - 0.25], rotation: [0, 0, 0], size: [lw, lh, 0.1], color: "#0E2A4A", material: "gloss",
        variant: "p3-9-indoor", spec: { frame: "ground-support", curveDeg: 0 },
        text: { content: plan.screenText || plan.eventName, color: "#FFFFFF", sub: "", accent: c.accent } });
    }
    if (plan.include.lectern) objects.push({ id: id("lectern"), type: "lectern", name: "Lectern", position: [cx + sw * 0.3, y0 + sh, sz], rotation: [0, 0, 0], size: [0.6, 1.15, 0.5], color: "#2B3A55", material: "wood" });
    if (plan.include.speakers) {
      for (const s of [-1, 1]) objects.push({ id: id("speaker"), type: "speaker", name: "Speaker", position: [cx + s * (sw / 2 + 0.7), y0, sz], rotation: [0, 0, 0], size: [0.6, 2.2, 0.6], color: "#20242C", material: "matte" });
    }
    frontZ = sz + sd / 2;
  }

  // --- bar along the left wall ---
  let leftX = room.minX + wallGap;
  if (plan.include.bar) {
    const len = round(Math.min(8, Math.max(3, D * 0.35)));
    objects.push({ id: id("bar"), type: "bar", name: "Bar counter", position: [room.minX + wallGap + 0.35, y0, (frontZ + room.maxZ) / 2], rotation: [0, 0, 0], size: [0.7, 1.1, len], color: "#3B2E25", material: "wood" });
    leftX = room.minX + wallGap + 0.7 + 1.8;
  }

  // --- dance floor in front of the stage (sized to the room, shallow rooms get a smaller one) ---
  let startZ = frontZ + 1.5;
  const blocked = []; // areas tables must keep clear of
  if (plan.include.danceFloor) {
    const ds = round(Math.max(3, Math.min(7, W * 0.22, (room.maxZ - frontZ) * 0.4)));
    const dz = frontZ + 1 + ds / 2;
    objects.push({ id: id("dance"), type: "dance_floor", name: "Dance floor", position: [cx, y0, dz], rotation: [0, 0, 0], size: [ds, 0.03, ds], color: "#E9E4DA", material: "gloss" });
    blocked.push({ x0: cx - ds / 2 - 1, x1: cx + ds / 2 + 1, z0: dz - ds / 2 - 1, z1: dz + ds / 2 + 1 });
    startZ = frontZ + 1 + ds + 1.5;
  }

  const back = room.maxZ - wallGap - 0.4, right = room.maxX - wallGap;
  const stage = objects.find((o) => o.type === "stage");
  if (stage) {
    // the stage, its speakers and the LED frame behind it, plus a clear strip in front
    const half = stage.size[0] / 2 + (plan.include.speakers ? 1.3 : 0.6);
    blocked.push({ x0: cx - half, x1: cx + half, z0: room.minZ, z1: frontZ + 1.5 });
  }
  // banquet, feast and cocktail tables wrap around the dance floor and, in a wide
  // room, carry on beside the stage — like real ballroom floor plans
  const around = { x0: leftX, x1: right, z0: room.minZ + wallGap, z1: back, blocked, front: frontZ + 1.2 };
  const behind = { x0: leftX, x1: right, z0: Math.min(startZ, back - 1), z1: back };
  let seats = 0, walkwayUsed = plan.walkway, extra = {};

  if (plan.layout === "banquet") ({ seats, walkwayUsed, extra } = banquet(plan, around, y0, objects, id));
  else if (plan.layout === "feast") ({ seats, walkwayUsed, extra } = feast(plan, around, y0, objects, id));
  else if (plan.layout === "theater") ({ seats, walkwayUsed, extra } = theater(plan, behind, y0, objects, id));
  else ({ seats, walkwayUsed, extra } = cocktail(plan, around, y0, objects, id));

  // --- checks, in plain words ---
  checks.push(walkwayUsed >= 1.5
    ? { level: "ok", text: `Walkways ≥ ${walkwayUsed.toFixed(1)} m` }
    : { level: "warn", text: `Walkways narrowed to ${walkwayUsed.toFixed(1)} m to fit guests` });
  if (plan.layout === "cocktail") checks.push({ level: "ok", text: `Standing capacity ≈ ${seats}` });
  else if (seats >= plan.guests) checks.push({ level: "ok", text: `Capacity fits: ${seats} seats for ${plan.guests} guests` });
  else checks.push({ level: "warn", text: `Only ${seats} of ${plan.guests} guests fit in this room` });
  checks.push({ level: "ok", text: "Clear zone kept along every wall" });

  return { plan, objects, checks, stats: { seats, ...extra } };
}

function banquet(plan, r, y0, objects, id) {
  const D = 1.8, chairR = D / 2 + 0.4, foot = D + 1.1;
  const tablesNeeded = Math.ceil(plan.guests / plan.seatsPerTable);
  let walk = plan.walkway, cells;
  for (;;) {
    cells = freeCells(r, foot, foot + walk);
    if (cells.length >= tablesNeeded || walk <= MIN_WALKWAY) break;
    walk = Math.max(MIN_WALKWAY, round(walk - 0.1));
  }
  const total = Math.min(tablesNeeded, cells.length);
  let placed = 0, seats = 0;
  for (const [x, z] of cells.slice(0, total)) {
    {
      placed++;
      const tid = id("table");
      objects.push({ id: tid, type: "round_table", name: `Table ${placed}`, position: [x, y0, z], rotation: [0, 0, 0], size: [D, 0.76, D], color: plan.colors.linen, material: "fabric", label: `T${placed}` });
      objects.push({ id: id("centre"), type: "centrepiece", name: `Candelabra T${placed}`, position: [x, y0 + 0.76, z], rotation: [0, 0, 0], size: [0.32, 0.75, 0.32], color: plan.colors.accent, material: "metal", group: tid });
      for (let s = 0; s < plan.seatsPerTable; s++) {
        const a = (s / plan.seatsPerTable) * Math.PI * 2;
        objects.push({ id: id("chair"), type: "chair", name: "Chair", position: [x + Math.sin(a) * chairR, y0, z + Math.cos(a) * chairR], rotation: [0, a, 0], size: [0.45, 0.92, 0.45], color: plan.colors.chair, material: "metal", group: tid });
        seats++;
      }
    }
  }
  return { seats, walkwayUsed: walk, extra: { tables: placed } };
}

// Rows of long tables; each row is split into runs of at most ~10 m with 1.8 m
// cross-aisles, like real banquet runs, and runs stop short of anything in the way.
function feast(plan, r, y0, objects, id) {
  const tw = 0.9, seatPitch = 0.65, foot = tw + 1.2, maxSeg = 10, cross = 1.8, piece = 2.4;
  const cx = (r.x0 + r.x1) / 2;
  const runsAt = (z) => {
    let free = [[r.x0 + 0.5, r.x1 - 0.5]];
    for (const b of r.blocked || []) {
      if (z + foot / 2 <= b.z0 || z - foot / 2 >= b.z1) continue;
      free = free.flatMap(([u, v]) => [[u, Math.min(v, b.x0)], [Math.max(u, b.x1), v]]).filter(([u, v]) => v - u >= piece);
    }
    return free.flatMap(([u, v]) => {
      const L = v - u, segs = Math.max(1, Math.ceil((L + cross) / (maxSeg + cross))), len = (L - cross * (segs - 1)) / segs;
      return len < piece ? [] : Array.from({ length: segs }, (_, k) => ({ left: u + k * (len + cross), len, z }));
    });
  };
  const layout = (w) => {
    const runs = [];
    for (let z = r.z0 + foot / 2; z + foot / 2 <= r.z1 + 1e-6; z += foot + w) runs.push(...runsAt(z));
    return runs;
  };
  const cap = (runs) => runs.reduce((n, g) => n + Math.floor(g.len / seatPitch) * 2, 0);
  let walk = plan.walkway, runs;
  for (;;) {
    runs = layout(walk);
    if (cap(runs) >= plan.guests || walk <= MIN_WALKWAY) break;
    walk = Math.max(MIN_WALKWAY, round(walk - 0.1));
  }
  // nearest the stage first, then outward from the centre; beside the stage last
  const front = r.front ?? r.z0;
  const pref = (g) => Math.abs(g.z - front) + (g.z < front ? 6 : 0) + Math.abs(g.left + g.len / 2 - cx) * 0.05;
  runs.sort((a, b) => pref(a) - pref(b));
  let seats = 0, tables = 0;
  for (const { left, len, z } of runs) {
    if (seats >= plan.guests) break;
    tables++;
    // a run is several real 2.4 m banquet tables placed end to end
    const pieces = Math.max(1, Math.round(len / piece)), pieceLen = len / pieces;
    let tid = null;
    for (let k = 0; k < pieces; k++) {
      const pid = id("ltable"); tid = tid || pid;
      objects.push({ id: pid, type: "long_table", name: `Long table ${tables}${pieces > 1 ? `.${k + 1}` : ""}`, position: [round(left + pieceLen * (k + 0.5), 1000), y0, round(z, 1000)], rotation: [0, 0, 0], size: [round(pieceLen - 0.02, 1000), 0.76, tw], color: plan.colors.linen, material: "wood", label: `T${tables}`, group: `run_${tables}` });
    }
    const perSide = Math.floor(len / seatPitch), pad = (len - perSide * seatPitch) / 2;
    for (let k = 0; k < perSide && seats < plan.guests; k++) {
      const x = left + pad + seatPitch / 2 + k * seatPitch;
      for (const side of [-1, 1]) {
        if (seats >= plan.guests) break;
        objects.push({ id: id("chair"), type: "chair", name: "Chair", position: [x, y0, z + side * (tw / 2 + 0.35)], rotation: [0, side > 0 ? 0 : Math.PI, 0], size: [0.45, 0.92, 0.45], color: plan.colors.chair, material: "metal", group: tid });
        seats++;
      }
      if (k % 4 === 1) objects.push({ id: id("centre"), type: "centrepiece", name: "Candelabra", position: [x, y0 + 0.76, z], rotation: [0, 0, 0], size: [0.3, 0.7, 0.3], color: plan.colors.accent, material: "metal", group: tid });
    }
  }
  return { seats, walkwayUsed: walk, extra: { tables } };
}

function theater(plan, r, y0, objects, id) {
  const cw = 0.55, rowPitch = 0.95, aisle = Math.max(1.5, plan.walkway);
  const width = r.x1 - r.x0, half = (width - aisle) / 2;
  const perSide = Math.max(1, Math.floor(half / cw));
  const maxRows = Math.max(0, Math.floor((r.z1 - r.z0 - 0.5) / rowPitch) + 1); // never past the back wall
  const rows = Math.min(maxRows, Math.ceil(plan.guests / (perSide * 2)));
  const cx = (r.x0 + r.x1) / 2;
  let seats = 0;
  for (let i = 0; i < rows; i++) {
    const z = r.z0 + 0.5 + i * rowPitch;
    for (const side of [-1, 1]) for (let k = 0; k < perSide && seats < plan.guests; k++) {
      const x = cx + side * (aisle / 2 + cw / 2 + k * cw);
      objects.push({ id: id("chair"), type: "chair", name: "Chair", position: [x, y0, z], rotation: [0, 0, 0], size: [0.48, 0.9, 0.48], color: plan.colors.chair, material: "fabric", group: `row_${i + 1}` });
      seats++;
    }
  }
  return { seats, walkwayUsed: aisle, extra: { rows } };
}

function cocktail(plan, r, y0, objects, id) {
  const needed = Math.ceil(plan.guests / 6);
  // keep a 1.6 m strip along the right wall for the lounge sofas
  const cells = freeCells({ ...r, x1: r.x1 - 1.6 }, 1.2, 3.2);
  let placed = 0;
  for (const [x, z] of cells.slice(0, needed)) {
    placed++;
    objects.push({ id: id("htable"), type: "cocktail_table", name: `High table ${placed}`, position: [x, y0, z], rotation: [0, 0, 0], size: [0.7, 1.1, 0.7], color: plan.colors.linen, material: "fabric" });
  }
  // lounge sofas along the right wall
  const sofas = Math.max(2, Math.min(6, Math.floor((r.z1 - r.z0) / 4)));
  for (let i = 0; i < sofas; i++) {
    const z = r.z0 + 1.5 + i * ((r.z1 - r.z0 - 3) / Math.max(1, sofas - 1));
    objects.push({ id: id("sofa"), type: "sofa", name: `Lounge sofa ${i + 1}`, position: [r.x1 - 0.5, y0, z], rotation: [0, -Math.PI / 2, 0], size: [2.2, 0.85, 0.9], color: "#2F4470", material: "fabric" });
  }
  return { seats: placed * 6 + sofas * 3, walkwayUsed: 3.2 - 1.2, extra: { tables: placed } };
}

// Table positions whose whole footprint is inside the region and clear of
// blocked areas, best first. Rows are staggered (each row shifted half a pitch),
// as real banquet plans are: same clearance between tables, more tables.
function freeCells(r, foot, pitch) {
  const half = foot / 2, cx = (r.x0 + r.x1) / 2, rowStep = pitch * 0.87;
  // the grid's phase decides what squeezes past the stage and dance floor: try a few, keep the fullest
  const grid = (dx, dz) => {
    const cells = [];
    let row = 0;
    for (let z = r.z0 + half + dz; z + half <= r.z1 + 1e-6; z += rowStep, row++) {
      for (let x = r.x0 + half + dx + (row % 2 ? pitch / 2 : 0); x + half <= r.x1 + 1e-6; x += pitch) {
        const hit = (r.blocked || []).some((b) => x + half > b.x0 && x - half < b.x1 && z + half > b.z0 && z - half < b.z1);
        if (!hit) cells.push([round(x, 1000), round(z, 1000)]);
      }
    }
    return cells;
  };
  let out = [];
  for (const fx of [0, 0.25, 0.5, 0.75]) for (const fz of [0, 0.25, 0.5, 0.75]) {
    const cells = grid(fx * pitch, fz * rowStep);
    if (cells.length > out.length) out = cells;
  }
  // fill outward from the front-centre as a block shaped like the room; places
  // beside the stage (behind its front edge) are used last
  const W = Math.max(1, r.x1 - r.x0), D = Math.max(1, r.z1 - r.z0), front = r.front ?? r.z0;
  const reach = ([x, z]) => Math.max(Math.abs(x - cx) / W * 2, Math.abs(z - front) / D) + (z < front ? 0.5 : 0);
  return out.sort((a, b) => reach(a) - reach(b) || a[1] - b[1] || Math.abs(a[0] - cx) - Math.abs(b[0] - cx));
}

const round = (v, k = 10) => Math.round(v * k) / k;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Room from a venue analysis, falling back to a 30 x 30 m hall.
/** An open-air site: room for the guests, the stage and walkways all round (no walls, no ceiling). */
export function outdoorSite(guests = 100) {
  const half = Math.round(Math.max(15, Math.min(45, (Math.sqrt(guests * 3.2) + 16) / 2)));
  return { minX: -half, maxX: half, minZ: -half, maxZ: half, floorY: 0, height: 12, outdoor: true };
}

export function roomFromVenue(analysis) {
  const b = analysis?.floor;
  if (b && b.maxX > b.minX && b.maxZ > b.minZ) return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, floorY: b.floorY ?? 0, height: analysis.size?.[1] || 8 };
  return { minX: -15, maxX: 15, minZ: -15, maxZ: 15, floorY: 0 };
}
