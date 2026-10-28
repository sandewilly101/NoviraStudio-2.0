// Where lights can hang: the bottom chord of every flown or supported truss
// header in the scene. A truss-mounted light dropped near one clamps onto it,
// at the height its C-clamp and yoke put the fixture.
import { trussSystem } from '@/nozila/shared';
import type { SceneObject } from '@/lib/types';
import { fixtureOf, hangDrop } from './StageLight';

type P = { x: number; y: number; z: number };
type Seg = [P, P];

/** Header runs of a truss, in world space, at the underside of the bottom chord. */
export function rigSegments(t: SceneObject): Seg[] {
  const sys = trussSystem(t.spec?.system);
  const [W, H, D] = t.size;
  const hs = Math.max(sys.widthMm, sys.heightMm) / 2000;
  const yc = Math.max(hs * 3, H - hs);
  const under = yc - (sys.chords >= 3 ? sys.heightMm / 2000 : 0) - sys.chordDiameterMm / 2000;
  const local: [number, number, number, number][] = []; // x0, z0, x1, z1
  const a = W / 2 - hs, b = Math.max(hs * 2, D / 2 - hs);
  switch (t.variant || 'goalpost') {
    case 'arch': return [];
    case 'straight': local.push([-W / 2, 0, W / 2, 0]); break;
    case 'square': local.push([-a, -b, a, -b], [a, -b, a, b], [a, b, -a, b], [-a, b, -a, -b]); break;
    case 'u-shape': local.push([-a, b, -a, -b], [-a, -b, a, -b], [a, -b, a, b]); break;
    case 'circle': {
      const r = Math.max(1, Math.min(W, D) / 2 - hs), n = 48;
      for (let i = 0; i < n; i++) { const p = (i / n) * Math.PI * 2, q = ((i + 1) / n) * Math.PI * 2; local.push([Math.cos(p) * r, Math.sin(p) * r, Math.cos(q) * r, Math.sin(q) * r]); }
      break;
    }
    default: local.push([-a + hs, 0, a - hs, 0]);
  }
  const yaw = t.rotation?.[1] || 0, c = Math.cos(yaw), s = Math.sin(yaw);
  const world = (x: number, z: number): P => ({ x: t.position[0] + x * c + z * s, y: t.position[1] + under, z: t.position[2] - x * s + z * c });
  return local.map(([x0, z0, x1, z1]) => [world(x0, z0), world(x1, z1)]);
}

function nearestOn([a, b]: Seg, x: number, z: number): P {
  const dx = b.x - a.x, dz = b.z - a.z, len = dx * dx + dz * dz;
  const k = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len)) : 0;
  return { x: a.x + dx * k, y: a.y, z: a.z + dz * k };
}

/**
 * Clamp a truss-mounted light onto the nearest truss header within `reach`
 * metres (any distance when `reach` is Infinity). Other objects pass through.
 */
export function snapToRig(o: SceneObject, all: SceneObject[], reach = 1.2): SceneObject {
  if (o.type !== 'light' || (o.spec?.mount || fixtureOf(o).mount) !== 'truss') return o;
  let best: P | null = null, bestD = reach;
  for (const t of all) {
    if (t.type !== 'truss') continue;
    for (const seg of rigSegments(t)) {
      const p = nearestOn(seg, o.position[0], o.position[2]), d = Math.hypot(p.x - o.position[0], p.z - o.position[2]);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  if (!best) return o;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { ...o, position: [r(best.x), r(best.y - hangDrop(o)), r(best.z)] };
}
