// Renders every object of one type with its real sourced model, using one
// InstancedMesh per sub-mesh so 128 chairs cost a handful of draw calls.
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { fileUrl } from '@/lib/api';
import type { CatalogItem } from '@/lib/catalog';
import type { SceneObject } from '@/lib/types';
import { stripHelpers } from './modelHelpers';
import { finishMaterial } from '@/lib/finish';
import { useLodSplit, useSimplified } from '@/lib/lod';
import { measureBands, publishShapes, shapeOf, withdrawShapes, type ChairShape } from '@/lib/chairShape';

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 };
type Template = { parts: Part[]; size: THREE.Vector3 };

/**
 * Whether a chair model has its backrest on the front side (-z): models from different libraries face
 * different ways. The backrest is the tallest part, so look where the top fifth of the chair lies.
 */
function backIsInFront(holder: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(holder), top = box.max.y - (box.max.y - box.min.y) * 0.2, mid = (box.min.z + box.max.z) / 2;
  let sum = 0, n = 0;
  const v = new THREE.Vector3();
  holder.traverse((m: any) => {
    const pos = m.isMesh && m.geometry?.attributes?.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 2000))) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y >= top) { sum += v.z - mid; n++; }
    }
  });
  return n > 20 && sum / n < -0.02 * (box.max.z - box.min.z);
}

// Orient the model (yaw/pitch), then express every mesh relative to a
// footprint-centred origin on the floor.
function buildTemplate(root: THREE.Object3D, item: CatalogItem): Template {
  const holder = new THREE.Group();
  const inner = stripHelpers(root.clone(true));
  inner.rotation.set(item.pitch || 0, item.yaw || 0, 0, 'YXZ');
  holder.add(inner);
  holder.updateMatrixWorld(true);
  if (item.type === 'chair' && backIsInFront(holder)) { inner.rotation.y += Math.PI; holder.updateMatrixWorld(true); }
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const toOrigin = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
  const parts: Part[] = [];
  holder.traverse((n: any) => {
    if (n.isMesh) parts.push({ geometry: n.geometry, material: n.material, matrix: toOrigin.clone().multiply(n.matrixWorld) });
  });
  return { parts, size };
}

function objectScale(o: SceneObject, item: CatalogItem, size: THREE.Vector3, modelHeight: number) {
  const [w, , d] = o.size;
  const h = modelHeight;
  if (item.stretch) return new THREE.Vector3(w / (size.x || 1), h / (size.y || 1), d / (size.z || 1));
  const k = Math.min(w / (size.x || 1), h / (size.y || 1), d / (size.z || 1));
  return new THREE.Vector3(k, k, k);
}

const STAND_HEIGHT_SHARE = 0.62; // speakers: the lower part of the object's height is the tripod
const modelHeightFor = (o: SceneObject, item: CatalogItem) => (item.stand ? o.size[1] * (1 - STAND_HEIGHT_SHARE) : o.size[1]);
const modelLiftFor = (o: SceneObject, item: CatalogItem) => (item.stand ? o.size[1] * STAND_HEIGHT_SHARE : 0);

const GLASS = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.03, transmission: 0, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.5, specularIntensity: 1, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });

