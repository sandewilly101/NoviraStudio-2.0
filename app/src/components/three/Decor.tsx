// Decor that event designers hang and dress, built to measure:
//  · Chandelier — crystal waterfall (tiered brass rings hung with strands of
//    crystal drops round warm bulbs), candle (scrolled brass arms with candle
//    sleeves) or crystal ball; it hangs from the ceiling on a rod.
//  · Ceiling drape — fabric swags under the ceiling, sagging like real cloth
//    between their fixings and gathered narrow at each end; parallel runs or
//    radiating from a centre (a draped "canopy").
//  · Wedding arch — round, square canopy or hexagon frame in gold, white or
//    wood, with fabric swagged over the top and side panels tied back, and
//    flower clusters at the corners.
// Object space: centred on x/z; chandelier and drape: y = 0 is the fixture's
// bottom / the fixing height; arch: floor at y = 0.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { finishFor } from '@/lib/finish';
import { BOX, CYL, FIN, PartList, Parts, RenderParts, place, tube, v3 } from './kit';
import { DRAPE_FABRICS } from './Drape';

const cache = new Map<string, THREE.Material>();
const mat = (key: string, make: () => THREE.Material) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key)!; };
const BRASS = () => mat('brass', () => new THREE.MeshStandardMaterial({ color: '#C9A24A', metalness: 1, roughness: 0.28 }));
const CRYSTAL = () => mat('crystal', () => new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', metalness: 0, roughness: 0.03, transparent: true, opacity: 0.55, clearcoat: 1, clearcoatRoughness: 0, emissive: '#FFE4B8', emissiveIntensity: 0.18, ior: 1.5 }));
const BULB = () => mat('bulb', () => new THREE.MeshBasicMaterial({ color: '#FFD9A0', toneMapped: false }));
const SPHERE = new THREE.SphereGeometry(1, 12, 8);
const DROP = (() => { const g = new THREE.OctahedronGeometry(1, 0); g.scale(0.6, 1.2, 0.6); return g; })(); // a cut-glass prism

// ---------- chandelier ----------
export function Chandelier({ o, light = false }: { o: SceneObject; light?: boolean }) {
  const [D, H] = o.size, R = D / 2, drop = Number(o.spec?.drop ?? 0.8), variant = o.variant || 'crystal-tiered';
  const parts = useMemo(() => {
    const L = new PartList(), brass = BRASS(), crystal = CRYSTAL(), bulb = BULB();
    const rng = (i: number) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
    L.add('rod', CYL, brass, tube(v3(0, H, 0), v3(0, H + drop, 0), 0.012));
    L.add('canopy', CYL, brass, place(0, H + drop - 0.02, 0, 0.09, 0.04, 0.09));
    if (variant === 'candle-gold') {
      L.add('column', CYL, brass, tube(v3(0, H * 0.15, 0), v3(0, H, 0), 0.035));
      L.add('bowl', SPHERE, brass, place(0, H * 0.18, 0, 0.12, 0.08, 0.12));
      for (const [tier, r, y] of [[0, R, H * 0.32], [1, R * 0.62, H * 0.62]] as const) {
        const arms = tier === 0 ? 8 : 6;
        for (let i = 0; i < arms; i++) {
          const a = (i / arms) * Math.PI * 2 + tier * 0.3, x = Math.cos(a) * r, z = Math.sin(a) * r;
          L.add('arm', CYL, brass, tube(v3(Math.cos(a) * 0.05, y - 0.06, Math.sin(a) * 0.05), v3(x * 0.7, y - 0.1, z * 0.7), 0.011));
          L.add('arm', CYL, brass, tube(v3(x * 0.7, y - 0.1, z * 0.7), v3(x, y, z), 0.011));
          L.add('cup', CYL, brass, place(x, y + 0.01, z, 0.04, 0.02, 0.04));
          L.add('candle', CYL, FIN.melamine('#F6F0E2'), place(x, y + 0.08, z, 0.014, 0.13, 0.014));
          L.add('flame', SPHERE, bulb, place(x, y + 0.17, z, 0.014, 0.028, 0.014));
          for (let k = 0; k < 3; k++) L.add('drop', DROP, crystal, place(x * (0.8 - k * 0.12), y - 0.14 - k * 0.04, z * (0.8 - k * 0.12), 0.012, 0.022, 0.012));
        }
      }
    } else if (variant === 'crystal-ball') {
      // a sphere of crystal strands round a cluster of bulbs
      for (let i = 0; i < 260; i++) {
        const u = rng(i + 1) * 2 - 1, t = rng(i + 7) * Math.PI * 2, s = Math.sqrt(1 - u * u);
        L.add('drop', DROP, crystal, place(Math.cos(t) * s * R, H / 2 + u * (H / 2), Math.sin(t) * s * R, 0.018, 0.03, 0.018));
      }
      for (let i = 0; i < 6; i++) L.add('bulb', SPHERE, bulb, place(Math.cos(i) * R * 0.3, H / 2 + Math.sin(i * 2) * 0.1, Math.sin(i) * R * 0.3, 0.035, 0.035, 0.035));
    } else {
      // waterfall: three brass rings, strands of drops falling from each (longest at the outer ring)
      const tiers = [[R, H * 0.92, H * 0.85], [R * 0.72, H * 0.98, H * 0.62], [R * 0.42, H, H * 0.4]] as const;
      tiers.forEach(([r, y, len], t) => {
        L.add('ring', CYL, brass, place(0, y, 0, r, 0.025, r));
        const strands = Math.max(12, Math.round((2 * Math.PI * r) / 0.06));
        for (let i = 0; i < strands; i++) {
          const a = (i / strands) * Math.PI * 2 + t * 0.07, x = Math.cos(a) * r * 0.97, z = Math.sin(a) * r * 0.97;
          const n = Math.max(3, Math.round((len * (0.85 + 0.15 * rng(i + t * 97))) / 0.045));
          for (let k = 0; k < n; k++) L.add('drop', DROP, crystal, place(x, y - 0.03 - k * 0.045, z, 0.011, 0.02, 0.011));
        }
      });
      L.add('stem', CYL, brass, tube(v3(0, H * 0.3, 0), v3(0, H, 0), 0.02));
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; L.add('bulb', SPHERE, bulb, place(Math.cos(a) * R * 0.45, H * (0.45 + 0.25 * (i % 3) / 2), Math.sin(a) * R * 0.45, 0.03, 0.04, 0.03)); }
    }
    return L;
  }, [R, H, drop, variant]);
  return (
    <group>
      <RenderParts list={parts} />
      {/* a real warm light from inside it (only the first few chandeliers: each costs every surface) */}
      {light && o.spec?.on !== false ? <pointLight position={[0, H * 0.55, 0]} color="#FFD3A0" intensity={Number(o.spec?.intensity ?? 1) * 9} distance={10} decay={2} /> : null}
    </group>
  );
}

