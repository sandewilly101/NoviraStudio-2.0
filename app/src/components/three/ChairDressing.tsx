// Chair covers and sashes, as hired for banquets. Drawn over the real chair
// models in instanced batches (one per colour and chair shape) from each chair's
// spec.cover / spec.sash, tailored to the chair model's measured silhouette
// (lib/chairShape). A chair's front faces -z, its back is at +z.
//  · the cover is one piece of cloth: a tight back with a pillowed top, rolling
//    over the seat edge onto a domed seat, then a skirt that falls to the floor,
//    flaring at the hem in soft gravity folds (deepest at the back corners,
//    where the spare fabric gathers), in a woven polyester with a sheen;
//  · the sash is satin: a band gathered round the back and cinched where it is
//    tied, a bow of two puffed loops and a wrapped knot, and two tails with
//    dovetail ends whose drape is solved by a little cloth simulation (gravity,
//    satin's stiffness, resting against the cover) and that stir in the air.
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneObject } from '@/lib/types';
import { useLodSplit, useSimplified } from '@/lib/lod';
import { local, newMover, restingPendulum, swing, track, type Fabric, type Mover, type Pendulum } from '@/lib/clothSway';
import { chairShape, useChairShapes, type BackSlice, type ChairShape } from '@/lib/chairShape';

const SEAT = 0.47; // seat height of a banquet chair, metres
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------------
// The cover: rings of cloth stacked from the hem to the top of the back, lofted.

type Ring = { y: number; a: number; front: number; back: number; n: number; fold: number; ao?: number };
const AROUND = 72;

/** A point on a rounded-rectangle ring (superellipse) at turn t ∈ [0,1). */
function ringPoint(r: Ring, t: number) {
  const ang = t * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang), e = 2 / r.n;
  const cz = (r.front + r.back) / 2, b = (r.back - r.front) / 2;
  return { x: r.a * Math.sign(c) * Math.abs(c) ** e, z: cz + b * Math.sign(s) * Math.abs(s) ** e, cz, b, c, s };
}

/** A banquet chair's shape when its model has not been measured (yet): a back leaning a little, thicker low down. */
function standardShape(w: number, h: number, d: number): ChairShape {
  const back = Array.from({ length: 6 }, (_, i) => { const u = i / 5; return { y: SEAT + 0.03 + (h - SEAT - 0.03) * u, a: w * 0.46, front: d / 2 - 0.12 + 0.06 * u, back: d / 2 - 0.02 + 0.02 * u }; });
  return { key: `std|${[w, h, d].join('x')}`, seat: SEAT, top: h, rear: d / 2, skirt: { a: w / 2, front: -d / 2 }, back };
}

/** The chair's back at height y, between the measured slices. */
function backAt(shape: ChairShape, y: number): BackSlice {
  const b = shape.back;
  if (y <= b[0].y) return { ...b[0], y };
  for (let i = 1; i < b.length; i++) {
    if (y <= b[i].y) {
      const k = (y - b[i - 1].y) / (b[i].y - b[i - 1].y), mix = (p: number, q: number) => p + (q - p) * k;
      return { y, a: mix(b[i - 1].a, b[i].a), front: mix(b[i - 1].front, b[i].front), back: mix(b[i - 1].back, b[i].back) };
    }
  }
  return { ...b[b.length - 1], y };
}

