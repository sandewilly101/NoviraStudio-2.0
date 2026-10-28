// Spatial reasoning for the AI agent, done in code rather than by the model:
// footprints, "in front of / behind / beside / on / above" placement, truss
// rigging points and hanging, and keeping things inside the room's walls.
// Conventions: metres, y up, floor at y = room.floorY, an object's position is
// the centre of its footprint at its base; rotation[1] is a turn about y;
// the stage sits at the minZ wall and the audience faces -z (the front of a
// stage, screen or sign is its +z side).

const r3 = (v) => Math.round(v * 1000) / 1000;

/** World footprint and height range of an object. */
export function bounds(o) {
  const a = o.rotation?.[1] || 0, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hx = (o.size[0] * c + o.size[2] * s) / 2, hz = (o.size[0] * s + o.size[2] * c) / 2;
  return { x0: o.position[0] - hx, x1: o.position[0] + hx, z0: o.position[2] - hz, z1: o.position[2] + hz, y0: o.position[1], y1: o.position[1] + o.size[1] };
}

/** Where an object's front (+z), back and sides point, in world space. */
function axes(o) {
  const a = o.rotation?.[1] || 0;
  return { front: [Math.sin(a), Math.cos(a)], right: [Math.cos(a), -Math.sin(a)] };
}

// ---------- trusses and what hangs from them ----------
const TRUSS = { // section width / height / chord, metres (see the app's truss systems)
  "f34-square": [0.29, 0.29, 0.05], "f44-square": [0.29, 0.29, 0.05], "h40v-square": [0.39, 0.39, 0.05], "f33-tri": [0.29, 0.29, 0.05], "ladder-290": [0.29, 0.06, 0.048],
};
export function rigSegments(t) {
  const [sw, sh, chord] = TRUSS[t.spec?.system] || TRUSS["f34-square"];
  const [W, H, D] = t.size, hs = Math.max(sw, sh) / 2, yc = Math.max(hs * 3, H - hs);
  const under = yc - (t.spec?.system === "ladder-290" ? 0 : sh / 2) - chord / 2;
  const a = W / 2 - hs, b = Math.max(hs * 2, D / 2 - hs), local = [];
  switch (t.variant || "goalpost") {
    case "arch": return [];
    case "straight": local.push([-W / 2, 0, W / 2, 0]); break;
    case "square": local.push([-a, -b, a, -b], [a, -b, a, b], [a, b, -a, b], [-a, b, -a, -b]); break;
    case "u-shape": local.push([-a, b, -a, -b], [-a, -b, a, -b], [a, -b, a, b]); break;
    case "circle": {
      const r = Math.max(1, Math.min(W, D) / 2 - hs), n = 48;
      for (let i = 0; i < n; i++) { const p = (i / n) * Math.PI * 2, q = ((i + 1) / n) * Math.PI * 2; local.push([Math.cos(p) * r, Math.sin(p) * r, Math.cos(q) * r, Math.sin(q) * r]); }
      break;
    }
    default: local.push([-a + hs, 0, a - hs, 0]);
  }
  const yaw = t.rotation?.[1] || 0, c = Math.cos(yaw), s = Math.sin(yaw);
  const w = (x, z) => ({ x: t.position[0] + x * c + z * s, y: t.position[1] + under, z: t.position[2] - x * s + z * c });
  return local.map(([x0, z0, x1, z1]) => [w(x0, z0), w(x1, z1)]);
}
function nearestOn([a, b], x, z) {
  const dx = b.x - a.x, dz = b.z - a.z, len = dx * dx + dz * dz, k = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len)) : 0;
  return { x: a.x + dx * k, y: a.y, z: a.z + dz * k };
}
export function nearestRigPoint(objects, x, z, onlyId) {
  let best = null, d = Infinity;
  for (const t of objects) {
    if (t.type !== "truss" || (onlyId && t.id !== onlyId)) continue;
    for (const seg of rigSegments(t)) { const p = nearestOn(seg, x, z), e = Math.hypot(p.x - x, p.z - z); if (e < d) { d = e; best = { ...p, truss: t }; } }
  }
  return best;
}
const MOVING = new Set(["moving-head-spot", "moving-head-wash", "beam"]), NO_YOKE = new Set(["strip-batten", "uplighter", "floor-wash"]);
const lightDrop = (o) => (NO_YOKE.has(o.variant) ? 0 : 0.24) + (MOVING.has(o.variant) ? 0.16 : 0.03) + 0.08;
const STAND_LIGHTS = new Set(["follow-spot"]), FLOOR_LIGHTS = new Set(["strip-batten", "uplighter", "floor-wash"]);
export const lightMount = (o) => o.spec?.mount || (STAND_LIGHTS.has(o.variant) ? "stand" : FLOOR_LIGHTS.has(o.variant) ? "floor" : "truss");