// ---------- ceiling drape ----------
/** One swag: a strip of cloth hanging in a curve between two fixings, gathered narrow at the ends, folds along it. */
function swagGeometry(L: number, sag: number, w: number) {
  const g = new THREE.PlaneGeometry(L, w, 80, 14);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), v = p.getY(i) / w, u = x / (L / 2); // u: -1..1 along, v: -0.5..0.5 across
    const gather = 0.18 + 0.82 * Math.sin(((u + 1) / 2) * Math.PI); // narrow at the fixings, full in the middle
    const drop = -sag * (1 - u * u) * (1 + 0.12 * (0.25 - v * v)); // the middle of the cloth hangs a little lower than its edges
    const fold = 0.035 * gather * Math.sin(v * Math.PI * 7 + u * 1.3);
    p.setXYZ(i, x, drop + fold, v * w * gather);
  }
  g.computeVertexNormals();
  return g;
}
export function CeilingDrape({ o }: { o: SceneObject }) {
  const [span, sag, spread] = o.size, count = Math.max(1, Math.min(16, Number(o.spec?.count ?? 3))), radial = o.spec?.layout === 'radial';
  const fab = DRAPE_FABRICS[o.variant || 'ivory'] || DRAPE_FABRICS.ivory, tone = o.color || fab.color;
  const material = finishFor(o, 'fabric', fab.fabric === 'sheer' ? FIN.sheer(tone) : fab.fabric === 'satin' ? FIN.satin(tone) : FIN.velour(tone), { side: THREE.DoubleSide });
  const width = Number(o.spec?.width ?? 1.1);
  const geo = useMemo(() => swagGeometry(radial ? span / 2 : span, sag, width), [span, sag, width, radial]);
  return (
    <group>
      {Array.from({ length: count }, (_, i) => {
        if (radial) {
          // from the centre out, like the spokes of a draped canopy
          const a = (i / count) * Math.PI;
          return <mesh key={i} geometry={geo} material={material} position={[0, 0, 0]} rotation={[0, a, 0]} castShadow={fab.fabric !== 'sheer'} receiveShadow userData={{ part: 'fabric' }} />;
        }
        const z = count > 1 ? -spread / 2 + (i / (count - 1)) * spread : 0;
        return <mesh key={i} geometry={geo} material={material} position={[0, 0, z]} castShadow={fab.fabric !== 'sheer'} receiveShadow userData={{ part: 'fabric' }} />;
      })}
      {radial ? <mesh geometry={SPHERE} material={material} position={[0, -0.12, 0]} scale={[0.35, 0.22, 0.35]} /> : null}
    </group>
  );
}