/** How the cloth of the cover sits, ring by ring, tailored to the chair's shape. */
function coverRings(shape: ChairShape): Ring[] {
  const seat = shape.seat;
  // the skirt clears the legs; the back of the cover falls straight from the top of the chair to the floor
  const A = shape.skirt.a + 0.03, F = shape.skirt.front - 0.03, B = Math.max(shape.rear, ...shape.back.map((s) => s.back)) + 0.02;
  const backRing = (y: number) => { const s = backAt(shape, y); return { a: Math.max(s.a + 0.02, A - 0.03), front: s.front - 0.016 }; };
  const rings: Ring[] = [];
  // the skirt, hem first: it hangs nearly straight from the seat edge, flaring only near the floor
  for (let k = 0; k <= 14; k++) {
    const y = 0.004 + (seat - 0.012 - 0.004) * (k / 14) ** 1.1, fall = 1 - y / seat;
    const flare = 0.03 * fall ** 2.4;
    rings.push({ y, a: A + flare, front: F - flare, back: B + flare * 0.8, n: 5 - 0.8 * fall, fold: fall ** 0.9 });
  }
  // over the seat edge: pulled taut, so the roll is tight and the edge reads crisp
  for (const [dy, inset] of [[-0.005, 0], [0.004, 0.002], [0.011, 0.007], [0.015, 0.013]] as const) {
    rings.push({ y: seat + dy, a: A - inset * 0.4, front: F + inset, back: B, n: 5.2, fold: 0 });
  }
  // the seat: the front of the ring draws back to the chair back, the cushion barely domed;
  // the cloth tucks into a shadowed crease where the seat meets the back
  const y0 = seat + 0.04, first = backRing(y0);
  for (let k = 1; k <= 7; k++) {
    const e = k / 7, ease = e * e * (3 - 2 * e);
    rings.push({ y: seat + 0.016 + 0.005 * Math.sin(Math.PI * e) + (y0 - seat - 0.016) * e ** 3, a: A - 0.005 + (first.a - A + 0.005) * ease, front: F + 0.014 + (first.front - F - 0.014) * ease, back: B, n: 5.2, fold: 0, ao: k >= 6 ? 0.8 : 1 });
  }
  // the back, pulled over the chair's own back, following its lean
  // the cap rounds over the top rail with room to spare, so no finial or corner of the frame shows through
  const capR = Math.min(0.06, Math.max(0.03, (B - backRing(shape.top).front) * 0.6)), top = shape.top + capR * 0.55, y1 = top - capR;
  for (let k = 1; k <= 7; k++) {
    const y = y0 + (y1 - y0) * (k / 7), r = backRing(y);
    rings.push({ y, a: r.a, front: r.front, back: B, n: 5, fold: 0, ao: k === 1 ? 0.88 : 1 });
  }
  // the pillowed top: a quarter round closing the cloth over the frame
  const last = rings[rings.length - 1], mid = (last.front + B) / 2, half0 = (B - last.front) / 2;
  for (let k = 1; k <= 6; k++) {
    const phi = (k / 6) * (Math.PI / 2), half = half0 * Math.max(0.04, Math.cos(phi));
    rings.push({ y: y1 + capR * Math.sin(phi), a: last.a - capR * 0.5 * (1 - Math.cos(phi)), front: mid - half, back: mid + half, n: 5, fold: 0 });
  }
  return rings;
}

/** Where the sash's band rides on a chair of this shape. */
const bandHeight = (shape: ChairShape) => shape.seat + Math.max(0.22, shape.top - shape.seat) * 0.36;
const BAND_W = 0.075;

/**
 * Hanging folds round the skirt. Cloth folds are soft on the crest and sharp in
 * the valley, irregular in spacing and depth, and start at different heights:
 * a few begin just under the seat, most only part way down. The spare fabric
 * gathers at the back corners, so the folds there are deepest; the front hangs flatter.
 * Returns the fold's offset (−1 valley … 1 crest) and how strongly it has formed here.
 */
function foldAt(t: number, perimeter: number, fall: number, backness: number, corner: number) {
  const x = t * perimeter;
  const phase = (x / 0.2) * Math.PI * 2 + 1.1 * Math.sin((x / 0.53) * Math.PI * 2) + 0.5 * Math.sin((x / 0.31) * Math.PI * 2 + 1);
  const shape = 2 * Math.abs(Math.sin(phase / 2)) - 1; // cusp (sharp) at the valley, round at the crest
  const start = 0.12 + 0.3 * (0.5 + 0.5 * Math.sin((x / 0.37) * Math.PI * 2 + 2));
  const formed = clamp01((fall - start) / (1 - start)) ** 1.1 * (0.65 + 0.35 * Math.sin((x / 0.43) * Math.PI * 2));
  return { f: shape, k: formed * (0.35 + 0.5 * backness + 1.3 * corner) };
}

