// What hangs on a truss goes with it. When a truss is moved, turned, resized or
// changed to another shape (goalpost → circle), the fixtures clamped to it, the
// LED walls flown from it and the banners hung from it follow:
//  · moved or turned only: they keep their arrangement, carried rigidly;
//  · reshaped or resized: the lights are spread evenly along the new truss in
//    their old order (all the way round a ring, inset from the ends of a run)
//    and re-aimed where a lighting designer would point them; flown screens and
//    banners hang from the nearest point of the new truss at the same drop.
import type { SceneObject } from './types';
import { rigSegments } from '@/components/three/rig';
import { fixtureOf, hangDrop } from '@/components/three/StageLight';
import { aimAt, autoFocus } from './autoLight';

type P = { x: number; y: number; z: number };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function nearest(t: SceneObject, x: number, z: number) {
  let best: { p: P; d: number; along: number } | null = null, run = 0;
  for (const [a, b] of rigSegments(t)) {
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz, len = Math.sqrt(len2);
    const k = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    const p = { x: a.x + dx * k, y: a.y, z: a.z + dz * k }, d = Math.hypot(p.x - x, p.z - z);
    if (!best || d < best.d) best = { p, d, along: run + k * len };
    run += len;
  }
  return best;
}

const hungLight = (o: SceneObject) => o.type === 'light' && (o.spec?.mount || fixtureOf(o).mount) === 'truss';
const flown = (o: SceneObject) => (o.type === 'led_screen' && o.spec?.frame === 'flown') || (o.type === 'sign' && o.variant === 'hanging');

/** What hangs on this truss (as it stands in `objects`), with where along it each piece is. */
function attached(t: SceneObject, objects: SceneObject[]) {
  const out: { o: SceneObject; along: number; drop: number }[] = [];
  for (const o of objects) {
    if (o.id === t.id || (!hungLight(o) && !flown(o))) continue;
    const top = hungLight(o) ? o.position[1] + hangDrop(o) : o.position[1] + o.size[1];
    const n = nearest(t, o.position[0], o.position[2]);
    if (!n || n.d > 0.6 || Math.abs(top - n.p.y) > (hungLight(o) ? 0.35 : 1.2)) continue;
    out.push({ o, along: n.along, drop: n.p.y - top });
  }
  return out.sort((a, b) => a.along - b.along);
}

/** Evenly spaced points along a truss's runs: round a closed shape, inset from the ends of an open one. */
function spread(t: SceneObject, n: number): P[] {
  const segs = rigSegments(t), lens = segs.map(([a, b]) => Math.hypot(b.x - a.x, b.z - a.z)), total = lens.reduce((x, y) => x + y, 0);
  if (!segs.length || !total) return [];
  const closed = t.variant === 'circle' || t.variant === 'square';
  return Array.from({ length: n }, (_, i) => {
    let d = closed ? ((i + 0.5) / n) * total : n > 1 ? total * (0.08 + (0.84 * i) / (n - 1)) : total / 2;
    for (let k = 0; k < segs.length; k++) {
      if (d <= lens[k] || k === segs.length - 1) { const [a, b] = segs[k], f = lens[k] ? Math.min(1, d / lens[k]) : 0; return { x: a.x + (b.x - a.x) * f, y: a.y, z: a.z + (b.z - a.z) * f }; }
      d -= lens[k];
    }
    return { x: t.position[0], y: segs[0][0].y, z: t.position[2] };
  });
}

const sameShape = (a: SceneObject, b: SceneObject) => a.variant === b.variant && a.size.every((v, i) => Math.abs(v - b.size[i]) < 1e-6) && (a.spec?.system || '') === (b.spec?.system || '');
const sameTransform = (a: SceneObject, b: SceneObject) => a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-6) && Math.abs((a.rotation?.[1] || 0) - (b.rotation?.[1] || 0)) < 1e-6;

/** Carry everything hung on changed trusses from `before` into `after`. */
export function carryRig(before: SceneObject[], after: SceneObject[]): SceneObject[] {
  const prevById = new Map(before.map((o) => [o.id, o])), nextById = new Map(after.map((o) => [o.id, o]));
  // a piece this same change already placed itself (the AI rearranging a rig) is left as given
  const untouched = (o: SceneObject) => { const n = nextById.get(o.id); return !!n && n.position.every((v, i) => v === o.position[i]); };
  const changed = after.filter((t) => t.type === 'truss').map((t) => [prevById.get(t.id), t] as const).filter(([p, t]) => p && p !== t && (!sameShape(p, t) || !sameTransform(p, t)));
  if (!changed.length) return after;
  const moves = new Map<string, Partial<SceneObject>>();
  for (const [prev, t] of changed) {
    const hung = attached(prev!, before).filter((h) => !moves.has(h.o.id) && untouched(h.o));
    if (!hung.length) continue;
    if (sameShape(prev!, t)) {
      // moved or turned: carry the whole arrangement rigidly
      const dy = (t.rotation?.[1] || 0) - (prev!.rotation?.[1] || 0), c = Math.cos(dy), s = Math.sin(dy);
      for (const { o } of hung) {
        const lx = o.position[0] - prev!.position[0], lz = o.position[2] - prev!.position[2];
        moves.set(o.id, { position: [r3(t.position[0] + lx * c + lz * s), r3(o.position[1] + t.position[1] - prev!.position[1]), r3(t.position[2] - lx * s + lz * c)], rotation: [0, (o.rotation?.[1] || 0) + dy, 0] });
      }
      continue;
    }
    // reshaped: lights spread evenly along the new truss in their old order, re-aimed; flown pieces hang from its nearest point
    const lights = hung.filter((h) => hungLight(h.o)), spots = spread(t, lights.length);
    const ring = t.variant === 'circle' || t.variant === 'square';
    lights.forEach(({ o }, i) => {
      const p = spots[i];
      if (!p) return;
      // on a ring each fixture faces the middle; on a run it faces the way the truss does
      const yaw = ring ? Math.atan2(t.position[0] - p.x, t.position[2] - p.z) : t.rotation?.[1] || 0;
      let moved: SceneObject = { ...o, position: [r3(p.x), r3(p.y - hangDrop(o)), r3(p.z)], rotation: [0, yaw, 0] };
      const focus = autoFocus(moved, after);
      if (focus) moved = { ...moved, spec: { ...moved.spec, ...aimAt(moved, focus) } };
      moves.set(o.id, { position: moved.position, rotation: moved.rotation, spec: moved.spec });
    });
    for (const { o, drop } of hung.filter((h) => !hungLight(h.o))) {
      const n = nearest(t, o.position[0], o.position[2]);
      if (n) moves.set(o.id, { position: [r3(n.p.x), r3(n.p.y - drop - o.size[1]), r3(n.p.z)] });
    }
  }
  return moves.size ? after.map((o) => (moves.has(o.id) ? { ...o, ...moves.get(o.id) } : o)) : after;
}
