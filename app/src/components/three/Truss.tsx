// Truss drawn the way it is bolted together: box or triangle section chords with
// a Warren web, flange bands at every stock-length joint, a welded corner block
// wherever two runs meet at a right angle, braced towers on base plates, and
// chain hoists for flown runs. Arches and circles are rolled truss — one smooth
// bent section — never straight bits joined by blocks.
// The object's size is [width, height to the top of the truss, depth].
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { trussSystem, type TrussSystemSpec } from '@/nozila/shared';
import { FIN } from './kit';

type V = THREE.Vector3;
type Tube = [V, V];
type Off = { u: number; v: number };
type Parts = { chords: Tube[]; web: Tube[]; blocks: Tube[]; couplers: Tube[]; pins: Tube[]; plates: V[]; hoists: V[] };
/** A smooth centreline; `n` is the normal of the plane it bends in. */
type Run = { pts: V[]; n: V; closed?: boolean; openStart?: boolean; openEnd?: boolean };

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = vec(0, 1, 0), Z = vec(0, 0, 1);
const mm = (n: number) => n / 1000;

export const TRUSS_SYSTEM_CHOICES = [
  ['f34-square', 'F34 box'], ['f44-square', 'F44 box'], ['h40v-square', 'H40V box'], ['f33-tri', 'F33 triangle'], ['ladder-290', 'Ladder'],
] as const;

// Chord centres in the section, in metres: u across the run, v along the bend normal.
function offsets(s: TrussSystemSpec): Off[] {
  const w = mm(s.widthMm) / 2, h = mm(s.heightMm) / 2;
  if (s.chords === 2) return [{ u: -w, v: 0 }, { u: w, v: 0 }];
  if (s.chords === 3) return [{ u: -w, v: -h }, { u: w, v: -h }, { u: 0, v: h }];
  return [{ u: -w, v: -h }, { u: w, v: -h }, { u: w, v: h }, { u: -w, v: h }];
}
const faces = (n: number): [number, number][] => (n <= 2 ? [[0, 1]] : Array.from({ length: n }, (_, i) => [i, (i + 1) % n]));