function InstancedSet({ item, objects, onPick }: { item: CatalogItem; objects: SceneObject[]; onPick?: (o: SceneObject, e: ThreeEvent<MouseEvent>) => void }) {
  const gltf = useGLTF(fileUrl(item.file_url));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the orientation affects the template
  const tpl = useMemo(() => buildTemplate(gltf.scene, item), [gltf.scene, item.yaw, item.pitch]);
  // only tint when the user picked a colour for this object
  const tinted = objects.some((o) => o.tint);
  const body = objects[0]?.finish?.body; // groups are split by finish, so they all share it
  const materials = useMemo(() => tpl.parts.map((p) => {
    if (item.glass) return GLASS; // glassware: clear, glossy, refracting — whatever the file's own material says
    if (body) return finishMaterial(body, { side: THREE.DoubleSide });
    if (!tinted) return p.material;
    const clone = (m: THREE.Material) => { const c = m.clone() as any; if (c.color) c.color.set('#ffffff'); return c; };
    return Array.isArray(p.material) ? p.material.map(clone) : clone(p.material);
  }), [tpl, tinted, body, item.glass]);

  // a chair's silhouette, so its cover and sash can be tailored to it
  const isChair = objects[0]?.type === 'chair';
  const bands = useMemo(() => (isChair ? measureBands(tpl.parts, tpl.size.y) : null), [tpl, isChair]);
  useLayoutEffect(() => {
    if (!bands) return;
    const shapes = new Map<string, ChairShape | null>(), out: [string, ChairShape][] = [];
    for (const o of objects) {
      const scale = objectScale(o, item, tpl.size, modelHeightFor(o, item)), k = scale.toArray().map((v) => v.toFixed(4)).join();
      if (!shapes.has(k)) shapes.set(k, shapeOf(bands, scale));
      const s = shapes.get(k);
      if (s) out.push([o.id, s]);
    }
    publishShapes(out);
    return () => withdrawShapes(out.map(([id]) => id));
  }, [bands, objects, item, tpl]);

  // near the camera: every detail, casting shadows; further off: a lighter mesh without shadows;
  // tableware far off is smaller than a pixel and isn't drawn at all
  const reach = Math.max(...(objects[0]?.size || [1]));
  const tiny = reach < 0.45;
  const { near, far } = useLodSplit(objects, tiny ? 14 : 12 + 4 * Math.min(2, reach));
  const heavy = tpl.parts.reduce((n, p) => n + (p.geometry.index?.count ?? p.geometry.attributes.position.count) / 3, 0) > 3000;
  const fullGeos = useMemo(() => tpl.parts.map((p) => p.geometry), [tpl]);
  const liteGeos = useSimplified(fullGeos, heavy ? 0.15 : 0.35);

  const click = onPick ? (list: SceneObject[]) => (e: ThreeEvent<MouseEvent>) => { if (e.instanceId != null && list[e.instanceId]) { e.stopPropagation(); onPick(list[e.instanceId], e); } } : undefined;
  const batch = { item, tpl, materials, tinted, tag: `${tinted}-${body?.slug}` };
  return (
    <group>
      <Batch {...batch} list={near} geometries={fullGeos} shadows onClick={click?.(near)} />
      {!tiny && far.length > 0 && <Batch {...batch} list={far} geometries={liteGeos || fullGeos} onClick={click?.(far)} />}
      {item.stand && <Stands objects={objects} onClick={click?.(objects)} />}
    </group>
  );
}

/** One instanced mesh per part of the model, for these objects. */
function Batch({ item, tpl, materials, tinted, tag, list, geometries, shadows, onClick }: {
  item: CatalogItem; tpl: Template; materials: (THREE.Material | THREE.Material[])[]; tinted: boolean; tag: string;
  list: SceneObject[]; geometries: THREE.BufferGeometry[]; shadows?: boolean; onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), white = new THREE.Color('#ffffff'), tint = new THREE.Color();
    list.forEach((o, i) => {
      const scale = objectScale(o, item, tpl.size, modelHeightFor(o, item));
      q.setFromEuler(new THREE.Euler(0, o.rotation?.[1] || 0, 0));
      m.compose(new THREE.Vector3(o.position[0], o.position[1] + modelLiftFor(o, item), o.position[2]), q, scale);
      refs.current.forEach((mesh, pi) => {
        if (!mesh) return;
        mesh.setMatrixAt(i, m.clone().multiply(tpl.parts[pi].matrix));
        if (tinted) mesh.setColorAt(i, o.tint ? tint.set(o.color) : white);
      });
    });
    refs.current.forEach((mesh) => {
      if (!mesh) return;
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
        // a material compiled before the instance colours existed ignores them: recompile it once so the tint shows
        if (!mesh.userData.tintReady) { (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mt) => { mt.needsUpdate = true; }); mesh.userData.tintReady = true; }
      }
      mesh.computeBoundingSphere();
    });
  }, [list, tpl, item, tinted, geometries]);
  if (!list.length) return null;
  return (
    <>
      {geometries.map((g, i) => (
        <instancedMesh key={`${i}-${list.length}-${tag}-${g.uuid}`} ref={(r) => { refs.current[i] = r; }} args={[g, materials[i] as any, list.length]} castShadow={!!shadows} receiveShadow frustumCulled={false} onClick={onClick} userData={{ ids: list.map((o) => o.id), part: 'body' }} />
      ))}
    </>
  );
}

