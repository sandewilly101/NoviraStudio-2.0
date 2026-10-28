// Shared kit for built-to-measure event structures: real-world finishes
// (brushed aluminium, powder coat, velour, needle-punch carpet, non-slip deck,
// oak parquet, gloss panels, melamine) generated once as small canvas textures,
// plus helpers to place many identical parts as instanced meshes.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

export type M = THREE.Matrix4;
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
export const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8); // octagonal system posts

/** A box/cylinder part: frame x local transform (position, size, rotation). */
export const at = (frame: M, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot?: THREE.Euler) =>
  frame.clone().multiply(new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(rot || new THREE.Euler()), v3(sx, sy, sz)));
export const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rot?: THREE.Euler) => at(new THREE.Matrix4(), x, y, z, sx, sy, sz, rot);

/** A round tube of radius r from a to b. */
export function tube(a: THREE.Vector3, b: THREE.Vector3, r: number): M {
  const d = b.clone().sub(a), len = d.length();
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), v3(r, len, r));
}

/** Many identical parts, one draw call. */
export function Parts({ geo, material, items, shadows = true, part }: { geo: THREE.BufferGeometry; material: THREE.Material; items: M[]; shadows?: boolean; part?: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((x, i) => m.setMatrixAt(i, x));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  // `part` names the surface, so a material dropped on it knows what it landed on
  return <instancedMesh key={items.length} ref={ref} args={[geo, material, items.length]} castShadow={shadows} receiveShadow userData={{ part }} />;
}

/** A spotlight aimed at a point in the same local space (its target lives in the scene graph). */
export function Spot({ from, to, ...props }: { from: [number, number, number]; to: [number, number, number] } & Record<string, any>) {
  const light = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => { if (light.current) light.current.target = target; }, [target]);
  return (
    <>
      <primitive object={target} position={to} />
      <spotLight ref={light} position={from} {...props} />
    </>
  );
}

/** Collects parts by finish while a structure is being built. */
export class PartList {
  P = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; items: M[] }>();
  add(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, m: M) {
    let e = this.P.get(key);
    if (!e) this.P.set(key, (e = { geo, mat, items: [] }));
    e.items.push(m);
  }
}
export function RenderParts({ list }: { list: PartList }) {
  return <>{[...list.P.entries()].map(([k, e]) => <Parts key={k} part={k} geo={e.geo} material={e.mat} items={e.items} />)}</>;
}