// ---------- wedding arch ----------
const FRAMES: Record<string, () => THREE.Material> = {
  gold: BRASS,
  white: () => FIN.plastic('#F4F2EC'),
  wood: () => mat('archwood', () => new THREE.MeshStandardMaterial({ color: '#7A5534', roughness: 0.7 })),
  black: () => FIN.powder('#1E2024'),
};
/** A gathered fabric panel hanging from (0, top) down to the floor, pinched at a tie-back height. */
function panelGeometry(w: number, h: number, tie: number) {
  const g = new THREE.PlaneGeometry(w, h, 18, 30);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) + h / 2, t = Math.abs(y - tie) / Math.max(tie, h - tie);
    const pinch = 0.22 + 0.78 * Math.min(1, t * 1.3); // narrow at the tie, flaring above and below
    p.setXYZ(i, x * pinch, y, 0.03 * Math.sin((x / w) * Math.PI * 6) * pinch);
  }
  g.computeVertexNormals();
  return g;
}
export function WeddingArch({ o }: { o: SceneObject }) {
  const [W, H, D] = o.size, shape = o.variant || 'square', post = 0.035;
  const flowers: string[] = (Array.isArray(o.spec?.flowers) ? o.spec.flowers : o.spec?.flowers ? [o.spec.flowers] : ['#F5F0E8', '#B5553C', '#7A1E2C']).slice(0, 3);
  const flowerKey = flowers.join('|');
  const fabricOn = o.spec?.fabric !== false;
  const frameMat = (FRAMES[o.spec?.frame || 'gold'] || FRAMES.gold)();
  const frame = useMemo(() => {
    const L = new PartList();
    if (shape === 'round') {
      for (const x of [-W / 2, W / 2]) L.add('post', CYL, frameMat, tube(v3(x, 0, 0), v3(x, H - W / 2, 0), post));
      const seg = 24;
      for (let i = 0; i < seg; i++) {
        const a0 = Math.PI - (i / seg) * Math.PI, a1 = Math.PI - ((i + 1) / seg) * Math.PI, c = H - W / 2;
        L.add('arc', CYL, frameMat, tube(v3(Math.cos(a0) * W / 2, c + Math.sin(a0) * W / 2, 0), v3(Math.cos(a1) * W / 2, c + Math.sin(a1) * W / 2, 0), post));
      }
      for (const x of [-W / 2, W / 2]) L.add('foot', BOX, frameMat, place(x, 0.01, 0, 0.3, 0.02, 0.3));
    } else {
      const n = shape === 'hexagon' ? 6 : 4, corners = Array.from({ length: n }, (_, i) => {
        const a = shape === 'hexagon' ? (i / n) * Math.PI * 2 : [Math.PI * 0.75, Math.PI * 0.25, -Math.PI * 0.25, -Math.PI * 0.75][i];
        return shape === 'hexagon' ? v3(Math.cos(a) * W / 2, 0, Math.sin(a) * D / 2) : v3(Math.sign(Math.cos(a)) * W / 2, 0, Math.sign(Math.sin(a)) * D / 2);
      });
      corners.forEach((c, i) => {
        const nx = corners[(i + 1) % n];
        L.add('post', CYL, frameMat, tube(c, v3(c.x, H, c.z), post));
        L.add('top', CYL, frameMat, tube(v3(c.x, H, c.z), v3(nx.x, H, nx.z), post * 0.9));
        L.add('foot', BOX, frameMat, place(c.x, 0.01, c.z, 0.25, 0.02, 0.25));
      });
    }
    return L;
  }, [W, H, D, shape, frameMat]);
  const fab = DRAPE_FABRICS[o.spec?.drape || 'ivory'] || DRAPE_FABRICS.ivory, tone = o.color || fab.color;
  const cloth = finishFor(o, 'fabric', fab.fabric === 'sheer' ? FIN.sheer(tone) : FIN.satin(tone), { side: THREE.DoubleSide });
  const swag = useMemo(() => swagGeometry(W + 0.1, 0.45, 0.7), [W]);
  const panel = useMemo(() => panelGeometry(0.9, H, H * 0.42), [H]);
  // flower clusters at the top corners (round: on the crown and at one side), each a mound of blooms in the chosen colours with leaves
  const blooms = useMemo(() => {
    const spots = shape === 'round' ? [v3(-W * 0.22, H - 0.05, 0), v3(W * 0.3, H - W * 0.2, 0), v3(-W / 2, H * 0.35, 0)] : [v3(-W / 2, H, D / 2), v3(W / 2, H, D / 2)];
    const byColour = flowers.map(() => [] as THREE.Matrix4[]), leaves: THREE.Matrix4[] = [];
    let k = 1;
    for (const s of spots) for (let i = 0; i < 46; i++) {
      const r = () => (Math.sin(k++ * 78.233) * 43758.5453) % 1;
      const a = r() * Math.PI * 2, u = r(), d = 0.38 * Math.sqrt(Math.abs(u)), size = 0.045 + Math.abs(r()) * 0.05;
      const m = place(s.x + Math.cos(a) * d, s.y + Math.abs(r()) * 0.16 - 0.05, s.z + Math.sin(a) * d * 0.7, size, size * 0.8, size);
      if (i % 4 === 3) leaves.push(place(s.x + Math.cos(a) * (d + 0.08), s.y - 0.04, s.z + Math.sin(a) * (d + 0.08) * 0.7, 0.09, 0.02, 0.04, new THREE.Euler(0, a, 0.4)));
      else byColour[i % flowers.length].push(m);
    }
    return { byColour, leaves };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the colours are keyed by flowerKey
  }, [W, H, D, shape, flowerKey]);
  return (
    <group>
      <RenderParts list={frame} />
      {fabricOn && (
        <>
          <mesh geometry={swag} material={cloth} position={[0, H + 0.02, shape === 'round' ? 0.06 : D / 2]} castShadow receiveShadow userData={{ part: 'fabric' }} />
          {[-1, 1].map((s) => <mesh key={s} geometry={panel} material={cloth} position={[s * (W / 2 - 0.15), 0, shape === 'round' ? 0.06 : D / 2]} castShadow receiveShadow userData={{ part: 'fabric' }} />)}
        </>
      )}
      {blooms.byColour.map((items, i) => <Parts key={i} geo={SPHERE} material={mat(`petal${flowers[i]}`, () => new THREE.MeshStandardMaterial({ color: flowers[i], roughness: 0.75 }))} items={items} part="flowers" />)}
      <Parts geo={SPHERE} material={mat('leaf', () => new THREE.MeshStandardMaterial({ color: '#4F6B3A', roughness: 0.7 }))} items={blooms.leaves} part="flowers" />
    </group>
  );
}