// Tripod stands for speakers: pole + three legs.
const poleGeo = new THREE.CylinderGeometry(0.018, 0.022, 1, 10);
const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);
const standMat = new THREE.MeshStandardMaterial({ color: '#1C1E22', metalness: 0.7, roughness: 0.35 });
function Stands({ objects, onClick }: { objects: SceneObject[]; onClick?: (e: ThreeEvent<MouseEvent>) => void }) {
  const pole = useRef<THREE.InstancedMesh>(null), legs = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    objects.forEach((o, i) => {
      const h = o.size[1] * STAND_HEIGHT_SHARE;
      m.compose(new THREE.Vector3(o.position[0], o.position[1] + h / 2, o.position[2]), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      pole.current?.setMatrixAt(i, m);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + (o.rotation?.[1] || 0), spread = 0.45, legLen = Math.hypot(spread, h * 0.45);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a) * spread, -h * 0.45, Math.sin(a) * spread).normalize());
        m.compose(new THREE.Vector3(o.position[0] + Math.cos(a) * spread / 2, o.position[1] + h * 0.225, o.position[2] + Math.sin(a) * spread / 2), q, new THREE.Vector3(1, legLen, 1));
        legs.current?.setMatrixAt(i * 3 + k, m);
      }
    });
    for (const r of [pole.current, legs.current]) if (r) { r.instanceMatrix.needsUpdate = true; r.computeBoundingSphere(); }
  }, [objects]);
  return (
    <>
      <instancedMesh key={`p${objects.length}`} ref={pole} args={[poleGeo, standMat, objects.length]} castShadow onClick={onClick} />
      <instancedMesh key={`l${objects.length}`} ref={legs} args={[legGeo, standMat, objects.length * 3]} castShadow />
    </>
  );
}

