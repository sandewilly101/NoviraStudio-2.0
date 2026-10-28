// A hire stage as it is built on site: 4 ft (1.219 m) platform decks with a
// non-slip (or carpeted, or white gloss) top and aluminium frames, square legs
// on rubber feet with cross-bracing on taller stages, box-pleated velour
// skirting hung on a velcro band, a white safety edge, the LED edge strip,
// boxed stair units with nosings and handrails, and guardrails (top rail, mid
// rail, toe board) on raised stages.
// Object space: centred on x/z, floor at y = 0, deck top at y = height, front +z.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { finishFor, finishMaterial } from '@/lib/finish';
import { BOX, CYL, FIN, PartList, RenderParts, place, tube, v3 } from './kit';
import { useSurfaceTexture } from '@/lib/content';

const DECK = 1.219;

/** Box-pleated skirting: a strip `w` wide and `h` tall, pleats every `p`, `depth` deep, facing +z. */
function pleatGeometry(w: number, h: number, p = 0.12, depth = 0.018) {
  const per = Math.max(1, Math.round(w / p)), pitch = w / per, pts: [number, number][] = [];
  for (let i = 0; i < per; i++) {
    const x = -w / 2 + i * pitch;
    // flat face, fold in, flat back, fold out — a box pleat
    pts.push([x, 0], [x + pitch * 0.42, 0], [x + pitch * 0.5, -depth], [x + pitch * 0.92, -depth], [x + pitch, 0]);
  }
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  pts.forEach(([x, z], i) => { pos.push(x, 0, z, x, h, z); uv.push(i / pts.length, 0, i / pts.length, 1); });
  for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function Stage({ o }: { o: SceneObject }) {
  const [W, H, D] = o.size;
  const s = o.spec || {};
  const stairs = s.stairs !== false, rails = s.rails ?? H >= 0.76, top = s.top || 'deck';
  const skirtTone = s.skirt || '#121212', deckTone = o.color || '#1C1E21', deckFinish = o.finish?.deck;

  const built = useMemo(() => {
    const L = new PartList();
    const nx = Math.max(1, Math.round(W / DECK)), nz = Math.max(1, Math.round(D / DECK)), dx = W / nx, dz = D / nz;
    const topMat = deckFinish ? finishMaterial(deckFinish) : top === 'carpet' ? FIN.carpet(s.carpet || '#2B2F36') : top === 'gloss' ? FIN.gloss(deckTone) : FIN.deck(deckTone);
    const alu = FIN.aluminium(), black = FIN.powder('#17181B');
    const frameH = 0.05, topT = 0.019;
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const cx = -W / 2 + (i + 0.5) * dx, cz = -D / 2 + (k + 0.5) * dz;
      L.add('top', BOX, topMat, place(cx, H - topT / 2, cz, dx - 0.004, topT, dz - 0.004));
      // deck frame: four extrusions under the ply
      for (const sgn of [-1, 1]) {
        L.add('frame', BOX, alu, place(cx, H - topT - frameH / 2, cz + sgn * (dz / 2 - 0.016), dx - 0.006, frameH, 0.03));
        L.add('frame', BOX, alu, place(cx + sgn * (dx / 2 - 0.016), H - topT - frameH / 2, cz, 0.03, frameH, dz - 0.006));
      }
    }
    // legs at every deck corner, rubber feet, and bracing on taller stages
    const legTop = H - topT - frameH;
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
      const x = Math.max(-W / 2 + 0.03, Math.min(W / 2 - 0.03, -W / 2 + i * dx)), z = Math.max(-D / 2 + 0.03, Math.min(D / 2 - 0.03, -D / 2 + k * dz));
      L.add('leg', BOX, alu, place(x, (legTop + 0.012) / 2, z, 0.04, legTop - 0.012, 0.04));
      L.add('foot', CYL, FIN.rubber(), place(x, 0.006, z, 0.035, 0.012, 0.035));
      if (H > 0.5) {
        if (i < nx && (k === 0 || k === nz)) L.add('brace', CYL, alu, tube(v3(x, 0.1, z), v3(-W / 2 + (i + 1) * dx, legTop - 0.06, z), 0.012));
        if (k < nz && (i === 0 || i === nx)) L.add('brace', CYL, alu, tube(v3(x, 0.1, z), v3(x, legTop - 0.06, -D / 2 + (k + 1) * dz), 0.012));
      }
    }
    // white safety edge along the front of the deck
    L.add('tape', BOX, FIN.tape(), place(0, H + 0.0006, D / 2 - 0.03, W - 0.01, 0.0012, 0.05));
    // stair unit at the front right: boxed steps with nosings, handrails both sides
    if (stairs && H > 0.25) {
      const risers = Math.ceil(H / 0.19), tread = 0.28, sw = Math.min(1.22, W * 0.3), sx = W / 2 - sw / 2 - 0.3;
      for (let i = 1; i < risers; i++) {
        const y = (i * H) / risers, z = D / 2 + (risers - i - 0.5) * tread;
        L.add('step', BOX, topMat, place(sx, y - topT / 2, z, sw, topT, tread));
        L.add('stepBody', BOX, FIN.powder('#141518'), place(sx, (y - topT) / 2, z, sw - 0.01, y - topT, tread - 0.01));
        L.add('tape', BOX, FIN.tape(), place(sx, y + 0.0006, z + tread / 2 - 0.025, sw - 0.02, 0.0012, 0.04));
      }
      if (H > 0.4) {
        const zEnd = D / 2 + (risers - 1) * tread, run = (y: number, z: number) => v3(0, y, z);
        for (const side of [-1, 1]) {
          const x = sx + side * (sw / 2 - 0.03), lo = run(H / risers + 0.9, zEnd - 0.1), hi = run(H + 0.9, D / 2 + 0.05);
          lo.x = hi.x = x;
          L.add('rail', CYL, black, tube(lo, hi, 0.021));
          L.add('rail', CYL, black, tube(v3(x, lo.y - 0.45, lo.z), v3(x, hi.y - 0.45, hi.z), 0.016));
          L.add('rail', CYL, black, tube(v3(x, H / risers, lo.z), lo, 0.022));
          L.add('rail', CYL, black, tube(v3(x, H, hi.z), hi, 0.022));
        }
      }
    }
    // guardrails on the back and sides of a raised stage
    if (rails) {
      const runs: [THREE.Vector3, THREE.Vector3][] = [[v3(-W / 2 + 0.03, 0, -D / 2 + 0.03), v3(W / 2 - 0.03, 0, -D / 2 + 0.03)], [v3(-W / 2 + 0.03, 0, -D / 2 + 0.03), v3(-W / 2 + 0.03, 0, D / 2 - 0.03)], [v3(W / 2 - 0.03, 0, -D / 2 + 0.03), v3(W / 2 - 0.03, 0, D / 2 - 0.03)]];
      for (const [a, b] of runs) {
        const len = a.distanceTo(b), posts = Math.max(1, Math.ceil(len / 1.22));
        for (let p = 0; p <= posts; p++) { const q = a.clone().lerp(b, p / posts); L.add('rail', CYL, black, tube(v3(q.x, H, q.z), v3(q.x, H + 1.0, q.z), 0.02)); }
        for (const y of [H + 1.0, H + 0.5]) L.add('rail', CYL, black, tube(v3(a.x, y, a.z), v3(b.x, y, b.z), 0.019));
        const mid = a.clone().lerp(b, 0.5), alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
        L.add('toe', BOX, black, place(mid.x, H + 0.05, mid.z, alongX ? len : 0.012, 0.1, alongX ? 0.012 : len));
      }
    }
    return L;
  }, [W, H, D, stairs, rails, top, deckTone, s.carpet, deckFinish]);

  // pleated skirting on the front and sides (and back when asked), on a velcro band
  const skirts = useMemo(() => {
    const h = H - 0.035, out: { geo: THREE.BufferGeometry; pos: [number, number, number]; rot: number; w: number }[] = [];
    out.push({ geo: pleatGeometry(W, h), pos: [0, 0.008, D / 2 + 0.02], rot: 0, w: W });
    out.push({ geo: pleatGeometry(D, h), pos: [W / 2 + 0.02, 0.008, 0], rot: Math.PI / 2, w: D });
    out.push({ geo: pleatGeometry(D, h), pos: [-W / 2 - 0.02, 0.008, 0], rot: -Math.PI / 2, w: D });
    if (s.skirtBack) out.push({ geo: pleatGeometry(W, h), pos: [0, 0.008, -D / 2 - 0.02], rot: Math.PI, w: W });
    return out;
  }, [W, H, D, s.skirtBack]);

  const velour = finishFor(o, 'skirt', FIN.velour(skirtTone), { side: THREE.DoubleSide });
  return (
    <group>
      <RenderParts list={built} />
      {s.skirt !== 'none' && skirts.map((k, i) => (
        <group key={i} position={k.pos} rotation={[0, k.rot, 0]}>
          <mesh geometry={k.geo} material={velour} castShadow receiveShadow userData={{ part: 'skirt' }} />
          <mesh position={[0, H - 0.045, 0.004]} material={FIN.powder('#0E0E0F')}><boxGeometry args={[k.w, 0.05, 0.006]} /></mesh>
        </group>
      ))}
      {s.fascia && s.fascia !== 'none' && <Fascia o={o} />}
      {o.ledStrip !== false && (
        <mesh position={[0, H - 0.03, D / 2 + 0.026]} material={FIN.glow('#3FA2FF')}><boxGeometry args={[W - 0.02, 0.012, 0.004]} /></mesh>
      )}
    </group>
  );
}