/** The cover's rear face at height y (the tails rest on it). */
function coverBackAt(rings: Ring[], y: number) {
  for (let i = 1; i < rings.length; i++) {
    if (rings[i].y >= y) { const p = rings[i - 1], q = rings[i], k = clamp01((y - p.y) / (q.y - p.y || 1)); return p.back + (q.back - p.back) * k; }
  }
  return rings[rings.length - 1].back;
}

function coverGeometry(shape: ChairShape, banded: boolean) {
  const rings = coverRings(shape);
  const pos: number[] = [], uv: number[] = [], color: number[] = [], sway: number[] = [], index: number[] = [];
  const hem = rings[0], perimeter = 2 * (2 * hem.a + (hem.back - hem.front)) * 0.92;
  const band = banded ? bandHeight(shape) : null;
  let climb = 0;
  rings.forEach((r, i) => {
    if (i) { const p = rings[i - 1]; climb += Math.hypot(r.y - p.y, (r.front - p.front) * 0.5); }
    const fall = 1 - r.y / shape.seat;
    for (let j = 0; j <= AROUND; j++) {
      const t = j / AROUND, p = ringPoint(r, t);
      let { x, z } = p, y = r.y, shade = r.ao ?? 1;
      if (r.fold) {
        // pushed out (or in) across the cloth, along the ring's outward direction
        const backness = clamp01(p.s), corner = clamp01(Math.abs(p.c) * p.s * 1.6) ** 2;
        const { f, k } = foldAt(t, perimeter, fall, backness, corner);
        const off = 0.026 * k * f;
        const nx = x, nz = (z - p.cz) * (r.a / Math.max(p.b, 1e-3)), len = Math.hypot(nx, nz) || 1;
        x += (nx / len) * off; z += (nz / len) * off;
        shade *= 1 - 0.4 * Math.min(1, k) * Math.max(0, -f) ** 1.5; // light hardly reaches into a fold
        if (i === 0) y += 0.006 * k * Math.max(0, f); // the hem lifts off the floor on each crest
      }
      // cloth darkens where it meets the floor, and just under the seat edge's roll
      shade *= 1 - 0.2 * clamp01(1 - y / 0.05);
      if (r.y < shape.seat && r.y > shape.seat - 0.05) shade *= 1 - 0.1 * (1 - (shape.seat - r.y) / 0.05);
      // the sash's band shades the cloth just below and above it
      if (band !== null && p.s > -0.2) {
        const below = band - BAND_W / 2 - y, above = y - band - BAND_W / 2;
        if (below >= 0 && below < 0.02) shade *= 1 - 0.28 * (1 - below / 0.02);
        if (above >= 0 && above < 0.01) shade *= 1 - 0.14 * (1 - above / 0.01);
      }
      pos.push(x, y, z);
      uv.push((t * perimeter) / 0.02, climb / 0.02);
      color.push(shade, shade, shade);
      sway.push(r.y < shape.seat ? clamp01(1 - r.y / shape.seat) ** 1.2 : 0); // the skirt swings from the seat edge
    }
  });
  const row = AROUND + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < AROUND; j++) {
      const a = i * row + j, b = a + 1, c = a + row, e = c + 1;
      index.push(a, c, b, b, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  // the ring's seam (j = 0 and j = AROUND) shares a normal, so the cloth shows no crease there
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < rings.length; i++) {
    const a = i * row, b = a + AROUND;
    const sx = n.getX(a) + n.getX(b), sy = n.getY(a) + n.getY(b), sz = n.getZ(a) + n.getZ(b), l = Math.hypot(sx, sy, sz) || 1;
    n.setXYZ(a, sx / l, sy / l, sz / l); n.setXYZ(b, sx / l, sy / l, sz / l);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Ribbon: a strip swept along a curve, cupped across its width like real satin.

type Frame = { p: THREE.Vector3; a: THREE.Vector3; n: THREE.Vector3; w: number };
type StripOpts = {
  rows: number; cols?: number; length: number; cup?: number;
  /** where along the ribbon each vertex sits (to cut a dovetail end) */
  sOf?: (s: number, v: number) => number;
  /** small offsets along the face normal: gathers and pleats */
  bump?: (s: number, v: number, f: Frame) => number;
  /** how freely each vertex moves in the air, 0..1 */
  sway?: (s: number) => number;
};

function strip(frame: (s: number) => Frame, o: StripOpts) {
  const cols = o.cols ?? 7, pos: number[] = [], uv: number[] = [], sway: number[] = [], index: number[] = [];
  for (let i = 0; i <= o.rows; i++) {
    for (let j = 0; j < cols; j++) {
      const v = j / (cols - 1), s = o.sOf ? o.sOf(i / o.rows, v) : i / o.rows, f = frame(s);
      const across = (v - 0.5) * f.w, cup = (o.cup ?? 0.06) * f.w * (1 - (2 * v - 1) ** 2) + (o.bump?.(s, v, f) ?? 0);
      pos.push(f.p.x + f.a.x * across + f.n.x * cup, f.p.y + f.a.y * across + f.n.y * cup, f.p.z + f.a.z * across + f.n.z * cup);
      uv.push((s * o.length) / 0.12, v); // u runs along the ribbon: satin's sheen streaks that way
      sway.push(o.sway?.(s) ?? 0);
    }
  }
  for (let i = 0; i < o.rows; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, e = c + 1;
      index.push(a, c, b, b, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A frame along a curve, the ribbon's width laid as close to `up(s)` as the curve allows. */
function along(curve: THREE.Curve<THREE.Vector3>, up: (s: number) => THREE.Vector3, width: (s: number) => number) {
  return (s: number): Frame => {
    const p = curve.getPointAt(s), t = curve.getTangentAt(s);
    const n = V().crossVectors(t, up(s)).normalize(), a = V().crossVectors(n, t).normalize();
    return { p, a, n, w: width(s) };
  };
}

/**
 * The tails' drape: a chain of particles hung from the knot, settled under
 * gravity with satin's stiffness and, over a cover, resting on its back.
 * Verlet integration with distance constraints; deterministic, solved once.
 */
function drape(start: THREE.Vector3, dir: THREE.Vector3, length: number, zMin: (y: number) => number | null) {
  const N = 20, seg = length / (N - 1), dt = 1 / 120, g = -9.81;
  const p = Array.from({ length: N }, (_, i) => start.clone().addScaledVector(dir, i * seg)), prev = p.map((q) => q.clone());
  const pinned = (i: number) => i < 3; // held in the knot, leaving it at the angle it was tied
  const keep = (i: number, j: number, rest: number, k: number) => {
    const d = V().subVectors(p[j], p[i]), l = d.length() || 1e-6, diff = ((l - rest) / l) * k;
    if (pinned(i)) p[j].addScaledVector(d, -diff);
    else if (pinned(j)) p[i].addScaledVector(d, diff);
    else { p[i].addScaledVector(d, diff / 2); p[j].addScaledVector(d, -diff / 2); }
  };
  for (let step = 0; step < 480; step++) {
    for (let i = 0; i < N; i++) {
      if (pinned(i)) continue;
      const v = V().subVectors(p[i], prev[i]).multiplyScalar(0.985); // air drag
      prev[i].copy(p[i]);
      p[i].add(v).add(V(0, g * dt * dt, 0));
    }
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < N - 1; i++) keep(i, i + 1, seg, 1);
      for (let i = 0; i < N - 2; i++) keep(i, i + 2, seg * 1.96, 0.18); // satin resists bending a little
      for (let i = 3; i < N; i++) { const z = zMin(p[i].y); if (z !== null && p[i].z < z) p[i].z = z; } // lies on the chair, never through it
    }
  }
  return p;
}

function sashGeometry(shape: ChairShape, covered: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  // the band rides round the back a third of the way up it
  const y = bandHeight(shape), rings = coverRings(shape);
  let ring: Ring;
  if (covered) {
    // round the cover's back, as tailored
    const back = rings.filter((r) => r.y >= shape.seat + 0.05 && r.fold === 0);
    ring = { ...back.reduce((best, r) => (Math.abs(r.y - y) < Math.abs(best.y - y) ? r : best)), y };
  } else {
    // straight round the bare back frame
    const b = backAt(shape, y);
    ring = { y, a: b.a + 0.004, front: b.front - 0.004, back: b.back + 0.004, n: 4, fold: 0 };
  }
  const surface = (yy: number) => (covered ? coverBackAt(rings, yy) + 0.006 : yy > shape.seat ? backAt(shape, yy).back + 0.008 : null);
  const lift = 0.006, bowZ = ring.back + lift + 0.012, up = V(0, 1, 0);
  const pts = Array.from({ length: 40 }, (_, k) => {
    const q = ringPoint(ring, k / 40), nx = q.x, nz = (q.z - q.cz) * (ring.a / Math.max(q.b, 1e-3)), l = Math.hypot(nx, nz) || 1;
    return V(q.x + (nx / l) * lift, y, q.z + (nz / l) * lift);
  });
  const bandCurve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const bandLen = bandCurve.getLength(), W = BAND_W;
  // cinched where it is tied: the band narrows into the knot at the middle of the back
  const pinch = (p: THREE.Vector3) => (p.z > ring.back - 0.02 ? Math.exp(-((p.x / 0.05) ** 2)) : 0);
  parts.push(strip(along(bandCurve, () => up, (s) => W * (1 - 0.6 * pinch(bandCurve.getPointAt(s)))), {
    rows: 120, length: bandLen, cup: 0.04,
    // gathered satin: fine pleats along the band, bunching up towards the knot
    bump: (s, v, f) => (0.0016 + 0.004 * pinch(f.p)) * Math.sin(s * bandLen * Math.PI * 2 / 0.034 + v * 2.4) * (0.6 + 0.4 * Math.sin(v * Math.PI)),
  }));

  // the bow, in the band's space at the middle of the back (z out from the chair)
  const o = V(0, y, bowZ);
  for (const side of [-1, 1]) {
    // a loop: out from the knot, round, and back in behind itself; its wing lifts a little
    const ctrl = [[0, 0, 0.004], [0.035, 0.006, 0.026], [0.09, 0.02, 0.03], [0.128, 0.026, 0.008], [0.118, 0.018, -0.008], [0.07, 0.006, -0.01], [0.012, 0, -0.006]];
    const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, yy, z]) => V(side * x, yy, z).add(o)), false, 'centripetal');
    const len = curve.getLength();
    parts.push(strip(along(curve, () => up, (s) => 0.07 * (0.34 + 0.66 * Math.sin(Math.PI * s) ** 0.65)), {
      rows: 36, length: len, cup: 0.12,
      // pleats where the ribbon is gathered into the knot, the loop full and smooth between
      bump: (s, v) => 0.0045 * Math.sin(v * Math.PI * 3) * (1 - Math.sin(Math.PI * s)) ** 2,
    }));
    // a tail: hung from under the knot and left to fall
    const start = V(side * 0.016, -0.014, 0.008).add(o), dir = V(side * 0.55, -1, 0.1).normalize();
    const TAIL = Math.min(0.5, y - 0.1); // sash tails fall most of the way to the floor
    const chain = drape(start, dir, TAIL, surface);
    const tail = new THREE.CatmullRomCurve3(chain, false, 'centripetal'), cut = 0.04 / TAIL;
    // the tail's face turns a little as it falls, the way a hung ribbon twists
    parts.push(strip(along(tail, (s) => V(side, 0, 0).applyAxisAngle(tail.getTangentAt(s), side * 0.4 * s), (s) => 0.066 * (1 + 0.14 * s)), {
      rows: 48, cols: 9, length: TAIL, cup: 0.05,
      sOf: (s, v) => Math.min(s, 1 - cut * (1 - Math.abs(2 * v - 1))), // the dovetail cut at its end
      // soft ripples across the width that wander as it falls, as hung satin never lies flat
      bump: (s, v) => 0.0055 * Math.sin(v * Math.PI * 1.6 + s * 7 + side) * Math.min(1, s * 3),
      sway: (s) => s * s,
    }));
  }
  // the knot: a short length of ribbon wrapped tight round the gathered middle
  const knot = new THREE.EllipseCurve(0, 0, 0.022, 0.012, 0, Math.PI * 2, false, 0);
  const knotCurve = new THREE.CatmullRomCurve3(knot.getPoints(24).slice(0, -1).map((q) => V(0, q.x, 0.008 + q.y).add(o)), true);
  // narrower where it is pulled tight behind, fuller and rounded over the front, creased across
  parts.push(strip(along(knotCurve, () => V(1, 0, 0), (s) => 0.03 + 0.008 * Math.max(0, Math.sin(s * Math.PI * 2))), {
    rows: 32, cols: 9, length: knotCurve.getLength(), cup: 0.2, bump: (_s, v) => 0.0012 * Math.sin(v * Math.PI * 2) * Math.sin(v * Math.PI),
  }));

  for (const p of parts) if (!p.attributes.aSway) p.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count), 1));
  return mergeGeometries(parts)!;
}