// Floor-length banquet linen as it really hangs, one instanced mesh for all
// tables: the cloth breaks over a soft rounded table edge, falls straight for
// a hand's width, then opens into folds that deepen (with a little
// irregularity) towards a hem that just kisses the floor.
function linenGeometry() {
  const seg = 160, rings = 26, positions: number[] = [], idx: number[] = [];
  const fold = (t: number, v: number) => {
    const open = Math.pow(Math.max(0, (v - 0.08) / 0.92), 1.35); // folds start below the edge
    return open * (0.03 * Math.sin(t * 16) + 0.014 * Math.sin(t * 37 + 1.7) + 0.008 * Math.sin(t * 7 + 0.4));
  };
  // the rounded break over the edge (5 rings), then the drop (v: 0 at the edge, 1 at the hem)
  for (let r = 0; r <= rings; r++) {
    for (let s2 = 0; s2 <= seg; s2++) {
      const t = (s2 / seg) * Math.PI * 2;
      let radius: number, y: number;
      if (r < 5) { const a = (r / 5) * (Math.PI / 2); radius = 1 - 0.025 + Math.sin(a) * 0.035; y = 1 + 0.004 - (1 - Math.cos(a)) * 0.03; }
      else { const v = (r - 5) / (rings - 5); radius = 1.01 + v * 0.03 + fold(t, v); y = 0.97 * (1 - v) + 0.004; }
      positions.push(Math.cos(t) * radius, y, Math.sin(t) * radius);
    }
  }
  for (let r = 0; r < rings; r++) for (let s2 = 0; s2 < seg; s2++) {
    const a = r * (seg + 1) + s2, b2 = a + seg + 1;
    idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
  }
  // the top, ever so slightly domed where the cloth is pulled taut
  const centre = positions.length / 3;
  positions.push(0, 1.006, 0);
  for (let s2 = 0; s2 <= seg; s2++) { const t = (s2 / seg) * Math.PI * 2; positions.push(Math.cos(t) * 0.975, 1.004, Math.sin(t) * 0.975); }
  for (let s2 = 0; s2 < seg; s2++) idx.push(centre, centre + 2 + s2, centre + 1 + s2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // uv: around and down, so a weave or a painted pattern wraps the cloth
  const uv: number[] = [];
  for (let r = 0; r <= rings; r++) for (let s2 = 0; s2 <= seg; s2++) uv.push((s2 / seg) * 6, (r / rings) * 1.2);
  uv.push(0.5, 0.5); for (let s2 = 0; s2 <= seg; s2++) { const t = (s2 / seg) * Math.PI * 2; uv.push(0.5 + Math.cos(t) * 0.5, 0.5 + Math.sin(t) * 0.5); }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const LINEN_GEO = linenGeometry();
// a fine linen weave for relief, and a soft sheen where light grazes the folds
const weave = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 2) { g.fillStyle = `rgba(255,255,255,${0.12 + Math.random() * 0.1})`; g.fillRect(0, i, 128, 1); g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.08})`; g.fillRect(i, 0, 1, 128); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40);
  return t;
})();
const linenMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.88, sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffffff'), bumpMap: weave, bumpScale: 0.25, side: THREE.DoubleSide });
function Linens({ objects, onPick }: { objects: SceneObject[]; onPick?: (o: SceneObject, e: ThreeEvent<MouseEvent>) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), c = new THREE.Color();
    objects.forEach((o, i) => {
      m.compose(new THREE.Vector3(o.position[0], o.position[1], o.position[2]), new THREE.Quaternion(), new THREE.Vector3(o.size[0] / 2 + 0.03, o.size[1] + 0.01, o.size[2] / 2 + 0.03));
      ref.current?.setMatrixAt(i, m);
      ref.current?.setColorAt(i, c.set(o.color || '#F7F3E8'));
    });
    if (ref.current) { ref.current.instanceMatrix.needsUpdate = true; if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true; ref.current.computeBoundingSphere(); }
  }, [objects]);
  const click = onPick ? (e: ThreeEvent<MouseEvent>) => { if (e.instanceId != null) { e.stopPropagation(); onPick(objects[e.instanceId], e); } } : undefined;
  const cloth = objects[0]?.finish?.cloth;
  const mat = cloth ? finishMaterial(cloth, { side: THREE.DoubleSide }) : linenMat;
  return <instancedMesh key={`${objects.length}-${cloth?.slug}`} ref={ref} args={[LINEN_GEO, mat, objects.length]} castShadow receiveShadow onClick={click} userData={{ ids: objects.map((o) => o.id), part: 'cloth' }} />;
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { console.warn('[novira] catalogue model failed:', e.message); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function RealModels({ item, objects, onPick, fallback }: { item: CatalogItem; objects: SceneObject[]; onPick?: (o: SceneObject, e: ThreeEvent<MouseEvent>) => void; fallback: ReactNode }) {
  const linen = item.linen ? objects.filter((o) => o.linen !== false) : [];
  // a floor-length cloth hides the table completely, so only bare tables are drawn
  const bare = item.linen ? objects.filter((o) => o.linen === false) : objects;
  return (
    <Boundary fallback={fallback}>
      {bare.length > 0 && (
        <Suspense fallback={null}>
          <InstancedSet item={item} objects={bare} onPick={onPick} />
        </Suspense>
      )}
      {linen.length > 0 && <Linens objects={linen} onPick={onPick} />}
    </Boundary>
  );
}