/**
 * Hang `o` from a truss (the given one, or the nearest): lights clamp under
 * the bottom chord; LED walls and banners hang with their top 0.25 m below it
 * (shackles and spansets), centred under the nearest point of the truss.
 */
export function hangFrom(o, objects, trussId) {
  const p = nearestRigPoint(objects, o.position[0], o.position[2], trussId);
  if (!p) return null;
  if (o.type === "light") return { ...o, position: [r3(p.x), r3(p.y - lightDrop(o)), r3(p.z)], spec: { ...o.spec, mount: "truss" } };
  const drop = 0.25, y = p.y - drop - o.size[1];
  const out = { ...o, position: [r3(p.x), r3(Math.max(0, y)), r3(p.z)] };
  if (o.type === "led_screen") out.spec = { ...o.spec, frame: "flown" };
  return out;
}

// ---------- placing one object relative to another ----------
/**
 * Position for `o` relative to `ref`: in_front_of, behind, left_of, right_of
 * (from the reference's own point of view, i.e. as its audience sees it),
 * on (on its top surface), above (clear over it), centered_on, hang_from.
 */
export function placeRelative(o, ref, relation, gap = 0.3, objects = []) {
  // hang from the point of that truss nearest to where the object already is
  if (relation === "hang_from") return hangFrom(o, objects, ref.id) || o;
  const b = bounds(ref), { front, right } = axes(ref), [rx, , rz] = ref.position;
  const halfD = (ref.size[2] + o.size[2]) / 2 + gap, halfW = (ref.size[0] + o.size[0]) / 2 + gap;
  let x = rx, z = rz, y = o.position[1] ?? 0;
  switch (relation) {
    case "in_front_of": x += front[0] * halfD; z += front[1] * halfD; break;
    case "behind": x -= front[0] * halfD; z -= front[1] * halfD; break;
    case "right_of": x += right[0] * halfW; z += right[1] * halfW; break; // the audience's right, facing the object's front
    case "left_of": x -= right[0] * halfW; z -= right[1] * halfW; break;
    case "on": y = b.y1; break;
    case "above": y = b.y1 + gap; break;
    default: break; // centered_on
  }
  return { ...o, position: [r3(x), r3(y), r3(z)], rotation: relation === "on" || relation === "centered_on" || relation === "above" ? (o.rotation || ref.rotation) : (o.rotation || [0, ref.rotation?.[1] || 0, 0]) };
}

/** Things that may share floor space with others (they lie flat or are tiny). */
// trusses, LED walls, stages and tents span or carry other things, so they are never nudged;
// things you can walk over or that sit up in the rig are not obstacles
const FIXED = new Set(["dance_floor", "centrepiece", "chair", "light", "truss", "led_screen", "stage", "tent"]);
const PASSABLE = new Set(["dance_floor", "centrepiece", "light", "truss"]);
const overlaps = (a, b) => a.x0 < b.x1 - 0.02 && a.x1 > b.x0 + 0.02 && a.z0 < b.z1 - 0.02 && a.z1 > b.z0 + 0.02 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * Step a newly placed object sideways (away from `from`, else along x) until it
 * no longer collides with anything standing on the floor — like a person
 * setting a banner down next to a speaker, not inside it.
 */
export function avoidOverlap(o, objects, from) {
  if (FIXED.has(o.type) || o.position[1] > 2.5) return o;
  const others = objects.filter((x) => x.id !== o.id && !PASSABLE.has(x.type) && x.group !== o.id && x.position[1] < 2.5).map(bounds);
  const hit = (p) => others.some((b) => overlaps(bounds(p), b));
  if (!hit(o)) return o;
  let dx = from ? o.position[0] - from[0] : 1, dz = from ? o.position[2] - from[2] : 0;
  const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
  for (let k = 1; k <= 40; k++) for (const s of [1, -1]) {
    const p = { ...o, position: [r3(o.position[0] + dx * 0.15 * k * s), o.position[1], r3(o.position[2] + dz * 0.15 * k * s)] };
    if (!hit(p)) return p;
  }
  return o;
}

/** Keep an object's footprint inside the room (walls are solid). */
export function keepInside(o, room) {
  if (!room) return o;
  const b = bounds(o), dx = Math.max(0, room.minX - b.x0) - Math.max(0, b.x1 - room.maxX), dz = Math.max(0, room.minZ - b.z0) - Math.max(0, b.z1 - room.maxZ);
  if (!dx && !dz) return o;
  return { ...o, position: [r3(o.position[0] + dx), o.position[1], r3(o.position[2] + dz)] };
}