// ---------------------------------------------------------------------------
// Fabric surfaces

let weave: THREE.DataTexture | null = null;
/** A fine plain weave as a normal map: warp and weft threads crossing over and under. */
function weaveNormal() {
  if (weave) return weave;
  const S = 128, threads = 16, data = new Uint8Array(S * S * 4);
  const height = (x: number, y: number) => {
    const u = (x / S) * threads, v = (y / S) * threads, over = (Math.floor(u) + Math.floor(v)) % 2 === 0;
    const warp = Math.sin((u % 1) * Math.PI), weft = Math.sin((v % 1) * Math.PI);
    return over ? warp * 0.8 + weft * 0.2 : weft * 0.8 + warp * 0.2;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = height((x + 1) % S, y) - height((x + S - 1) % S, y), dy = height(x, (y + 1) % S) - height(x, (y + S - 1) % S);
    const n = V(-dx * 1.5, -dy * 1.5, 1).normalize(), k = (y * S + x) * 4;
    data[k] = (n.x * 0.5 + 0.5) * 255; data[k + 1] = (n.y * 0.5 + 0.5) * 255; data[k + 2] = (n.z * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  weave = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.generateMipmaps = true; weave.minFilter = THREE.LinearMipmapLinearFilter; weave.magFilter = THREE.LinearFilter;
  weave.anisotropy = 4;
  weave.needsUpdate = true;
  return weave;
}

const shaded = (c: string, toward: string, k: number) => new THREE.Color(c).lerp(new THREE.Color(toward), k);

// Each chair's swing (lib/clothSway), per instance: [x, z] how far the free end has swung and [twist] how far it
// has turned, in the chair's own space. A vertex moves by its share of it (aSway: 0 where the cloth is held,
// 1 at the hem or the tail's tip), rising a little as a pendulum does, so the hem never digs into the floor.
const SWING_GLSL = `
  vec3 sw = iSway * aSway;
  float cs = cos(sw.z), sn = sin(sw.z);
  transformed.xz = vec2(cs * transformed.x - sn * transformed.z, sn * transformed.x + cs * transformed.z);
  transformed.x += sw.x; transformed.z += sw.y;
  transformed.y += dot(sw.xy, sw.xy) / (2.0 * SWING_LEN);`;

function coverMaterial(color: string) {
  // banquet polyester: matte face, a soft sheen at grazing angles, the weave just visible up close
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.72, sheen: 0.6, sheenRoughness: 0.5, sheenColor: shaded(color, '#ffffff', 0.35),
    normalMap: weaveNormal(), normalScale: new THREE.Vector2(0.15, 0.15), vertexColors: true, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aSway;\nattribute vec3 iSway;\n#define SWING_LEN ${SKIRT.length.toFixed(2)}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${SWING_GLSL}`);
  };
  m.customProgramCacheKey = () => 'novira-cover';
  return m;
}

function satinMaterial(color: string, time: { value: number }) {
  // satin: a long, bright highlight streaking along the ribbon, a darker body colour on its turns
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.42, metalness: 0, anisotropy: 0.55, anisotropyRotation: 0,
    sheen: 0.35, sheenRoughness: 0.45, sheenColor: shaded(color, '#ffffff', 0.22), side: THREE.DoubleSide,
  });
  // the tails stir in the air; each chair's sway is out of step with its neighbours'
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aSway;\nattribute vec3 iSway;\nuniform float uTime;\n#define SWING_LEN ${TAIL.length.toFixed(2)}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = dot(instanceMatrix[3].xz, vec2(1.7, 2.3));
        #else
          float ph = 0.0;
        #endif
        float gust = sin(uTime * 0.9 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.3) * 0.4;
        transformed.x += aSway * 0.006 * gust;
        transformed.z += aSway * 0.004 * max(0.0, sin(uTime * 1.4 + ph * 0.7));${SWING_GLSL}`);
  };
  m.customProgramCacheKey = () => 'novira-satin';
  return m;
}

/** The air's clock, shared by every sash's sway. */
const AIR = { value: 0 };

// ---------------------------------------------------------------------------
// The cloth's physics: every dressed chair's skirt and sash tails are pendulums driven by the chair's movement

// polyester skirt: short, settles quickly; satin tails: longer and slippery, they swing on
const SKIRT: Fabric = { length: 0.42, damping: 0.32 };
const TAIL: Fabric = { length: 0.45, damping: 0.1, stiffness: 1.1 };
const SIM = new Map<string, { mover: Mover; skirt: Pendulum; tail: Pendulum; out: number[]; moving: boolean }>();
if (__DEV__) (globalThis as any).__noviraCloth = SIM; // for automated checks
/** Bumped whenever any chair's cloth moved this frame, so the batches know to copy the new swing. */
const swingClock = { frame: 0 };

function simulate(chairs: SceneObject[], dt: number) {
  let any = false;
  for (const o of chairs) {
    let c = SIM.get(o.id);
    if (!c) { c = { mover: newMover(), skirt: restingPendulum(), tail: restingPendulum(), out: [0, 0, 0, 0, 0, 0], moving: false }; SIM.set(o.id, c); }
    const yaw = o.rotation?.[1] || 0;
    track(c.mover, o.position[0], o.position[2], yaw, dt);
    const skirt = swing(c.skirt, SKIRT, c.mover, dt), tail = swing(c.tail, TAIL, c.mover, dt), moving = skirt || tail;
    if (!moving && !c.moving) continue;
    c.moving = moving;
    if (moving) { local(c.skirt, yaw, c.out, 0); local(c.tail, yaw, c.out, 3); } else c.out.fill(0);
    any = true;
  }
  if (any) swingClock.frame++;
}

// ---------------------------------------------------------------------------

function Batch({ chairs, geometry, material, shadows, part }: { chairs: SceneObject[]; geometry: THREE.BufferGeometry; material: THREE.Material; shadows?: boolean; part: 'cover' | 'sash' }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  // this batch's own view of the shared cloth, with a swing per chair
  const own = useMemo(() => {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(geometry.attributes)) g.setAttribute(name, a);
    g.setIndex(geometry.index);
    g.setAttribute('iSway', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, chairs.length) * 3), 3));
    return g;
  }, [geometry, chairs.length]);
  const shown = useRef(-1);
  /* eslint-disable react-hooks/immutability -- the instance attribute is three.js state, filled every frame the cloth moves */
  useFrame(() => {
    if (shown.current === swingClock.frame) return;
    shown.current = swingClock.frame;
    const attr = own.attributes.iSway as THREE.InstancedBufferAttribute, arr = attr.array as Float32Array, at = part === 'cover' ? 0 : 3;
    chairs.forEach((o, i) => { const c = SIM.get(o.id); arr[i * 3] = c ? c.out[at] : 0; arr[i * 3 + 1] = c ? c.out[at + 1] : 0; arr[i * 3 + 2] = c ? c.out[at + 2] : 0; });
    attr.needsUpdate = true;
  });
  /* eslint-enable react-hooks/immutability */
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    chairs.forEach((o, i) => { mesh.setMatrixAt(i, m.compose(p.set(...o.position), q.setFromEuler(e.set(0, o.rotation?.[1] || 0, 0)), one)); });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
  }, [chairs, own]);
  if (!chairs.length) return null;
  return <instancedMesh key={`${chairs.length}-${own.uuid}`} ref={ref} args={[own, material, chairs.length]} castShadow={!!shadows} receiveShadow userData={{ ids: chairs.map((o) => o.id), part: 'body' }} />;
}

export function ChairDressing({ objects }: { objects: SceneObject[] }) {
  const chairs = useMemo(() => objects.filter((o) => o.type === 'chair' && (o.spec?.cover || o.spec?.sash)), [objects]);
  const shapes = useChairShapes(); // each chair's measured silhouette, once its model has loaded
  useFrame((_, dt) => { AIR.value += Math.min(dt, 0.1); simulate(chairs, dt); });
  // chairs of one model and size share a shape; group by shape and colour so each batch is one draw
  const batches = useMemo(() => {
    const out: { key: string; color: string; kind: 'cover' | 'sash'; covered: boolean; shape: ChairShape; chairs: SceneObject[] }[] = [];
    const add = (kind: 'cover' | 'sash', color: string, covered: boolean, shape: ChairShape, o: SceneObject) => {
      const key = `${kind}|${color}|${covered}|${shape.key}`;
      (out.find((b) => b.key === key) || (out.push({ key, color, kind, covered, shape, chairs: [] }), out[out.length - 1])).chairs.push(o);
    };
    for (const o of chairs) {
      const shape = chairShape(o.id) || standardShape(...(o.size.map((v) => Math.round(v * 100) / 100) as [number, number, number]));
      if (o.spec?.cover) add('cover', o.spec.cover, !!o.spec?.sash, shape, o); // for a cover, `covered` says a sash rides on it (it shades the cloth)
      if (o.spec?.sash) add('sash', o.spec.sash, !!o.spec?.cover, shape, o);
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `shapes` is the version of the published shapes
  }, [chairs, shapes]);
  return (
    <group>
      {batches.map(({ key, ...b }) => <BatchFor key={key} {...b} />)}
    </group>
  );
}

function BatchFor({ kind, color, covered, shape, chairs }: { kind: 'cover' | 'sash'; color: string; covered: boolean; shape: ChairShape; chairs: SceneObject[] }) {
  const geometry = useMemo(() => (kind === 'cover' ? coverGeometry(shape, covered) : sashGeometry(shape, covered)), [kind, shape, covered]);
  const material = useMemo(() => (kind === 'cover' ? coverMaterial(color) : satinMaterial(color, AIR)), [kind, color]);
  useLayoutEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  // chairs near the camera wear every fold and cast shadows; further off, a fifth of the cloth does
  const { near, far } = useLodSplit(chairs, 13);
  const geos = useMemo(() => [geometry], [geometry]);
  const lite = useSimplified(geos, 0.2)?.[0];
  return (
    <>
      <Batch chairs={near} geometry={geometry} material={material} part={kind} shadows />
      <Batch chairs={far} geometry={lite || geometry} material={material} part={kind} />
    </>
  );
}