function buildRun(run: Run, s: TrussSystemSpec, offs: Off[], out: Parts) {
  const P = run.closed ? [...run.pts, run.pts[0]] : run.pts;
  const len = [0];
  for (let i = 1; i < P.length; i++) len.push(len[i - 1] + P[i].distanceTo(P[i - 1]));
  const L = len[len.length - 1];
  if (L < 1e-3) return;
  // section frame at each sample: tangent from neighbours (wrapping when closed)
  const frames = P.map((p, i) => {
    const prev = P[i - 1] ?? (run.closed ? P[P.length - 2] : p), next = P[i + 1] ?? (run.closed ? P[1] : p);
    const t = next.clone().sub(prev).normalize();
    return { p, t, u: t.clone().cross(run.n).normalize(), v: run.n };
  });
  const at = (d: number) => {
    let i = 1;
    while (i < len.length - 1 && len[i] < d) i++;
    const k = (d - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
    const a = frames[i - 1], b = frames[i];
    return { p: a.p.clone().lerp(b.p, k), t: a.t.clone().lerp(b.t, k).normalize(), u: a.u.clone().lerp(b.u, k).normalize(), v: run.n };
  };
  const node = (f: { p: V; u: V; v: V }, o: Off) => f.p.clone().addScaledVector(f.u, o.u).addScaledVector(f.v, o.v);

  for (const o of offs) for (let i = 1; i < frames.length; i++) out.chords.push([node(frames[i - 1], o), node(frames[i], o)]);

  // the web: a continuous zig-zag, panels stretched to fit a whole number
  let panels = Math.max(1, Math.round(L / mm(s.panelLengthMm)));
  if (run.closed && panels % 2) panels++;
  const fs = Array.from({ length: panels + 1 }, (_, p) => at((p / panels) * L));
  for (const [i, k] of faces(offs.length)) {
    if (s.bracePattern !== 'ladder') for (let p = 0; p < panels; p++) {
      const [a, b] = p % 2 ? [offs[k], offs[i]] : [offs[i], offs[k]];
      out.web.push([node(fs[p], a), node(fs[p + 1], b)]);
    }
    for (let p = 0; p <= panels; p++) {
      const end = !run.closed && (p === 0 || p === panels);
      if (s.bracePattern === 'warren' && !end) continue;
      if (run.closed && p === panels) continue;
      out.web.push([node(fs[p], offs[i]), node(fs[p], offs[k])]);
    }
  }

  // flange bands where stock lengths couple, and on open ends
  const joints = Math.max(1, Math.round(L / mm(s.stockLengthsMm[0] ?? 3000)));
  for (let j = 0; j <= joints; j++) {
    if (run.closed && j === joints) continue;
    if (!run.closed && ((j === 0 && !run.openStart) || (j === joints && !run.openEnd))) continue;
    const f = at((j / joints) * L);
    // conical coupler on each chord, with its spigot pin through it
    const across = Math.abs(f.t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const pinDir = f.t.clone().cross(across).normalize(), reach = mm(s.chordDiameterMm) * 0.95;
    for (const o of offs) {
      const c = node(f, o);
      out.couplers.push([c.clone().addScaledVector(f.t, -0.035), c.clone().addScaledVector(f.t, 0.035)]);
      for (const k of [-0.018, 0.018]) { const q = c.clone().addScaledVector(f.t, k); out.pins.push([q.clone().addScaledVector(pinDir, -reach), q.clone().addScaledVector(pinDir, reach)]); }
    }
  }
}

// The welded cube two runs bolt into at a corner: its twelve edges.
function corner(c: V, half: number, out: Parts) {
  const k = [-half, half];
  for (const a of k) for (const b of k) {
    out.blocks.push([vec(c.x - half, c.y + a, c.z + b), vec(c.x + half, c.y + a, c.z + b)]);
    out.blocks.push([vec(c.x + a, c.y - half, c.z + b), vec(c.x + a, c.y + half, c.z + b)]);
    out.blocks.push([vec(c.x + a, c.y + b, c.z - half), vec(c.x + a, c.y + b, c.z + half)]);
  }
}

const line = (a: V, b: V, n: V, ends: { openStart?: boolean; openEnd?: boolean } = {}): Run => ({ pts: [a, b], n, ...ends });

export function buildTruss(shape: string, size: [number, number, number], s: TrussSystemSpec): Parts {
  const out: Parts = { chords: [], web: [], blocks: [], couplers: [], pins: [], plates: [], hoists: [] };
  const offs = offsets(s);
  const hs = Math.max(mm(s.widthMm), mm(s.heightMm)) / 2;
  const [W, H, D] = size;
  const y = Math.max(hs * 3, H - hs); // centreline of the header
  const runs: Run[] = [];
  const tower = (x: number, z: number) => { runs.push(line(vec(x, 0, z), vec(x, y - hs, z), Z, { openStart: true })); out.plates.push(vec(x, 0, z)); };

  switch (shape) {
    case 'straight': {
      runs.push(line(vec(-W / 2, y, 0), vec(W / 2, y, 0), UP, { openStart: true, openEnd: true }));
      const pick = Math.min(W / 2 - 0.4, Math.max(0.5, W / 2 - 1));
      out.hoists.push(vec(-pick, y + hs, 0), vec(pick, y + hs, 0));
      break;
    }
    case 'arch': {
      // two braced legs and a rolled header, all in one upright plane
      const a = W / 2 - hs, rise = Math.min(a, y * 0.45), spring = y - rise, pts: V[] = [vec(-a, 0, 0)];
      for (let i = 0; i <= 40; i++) { const t = Math.PI - (i / 40) * Math.PI; pts.push(vec(Math.cos(t) * a, spring + Math.sin(t) * rise, 0)); }
      pts.push(vec(a, 0, 0));
      runs.push({ pts, n: Z, openStart: true, openEnd: true });
      out.plates.push(vec(-a, 0, 0), vec(a, 0, 0));
      break;
    }
    case 'circle': {
      // a rolled ring, flown from four chain hoists
      const r = Math.max(1, Math.min(W, D) / 2 - hs);
      runs.push({ pts: Array.from({ length: 64 }, (_, i) => { const t = (i / 64) * Math.PI * 2; return vec(Math.cos(t) * r, y, Math.sin(t) * r); }), n: UP, closed: true });
      for (let i = 0; i < 4; i++) { const t = Math.PI / 4 + (i * Math.PI) / 2; out.hoists.push(vec(Math.cos(t) * r, y + hs, Math.sin(t) * r)); }
      break;
    }
    case 'square':
    case 'u-shape': {
      const a = W / 2 - hs, b = Math.max(hs * 2, D / 2 - hs);
      const pts = [vec(-a, y, b), vec(-a, y, -b), vec(a, y, -b), vec(a, y, b)];
      const sides = shape === 'square' ? [[0, 1], [1, 2], [2, 3], [3, 0]] : [[0, 1], [1, 2], [2, 3]];
      for (const [i, k] of sides) {
        const dir = pts[k].clone().sub(pts[i]).normalize();
        runs.push(line(pts[i].clone().addScaledVector(dir, hs), pts[k].clone().addScaledVector(dir, -hs), UP));
      }
      for (const p of pts) { corner(p, hs, out); tower(p.x, p.z); }
      break;
    }
    default: { // goalpost: two towers and a header
      const a = W / 2 - hs;
      runs.push(line(vec(-a + hs, y, 0), vec(a - hs, y, 0), UP));
      for (const x of [-a, a]) { corner(vec(x, y, 0), hs, out); tower(x, 0); }
    }
  }
  for (const r of runs) buildRun(r, s, offs, out);
  return out;
}

const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpD = new THREE.Vector3();

function Tubes({ items, radius, material }: { items: Tube[]; radius: number; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach(([a, b], i) => {
      tmpD.subVectors(b, a);
      const l = tmpD.length();
      tmpQ.setFromUnitVectors(UP, tmpD.normalize());
      tmpM.compose(tmpP.addVectors(a, b).multiplyScalar(0.5), tmpQ, tmpS.set(radius, Math.max(l, 1e-4), radius));
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items, radius]);
  if (!items.length) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[cyl, material, items.length]} castShadow receiveShadow />
  );
}

function Hoist({ at }: { at: V }) {
  return (
    <group position={at}>
      <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[0.008, 0.008, 0.9, 6]} /><meshStandardMaterial color="#3A3D42" metalness={0.9} roughness={0.4} /></mesh>
      <mesh position={[0, 1.05, 0]} castShadow><boxGeometry args={[0.3, 0.42, 0.26]} /><meshStandardMaterial color="#1D1F23" metalness={0.4} roughness={0.6} /></mesh>
      <mesh position={[0, 2.0, 0]}><cylinderGeometry args={[0.008, 0.008, 1.5, 6]} /><meshStandardMaterial color="#3A3D42" metalness={0.9} roughness={0.4} /></mesh>
    </group>
  );
}

