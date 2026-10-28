// Where a thing can really stand. Mirrors app/src/lib/placement.ts.
//  · shapes are real: round tables are circles, everything else its turned footprint;
//  · things keep the room a real setup needs: a walkway behind seated tables and
//    chairs, service space at a bar, a margin at stage and screen edges; nothing
//    stands on the dance floor but floor lights;
//  · "on" means on a surface made to hold things (a table, the bar, the stage, a
//    plinth); anything else set on a chair, a plant or a speaker goes down to the
//    floor beside it;
//  · a thing that lands in another is moved to the nearest free spot, searching
//    outwards in rings (preferring the side it came from); if the room has no
//    space for it there, it isn't placed at all rather than placed inside something.

const ROUND = new Set(["round_table", "cocktail_table"]);
const SEATING = new Set(["chair", "round_table", "long_table", "cocktail_table", "sofa"]);
// surfaces made to carry other things
export const SURFACES = new Set(["round_table", "long_table", "cocktail_table", "bar", "stage", "booth", "lectern"]);
// never in the way: up in the rig, on a table, or flat
const IGNORE = new Set(["light", "truss", "centrepiece", "chandelier", "ceiling_drape", "tent"]);
const ON_DANCE_FLOOR = new Set(["light", "dance_floor"]);

const yawOf = (o) => o.rotation?.[1] || 0;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** The footprint: a circle, or a turned box (half sizes and the turn). */
function shape(o) {
  const [x, , z] = o.position;
  return ROUND.has(o.type) ? { round: true, x, z, r: o.size[0] / 2 } : { round: false, x, z, hx: o.size[0] / 2, hz: o.size[2] / 2, a: yawOf(o) };
}

/** How far apart two footprints are (negative: how deep they overlap); exact for circles, a close bound for boxes. */
function gap(a, b) {
  if (a.round && b.round) return Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
  if (a.round !== b.round) {
    const c = a.round ? a : b, q = a.round ? b : a;
    // the circle's centre in the box's own frame, then its distance to the box
    const dx = c.x - q.x, dz = c.z - q.z, cs = Math.cos(q.a), sn = Math.sin(q.a);
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const ox = Math.abs(lx) - q.hx, oz = Math.abs(lz) - q.hz;
    const out = Math.hypot(Math.max(0, ox), Math.max(0, oz)), inside = Math.min(0, Math.max(ox, oz));
    return out + inside - c.r;
  }
  // two boxes: the widest separation along any of their four axes
  let best = -Infinity;
  for (const s of [a, b]) for (const ang of [s.a, s.a + Math.PI / 2]) {
    const ux = Math.cos(ang), uz = -Math.sin(ang);
    const half = (t) => t.hx * Math.abs(Math.cos(t.a) * ux - Math.sin(t.a) * uz) + t.hz * Math.abs(Math.sin(t.a) * ux + Math.cos(t.a) * uz);
    best = Math.max(best, Math.abs((b.x - a.x) * ux + (b.z - a.z) * uz) - half(a) - half(b));
  }
  return best;
}

/** The room `o` needs from `b`, in metres. */
function room(o, b) {
  if (b.type === "dance_floor") return 0.25;
  if (b.type === "bar" || o.type === "bar") return 0.8; // the bartenders' side and the queue
  if (b.type === "stage" || b.type === "led_screen") return 0.3;
  if (SEATING.has(b.type) && !SEATING.has(o.type)) return 0.45; // a walkway behind the guests
  return 0.12;
}

const level = (o) => [o.position[1], o.position[1] + o.size[1]];
/** What `o` is in the way of, given everything else in the room. */
export function blockers(o, objects) {
  const [y0, y1] = level(o), me = shape(o);
  return objects.filter((b) => {
    if (b.id === o.id || b.group === o.id || o.group === b.id || IGNORE.has(b.type) || IGNORE.has(o.type)) return false;
    if (b.type === "dance_floor") return y0 < 0.15 && !ON_DANCE_FLOOR.has(o.type) && gap(me, shape(b)) < 0;
    const [b0, b1] = level(b);
    if (!(y0 < b1 - 0.03 && y1 > b0 + 0.03)) return false; // one is above the other
    return gap(me, shape(b)) < (o.userPlaced ? 0.02 : room(o, b));
  });
}

/** What is under `o`, if it isn't on the floor: the surface it rests on, if that's a real one. */
export function supportOf(o, objects) {
  const y = o.position[1];
  if (y < 0.05 || y > 2.5) return null;
  return objects.find((b) => b.id !== o.id && Math.abs(b.position[1] + b.size[1] - y) < 0.08 && gap({ round: false, x: o.position[0], z: o.position[2], hx: 0.001, hz: 0.001, a: 0 }, shape(b)) <= 0) || null;
}

/**
 * `o` where it can really be: resting on a real surface or on the floor, clear of
 * everything, inside the walls. Null if there is no room for it near where it was asked to go.
 */
export function placeFree(o, objects, room_, { from, floorY = 0, maxRadius = 8 } = {}) {
  if (IGNORE.has(o.type) || o.position[1] > 2.5) return o;
  // on something: only a surface made for it, and within its edges
  const under = supportOf(o, objects);
  if (o.position[1] >= 0.05 && (!under || !SURFACES.has(under.type))) {
    o = { ...o, position: [o.position[0], floorY, o.position[2]] };
    if (under) from = under.position; // set down beside what it was put on
  } else if (under) {
    // kept within the table's edge
    const s = shape(under);
    if (s.round) {
      const d = Math.hypot(o.position[0] - s.x, o.position[2] - s.z), lim = Math.max(0, s.r - Math.max(o.size[0], o.size[2]) / 2 - 0.05);
      if (d > lim) o = { ...o, position: [r3(s.x + ((o.position[0] - s.x) / (d || 1)) * lim), o.position[1], r3(s.z + ((o.position[2] - s.z) / (d || 1)) * lim)] };
    }
  }
  const inside = (p) => !room_ || (p.position[0] - p.size[0] / 2 > room_.minX + 0.1 && p.position[0] + p.size[0] / 2 < room_.maxX - 0.1 && p.position[2] - p.size[2] / 2 > room_.minZ + 0.1 && p.position[2] + p.size[2] / 2 < room_.maxZ - 0.1);
  const clear = (p) => inside(p) && !blockers(p, objects).length;
  if (clear(o)) return o;
  // rings outwards from the spot asked for; on each ring, the side facing away from `from` first
  const [x0, , z0] = o.position, away = from ? Math.atan2(z0 - from[2], x0 - from[0]) : 0;
  const step = o.position[1] > 0.05 ? 0.1 : 0.25; // on a table, small steps
  for (let r = step; r <= maxRadius; r += step) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.3));
    const tries = Array.from({ length: n }, (_, i) => away + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * ((2 * Math.PI) / n));
    for (const t of tries) {
      const p = { ...o, position: [r3(x0 + Math.cos(t) * r), o.position[1], r3(z0 + Math.sin(t) * r)] };
      if (o.position[1] > 0.05 && supportOf(p, objects)?.id !== supportOf(o, objects)?.id) continue; // stays on its surface
      if (clear(p)) return p;
    }
  }
  return null;
}
