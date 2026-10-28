// One component per scene object type. Every object's origin is the centre of
// its footprint on the floor; size is [width, height, depth] in metres.
import { useGLTF } from '@react-three/drei';
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { fileUrl } from '@/lib/api';
import type { SceneObject } from '@/lib/types';
import { stripHelpers } from './modelHelpers';
import { Stage } from './StageDeck';

const MAT: Record<string, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.9, metalness: 0 }, gloss: { roughness: 0.25, metalness: 0.05 }, fabric: { roughness: 1, metalness: 0 },
  metal: { roughness: 0.35, metalness: 0.75 }, wood: { roughness: 0.7, metalness: 0 },
};
function Mat({ color, kind = 'matte', emissive, emissiveIntensity = 0, map }: { color: string; kind?: string; emissive?: string; emissiveIntensity?: number; map?: THREE.Texture | null }) {
  const m = MAT[kind] || MAT.matte;
  return <meshStandardMaterial color={map ? '#ffffff' : color} roughness={m.roughness} metalness={m.metalness} emissive={emissive || '#000000'} emissiveIntensity={emissiveIntensity} map={map || null} emissiveMap={emissive && map ? map : null} />;
}

// ---------- textures ----------
export function textTexture(text: string, sub = '', bg = '#0E2A4A', fg = '#FFFFFF', accent = '#C9A227', w = 1024, h = 576) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, bg); grad.addColorStop(1, shade(bg, -0.35));
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 120; g.font = `700 ${size}px Segoe UI, Arial`;
  while (g.measureText(text).width > w - 140 && size > 30) { size -= 6; g.font = `700 ${size}px Segoe UI, Arial`; }
  g.fillText(text, w / 2, sub ? h / 2 - 30 : h / 2);
  if (sub) { g.fillStyle = accent; g.font = `500 44px Segoe UI, Arial`; g.fillText(sub, w / 2, h / 2 + 70); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex); const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
  return '#' + c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt))).getHexString();
}
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
export function useImageTexture(url?: string) {
  return useMemo(() => {
    if (!url) return null;
    const t = loader.load(fileUrl(url)); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, [url]);
}
let floorTex: THREE.CanvasTexture | null = null;
function danceTexture() {
  if (floorTex) return floorTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#F2EEE6' : '#1B1B1F'; g.fillRect(i * 32, j * 32, 32, 32); }
  floorTex = new THREE.CanvasTexture(c); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  return floorTex;
}

// ---------- object types ----------
function Box({ size, y = 0, color, kind, emissive, ei, map, pos = [0, 0, 0] }: { size: [number, number, number]; y?: number; color: string; kind?: string; emissive?: string; ei?: number; map?: THREE.Texture | null; pos?: [number, number, number] }) {
  return <mesh position={[pos[0], y + size[1] / 2 + pos[1], pos[2]]} castShadow receiveShadow><boxGeometry args={size} /><Mat color={color} kind={kind} emissive={emissive} emissiveIntensity={ei} map={map} /></mesh>;
}


function LedScreen({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const img = useImageTexture(o.imageUrl);
  const txt = useMemo(() => (o.imageUrl ? null : textTexture(o.text?.content || o.name, o.text?.sub, o.color, o.text?.color, o.text?.accent)),
    [o.imageUrl, o.text?.content, o.text?.sub, o.color, o.text?.color, o.text?.accent]);
  useEffect(() => () => txt?.dispose(), [txt]);
  const map = img || txt;
  return (
    <group>
      <Box size={[w + 0.12, h + 0.12, d]} color="#0B1220" kind="matte" />
      <mesh position={[0, h / 2 + 0.06, d / 2 + 0.002]}><planeGeometry args={[w, h]} /><meshBasicMaterial map={map} toneMapped={false} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[s * w * 0.35, -o.position[1] / 2 + 0.03, 0]}><boxGeometry args={[0.08, Math.max(0.05, o.position[1]), 0.08]} /><meshStandardMaterial color="#2A2F3A" metalness={0.6} roughness={0.4} /></mesh>)}
    </group>
  );
}

function RoundTable({ o }: { o: SceneObject }) {
  const r = o.size[0] / 2, h = o.size[1];
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[r, r + 0.04, h, 40, 1, true]} /><Mat color={o.color} kind="fabric" /></mesh>
      <mesh position={[0, h, 0]} receiveShadow><cylinderGeometry args={[r, r, 0.02, 40]} /><Mat color={o.color} kind="fabric" /></mesh>
    </group>
  );
}

function LongTable({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  return <group><Box size={[w, h - 0.02, d]} color={o.color} kind="fabric" /><Box size={[w + 0.06, 0.02, d + 0.06]} y={h - 0.02} color={o.color} kind="fabric" /></group>;
}

function CocktailTable({ o }: { o: SceneObject }) {
  const r = o.size[0] / 2, h = o.size[1];
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow><cylinderGeometry args={[r * 0.55, r + 0.05, h, 28, 1, true]} /><Mat color={o.color} kind="fabric" /></mesh>
      <mesh position={[0, h, 0]}><cylinderGeometry args={[r, r, 0.02, 28]} /><Mat color={o.color} kind="fabric" /></mesh>
    </group>
  );
}

const legGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 6);
function Chair({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const seatY = h * 0.49, m = o.material || 'metal';
  return (
    <group>
      <Box size={[w, 0.05, d]} y={seatY} color={o.color} kind={m} />
      <Box size={[w * 0.95, h - seatY - 0.05, 0.04]} y={seatY + 0.05} pos={[0, 0, d / 2 - 0.03]} color={o.color} kind={m} />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => (
        <mesh key={i} geometry={legGeo} position={[x * (w / 2 - 0.03), seatY / 2, z * (d / 2 - 0.03)]} scale={[1, seatY, 1]}><Mat color={o.color} kind={m} /></mesh>
      ))}
      <Box size={[w * 0.9, 0.04, d * 0.9]} y={seatY + 0.05} color="#F3EEE2" kind="fabric" />
    </group>
  );
}

function Centrepiece({ o }: { o: SceneObject }) {
  const [w, h] = o.size;
  return (
    <group>
      <mesh position={[0, h * 0.35, 0]}><cylinderGeometry args={[w * 0.18, w * 0.25, h * 0.7, 12]} /><Mat color={o.color} kind="metal" /></mesh>
      <mesh position={[0, h * 0.8, 0]}><sphereGeometry args={[w * 0.5, 14, 10]} /><Mat color="#E7A3B4" kind="fabric" /></mesh>
    </group>
  );
}

function Bar({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  return <group><Box size={[w, h - 0.05, d]} color={o.color} kind="wood" /><Box size={[w + 0.1, 0.05, d + 0.05]} y={h - 0.05} color="#151515" kind="gloss" /></group>;
}

function Speaker({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  return <group><Box size={[w, h, d]} color={o.color} kind="matte" />{[0.25, 0.6].map((f) => <mesh key={f} position={[0, h * f, d / 2 + 0.005]}><circleGeometry args={[w * 0.32, 20]} /><meshStandardMaterial color="#0C0E12" roughness={0.6} /></mesh>)}</group>;
}

function Sofa({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  return (
    <group>
      <Box size={[w, h * 0.5, d]} color={o.color} kind="fabric" />
      <Box size={[w, h * 0.5, d * 0.25]} y={h * 0.5} pos={[0, 0, d * 0.375]} color={o.color} kind="fabric" />
      {[-1, 1].map((s) => <Box key={s} size={[0.18, h * 0.3, d]} y={h * 0.5} pos={[s * (w / 2 - 0.09), 0, 0]} color={o.color} kind="fabric" />)}
    </group>
  );
}

function DanceFloor({ o }: { o: SceneObject }) {
  const [w, , d] = o.size;
  const tex = useMemo(() => { const t = danceTexture().clone(); t.repeat.set(w / 2.4, d / 2.4); t.needsUpdate = true; return t; }, [w, d]);
  return <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[w, d]} /><meshStandardMaterial map={tex} roughness={0.2} metalness={0.1} /></mesh>;
}

function Sign({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const img = useImageTexture(o.imageUrl);
  const txt = useMemo(() => (o.imageUrl ? null : textTexture(o.text?.content || o.name, o.text?.sub, o.color, o.text?.color, o.text?.accent, 768, Math.round(768 * h / w))), [o.imageUrl, o.text?.content, o.text?.sub, o.color, o.text?.color, o.text?.accent, w, h]);
  return (
    <group>
      <Box size={[w, h, d]} color="#FFFFFF" kind="matte" />
      <mesh position={[0, h / 2, d / 2 + 0.002]}><planeGeometry args={[w * 0.98, h * 0.98]} /><meshStandardMaterial map={img || txt} roughness={0.6} /></mesh>
    </group>
  );
}

function Model({ o }: { o: SceneObject }) {
  const gltf = useGLTF(fileUrl(o.modelUrl));
  const node = useMemo(() => {
    const scene = stripHelpers(gltf.scene.clone(true));
    // modelled lying down: stood up on its long axis (spec.upright, decided when it was sourced)
    if (o.spec?.upright === 'x') scene.rotation.z = Math.PI / 2;
    else if (o.spec?.upright === 'z') scene.rotation.x = -Math.PI / 2;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const k = Math.min(o.size[0] / (size.x || 1), o.size[1] / (size.y || 1), o.size[2] / (size.z || 1));
    const wrap = new THREE.Group();
    scene.position.set(-centre.x, -box.min.y, -centre.z);
    wrap.add(scene); wrap.scale.setScalar(k);
    wrap.traverse((n: any) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    return wrap;
  }, [gltf, o.size[0], o.size[1], o.size[2], o.spec?.upright]);
  return <primitive object={node} />;
}

// One unreadable model shows a placeholder box instead of taking down the whole 3D view.
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { console.warn('[novira] model failed to load:', e.message); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function ObjectBody({ o }: { o: SceneObject }) {
  switch (o.type) {
    case 'stage': return <Stage o={o} />;
    case 'led_screen': return <LedScreen o={o} />;
    case 'round_table': return <RoundTable o={o} />;
    case 'long_table': return <LongTable o={o} />;
    case 'cocktail_table': return <CocktailTable o={o} />;
    case 'chair': return <Chair o={o} />;
    case 'centrepiece': return <Centrepiece o={o} />;
    case 'bar': return <Bar o={o} />;
    case 'speaker': return <Speaker o={o} />;
    case 'lectern': return <Box size={o.size} color={o.color} kind={o.material || 'wood'} />;
    case 'sofa': return <Sofa o={o} />;
    case 'dance_floor': return <DanceFloor o={o} />;
    case 'sign': return <Sign o={o} />;
    case 'model': return o.modelUrl
      ? <ModelBoundary fallback={<Box size={o.size} color="#E8A0A0" />}><Suspense fallback={<Box size={o.size} color="#CBD3DD" />}><Model o={o} /></Suspense></ModelBoundary>
      : <Box size={o.size} color={o.color} />;
    default: return <Box size={o.size} color={o.color} kind={o.material} />;
  }
}