export function Truss({ o }: { o: SceneObject }) {
  const s = trussSystem(o.spec?.system);
  const parts = useMemo(() => buildTruss(o.variant || 'goalpost', o.size, s), [o.variant, o.size, s]);
  // brushed aluminium as delivered, or the black powder coat used on stage
  const metal = o.spec?.finish === 'black' ? FIN.powder('#151618') : FIN.aluminium(o.color || s.color);
  const steel = FIN.powder('#2F3237'), bolt = FIN.chrome();
  const chord = mm(s.chordDiameterMm) / 2, half = Math.max(mm(s.widthMm), mm(s.heightMm)) / 2 + 0.03;
  return (
    <group>
      <Tubes items={parts.chords} radius={chord} material={metal} />
      <Tubes items={parts.blocks} radius={chord} material={metal} />
      <Tubes items={parts.web} radius={mm(s.braceDiameterMm) / 2} material={metal} />
      <Tubes items={parts.couplers} radius={chord * 1.32} material={metal} />
      <Tubes items={parts.pins} radius={0.0045} material={bolt} />
      {parts.plates.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          {/* base plate, sleeve block the tower drops into, and its bolts */}
          <mesh position={[0, 0.0075, 0]} material={steel} castShadow receiveShadow><boxGeometry args={[0.6, 0.015, 0.6]} /></mesh>
          <mesh position={[0, 0.055, 0]} material={steel} castShadow><boxGeometry args={[half * 2, 0.08, half * 2]} /></mesh>
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], k) => (
            <mesh key={k} position={[x * 0.24, 0.02, z * 0.24]} material={bolt}><cylinderGeometry args={[0.014, 0.014, 0.012, 6]} /></mesh>
          ))}
        </group>
      ))}
      {parts.hoists.map((p, i) => <Hoist key={i} at={p} />)}
    </group>
  );
}