/** Named spots in the room. */
// Named spots relative to the stage, whichever wall it stands on (stageYaw = the
// stage's turn): back = behind the stage, front = the far end, left / right as
// the audience sees the stage.
export function roomSpot(room, where, stageYaw = 0) {
  const cx = (room.minX + room.maxX) / 2, cz = (room.minZ + room.maxZ) / 2, hw = (room.maxX - room.minX) / 2, hd = (room.maxZ - room.minZ) / 2;
  const f = [Math.round(Math.sin(stageYaw)), Math.round(Math.cos(stageYaw))], r = [Math.round(Math.cos(stageYaw)), -Math.round(Math.sin(stageYaw))];
  const reach = (d) => Math.abs(d[0]) * hw + Math.abs(d[1]) * hd; // centre to the wall that way
  const at = (...parts) => parts.reduce(([x, z], [d, inset]) => [x + d[0] * (reach(d) - inset), z + d[1] * (reach(d) - inset)], [cx, cz]);
  const neg = (d) => [-d[0], -d[1]];
  return ({
    center: [cx, cz], back_wall: at([neg(f), 1]), front_wall: at([f, 1]), left_wall: at([neg(r), 1]), right_wall: at([r, 1]),
    back_left_corner: at([neg(f), 1.5], [neg(r), 1.5]), back_right_corner: at([neg(f), 1.5], [r, 1.5]), front_left_corner: at([f, 1.5], [neg(r), 1.5]), front_right_corner: at([f, 1.5], [r, 1.5]), entrance: at([f, 1.5]),
  })[where] || [cx, cz];
}

// Screen arrangements laid out from the stage (mirrors app/src/lib/screens.ts):
// LED walls in whole 0.5 m cabinets on ground support, under the ceiling, facing the guests.
export const SCREEN_LAYOUTS = ["center", "center-sides", "triptych", "ultrawide", "columns", "curved"];
export function screenRig(stage, layout, ceiling = 6, content) {
  const cab = (v) => Math.max(0.5, Math.round(v / 0.5) * 0.5);
  const [W, h, D] = stage.size, yaw = stage.rotation?.[1] || 0;
  const f = [Math.sin(yaw), Math.cos(yaw)], rr = [Math.cos(yaw), -Math.sin(yaw)];
  const [cx, , cz] = stage.position, back = (k, side = 0) => [r3(cx - f[0] * (D / 2 + k) + rr[0] * side), r3(cz - f[1] * (D / 2 + k) + rr[1] * side)];
  const bottom = h + 0.3, room = (b) => Math.max(1, ceiling - 0.5 - b);
  const wall = (name, w, ht, side, y, turn = 0, extra = {}, depth = 0.25) => {
    const [x, z] = back(depth, side);
    return { type: "led_screen", name, position: [x, r3(y), z], rotation: [0, yaw + turn, 0], size: [w, ht, 0.1], color: "#0E2A4A", variant: "p3-9-indoor", spec: { frame: "ground-support", curveDeg: 0 }, group: "screens", userAdded: true, ...(content ? { content } : {}), ...extra };
  };
  const main = () => { let w = cab(W * 0.8), ht = cab((w * 9) / 16); if (ht > room(bottom)) { ht = cab(room(bottom) - 0.25); w = cab((ht * 16) / 9); } return [w, ht]; };
  switch (layout) {
    case "center-sides": { const [w, ht] = main(), ws = cab(Math.max(2, W * 0.3)), hs = cab((ws * 9) / 16), off = W / 2 + ws / 2 + 0.7; return [wall("LED wall", w, ht, 0, bottom), wall("Side screen left", ws, hs, -off, 1.6, 0.26, {}, -D * 0.35), wall("Side screen right", ws, hs, off, 1.6, -0.26, {}, -D * 0.35)]; }
    case "triptych": { const w3 = cab((W * 1.05) / 3), ht = Math.min(cab((w3 * 9) / 16), cab(room(bottom))), gap = 0.6; return [wall("LED wall left", w3, ht, -(w3 + gap), bottom, 0.21, {}, 0.1), wall("LED wall centre", w3, ht, 0, bottom), wall("LED wall right", w3, ht, w3 + gap, bottom, -0.21, {}, 0.1)]; }
    case "ultrawide": { const w = cab(W * 1.05), ht = Math.min(cab((w * 9) / 32), cab(room(bottom))); return [wall("Ultrawide LED wall", w, ht, 0, bottom)]; }
    case "columns": { const n = 5, ht = cab(Math.min(4.5, room(h + 0.1))), span = W * 0.95; return Array.from({ length: n }, (_, i) => wall(`LED column ${i + 1}`, 1, ht, -span / 2 + (i * span) / (n - 1), h + 0.1)); }
    case "curved": { const w = cab(W * 0.95), ht = Math.min(cab((w * 9) / 21), cab(room(bottom))); return [wall("Curved LED wall", w, ht, 0, bottom, 0, { spec: { frame: "ground-support", curveDeg: 30 } }, 0.6)]; }
    default: { const [w, ht] = main(); return [wall("LED wall", w, ht, 0, bottom)]; }
  }
}