// ---------- procedural surface textures (generated once) ----------
const texCache = new Map<string, THREE.Texture>();
function canvasTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, color = true) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
function noise(g: CanvasRenderingContext2D, s: number, base: number, spread: number, dots: number, r = 1) {
  g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, s, s);
  for (let i = 0; i < dots; i++) { const v = Math.max(0, Math.min(255, base + (rand() - 0.5) * spread)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rand() * s, rand() * s, r, r); }
}
export const TEX = {
  /** fine linear streaks of brushed/extruded aluminium */
  brushed: () => canvasTexture('brushed', 256, (g, s) => {
    g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) { const v = 150 + rand() * 90; g.fillStyle = `rgba(${v},${v},${v},0.35)`; g.fillRect(0, rand() * s, s, rand() * 1.4); }
  }, false),
  /** needle-punch exhibition carpet (greyscale, tinted by colour) */
  carpet: () => canvasTexture('carpet', 256, (g, s) => noise(g, s, 200, 110, 26000, 1.2)),
  /** velour pile: soft mottling for bump */
  pile: () => canvasTexture('pile', 256, (g, s) => noise(g, s, 128, 70, 18000, 1.5), false),
  /** non-slip stage deck: fine raised pattern */
  nonSlip: () => canvasTexture('nonSlip', 128, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#d0d0d0';
    for (let y = 0; y < s; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < s; x += 8) g.fillRect(x, y, 3, 3);
  }, false),
  /** oak parquet: staves with grain */
  oak: () => canvasTexture('oak', 512, (g, s) => {
    const sw = s / 8, sl = s / 2;
    for (let col = 0; col < 8; col++) for (let row = -1; row < 3; row++) {
      const y = row * sl + (col % 2 ? sl / 2 : 0), tone = 150 + rand() * 40;
      g.fillStyle = `rgb(${tone + 40},${tone + 5},${tone - 45})`; g.fillRect(col * sw, y, sw, sl);
      for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(90,55,25,${0.08 + rand() * 0.12})`; g.lineWidth = 0.6 + rand(); g.beginPath(); const x = col * sw + rand() * sw; g.moveTo(x, y); g.bezierCurveTo(x + rand() * 6 - 3, y + sl / 3, x + rand() * 6 - 3, y + (2 * sl) / 3, x + rand() * 4 - 2, y + sl); g.stroke(); }
      g.strokeStyle = 'rgba(40,25,10,.55)'; g.lineWidth = 1.2; g.strokeRect(col * sw, y, sw, sl);
    }
  }),
  /** starlit dance floor: tiny LEDs scattered on black */
  stars: () => canvasTexture('stars', 512, (g, s) => {
    g.fillStyle = '#050608'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) { const r = 0.8 + rand() * 1.4; g.fillStyle = `rgba(255,${235 + rand() * 20},${200 + rand() * 55},${0.6 + rand() * 0.4})`; g.beginPath(); g.arc(rand() * s, rand() * s, r, 0, Math.PI * 2); g.fill(); }
  }),
};

// ---------- finishes ----------
const matCache = new Map<string, THREE.Material>();
const cached = <T extends THREE.Material>(key: string, make: () => T): T => (matCache.get(key) as T) || (matCache.set(key, make()), matCache.get(key) as T);

export const FIN = {
  /** extruded / brushed aluminium (truss, posts, deck frames) */
  aluminium: (tone = '#C9CDD2') => cached(`alu${tone}`, () => new THREE.MeshStandardMaterial({ color: tone, metalness: 0.9, roughness: 0.32, roughnessMap: TEX.brushed(), metalnessMap: null })),
  /** powder-coated steel (base plates, stage legs, rails) */
  powder: (tone = '#1E2024') => cached(`pow${tone}`, () => new THREE.MeshStandardMaterial({ color: tone, metalness: 0.45, roughness: 0.6 })),
  chrome: () => cached('chrome', () => new THREE.MeshStandardMaterial({ color: '#E3E6EA', metalness: 1, roughness: 0.12 })),
  rubber: () => cached('rubber', () => new THREE.MeshStandardMaterial({ color: '#141516', metalness: 0, roughness: 0.95 })),
  /** cotton velour / stage skirting: soft pile with sheen at grazing angles */
  velour: (tone: string) => cached(`vel${tone}`, () => new THREE.MeshPhysicalMaterial({ color: tone, roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(tone).lerp(new THREE.Color('#ffffff'), 0.35), bumpMap: TEX.pile(), bumpScale: 0.6, side: THREE.DoubleSide })),
  satin: (tone: string) => cached(`sat${tone}`, () => new THREE.MeshPhysicalMaterial({ color: tone, roughness: 0.38, sheen: 1, sheenRoughness: 0.25, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide })),
  sheer: (tone: string) => cached(`she${tone}`, () => new THREE.MeshPhysicalMaterial({ color: tone, roughness: 0.7, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })),
  carpet: (tone: string) => cached(`car${tone}`, () => { const m = TEX.carpet(); return new THREE.MeshStandardMaterial({ color: tone, map: m, roughness: 1, bumpMap: m, bumpScale: 0.4 }); }),
  /** black plywood stage deck with a non-slip finish */
  deck: (tone = '#1C1E21') => cached(`deck${tone}`, () => new THREE.MeshStandardMaterial({ color: tone, roughness: 0.82, metalness: 0.05, bumpMap: TEX.nonSlip(), bumpScale: 0.35 })),
  gloss: (tone: string) => cached(`glo${tone}`, () => new THREE.MeshPhysicalMaterial({ color: tone, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 })),
  oak: () => cached('oak', () => new THREE.MeshPhysicalMaterial({ map: TEX.oak(), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.15 })),
  stars: () => cached('stars', () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: TEX.stars(), emissive: '#ffffff', emissiveMap: TEX.stars(), emissiveIntensity: 1.4, roughness: 0.15, clearcoat: 1 })),
  melamine: (tone = '#F4F4F1') => cached(`mel${tone}`, () => new THREE.MeshStandardMaterial({ color: tone, roughness: 0.5, metalness: 0 })),
  plastic: (tone: string) => cached(`pla${tone}`, () => new THREE.MeshStandardMaterial({ color: tone, roughness: 0.45, metalness: 0 })),
  glow: (tone: string) => cached(`glw${tone}`, () => new THREE.MeshBasicMaterial({ color: tone, toneMapped: false })),
  tape: (tone = '#F2F2F2') => cached(`tape${tone}`, () => new THREE.MeshStandardMaterial({ color: tone, roughness: 0.7 })),
};