/** Branding on the stage front (and sides with spec.fasciaSides): printed on the skirt, or an LED fascia that glows. */
function Fascia({ o }: { o: SceneObject }) {
  const [W, H, D] = o.size, tex = useSurfaceTexture(o), led = o.spec?.fascia === 'led';
  const mat = useMemo(() => (led
    ? new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.35, 1.35, 1.35), toneMapped: false }) // brighter than white: an LED face blooms
    : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })), [tex, led]);
  if (!tex) return null;
  const h = H - 0.04, y = 0.012 + h / 2;
  return (
    <group>
      <mesh position={[0, y, D / 2 + (led ? 0.045 : 0.03)]} material={mat} userData={{ part: 'content' }}><planeGeometry args={[W, h]} /></mesh>
      {led && <mesh position={[0, y, D / 2 + 0.035]} material={FIN.powder('#0B0B0C')}><boxGeometry args={[W + 0.02, h + 0.02, 0.02]} /></mesh>}
      {o.spec?.fasciaSides && [-1, 1].map((sd) => (
        <mesh key={sd} position={[sd * (W / 2 + (led ? 0.045 : 0.03)), y, 0]} rotation={[0, sd * Math.PI / 2, 0]} material={mat} userData={{ part: 'content' }}><planeGeometry args={[D, h]} /></mesh>
      ))}
    </group>
  );
}
