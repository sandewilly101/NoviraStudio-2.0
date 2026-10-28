import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { fileUrl } from '@/lib/api';
import type { Finish, VenueAnalysis } from '@/lib/types';
import { finishMaterial } from '@/lib/finish';

// Measure an uploaded venue: guess units, centre it on the origin with the
// floor at y = 0, and report the floor rectangle the layout solver will use.
// `seed`: a point the user clicked inside the event room (scene metres), with
// the analysis that was active when they clicked, so it can be mapped back
// into the model's own coordinates.
export function analyseVenue(root: THREE.Object3D, seed?: { x: number; z: number; prev: VenueAnalysis }): VenueAnalysis {
  // measure in the model's own space, whatever offset/scale is currently applied
  const parent = root.parent, savedScale = root.scale.clone();
  parent?.remove(root);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  try {
    const modelSeed = seed ? { x: (seed.x - seed.prev.offset[0]) / seed.prev.scale, z: (seed.z - seed.prev.offset[2]) / seed.prev.scale } : undefined;
    return measure(root, modelSeed);
  } finally {
    root.scale.copy(savedScale);
    parent?.add(root);
  }
}

// The lowest point of a venue file is often a foundation, basement or ground
// plane, not the floor guests stand on. Cast rays straight down inside the room
// and take the most common surface they land on as the real floor.
function detectFloor(root: THREE.Object3D, box: THREE.Box3): number {
  const raw = box.getSize(new THREE.Vector3());
  const startY = box.min.y + raw.y * 0.6;
  const ray = new THREE.Raycaster();
  ray.far = raw.y;
  const down = new THREE.Vector3(0, -1, 0);
  const hits: number[] = [];
  for (let i = 0; i < 6; i++) for (let k = 0; k < 6; k++) {
    const x = box.min.x + raw.x * (0.2 + 0.6 * (i / 5));
    const z = box.min.z + raw.z * (0.2 + 0.6 * (k / 5));
    ray.set(new THREE.Vector3(x, startY, z), down);
    const hit = ray.intersectObject(root, true)[0];
    if (hit) hits.push(hit.point.y);
  }
  if (hits.length < 4) return box.min.y;
  // most common height, in 5 cm buckets
  const buckets = new Map<number, number>();
  for (const y of hits) { const b = Math.round(y / 0.05); buckets.set(b, (buckets.get(b) || 0) + 1); }
  const [best] = [...buckets.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const y = best * 0.05;
  return y > box.min.y && y < box.min.y + raw.y * 0.5 ? y : box.min.y;
}

type Rect = { x0: number; x1: number; z0: number; z1: number };

/** Bump when the measuring improves, so saved venues are measured again. */
export const ANALYSIS_VERSION = 9;
export const needsAnalysis = (a?: VenueAnalysis | null) => !a || (a.v ?? 0) < ANALYSIS_VERSION;

// Find the event room: the largest wall-enclosed area on the floor. A venue
// file is often a whole building (corridors, back-of-house, other halls), and
// furniture must stay inside the room it is planned for, like in real life.
function detectRoom(root: THREE.Object3D, box: THREE.Box3, floorY: number, unit: number, seed?: { x: number; z: number }): Rect | null {
  const raw = box.getSize(new THREE.Vector3());
  const y = floorY + 1.2 / unit; // chest height: above furniture, below door heads
  const ray = new THREE.Raycaster();
  (ray as any).firstHitOnly = true;
  const far = Math.max(raw.x, raw.z);
  const cast = (x: number, z: number, dx: number, dz: number) => {
    ray.set(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, 0, dz));
    ray.far = far;
    const h = ray.intersectObject(root, true)[0];
    return h ? h.distance : null; // null: open to the outside
  };
  // standing on a floor (rooms can sit a step higher or lower than the main level)
  const onFloor = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0));
    ray.far = 2 / unit;
    const h = ray.intersectObject(root, true)[0];
    if (!h || Math.abs(h.point.y - floorY) >= 0.5 / unit) return false;
    // face normals are in the mesh's own space (models are often Z-up and rotated): use world space
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return Math.abs(n.y) > 0.7; // floors may be modelled facing down
  };
  // an opening (doorway, missing wall) counts as reaching the building's edge
  const reach = (x: number, z: number, dx: number, dz: number) =>
    cast(x, z, dx, dz) ?? (dx > 0 ? box.max.x - x : dx < 0 ? x - box.min.x : dz > 0 ? box.max.z - z : z - box.min.z);
  const around = (x: number, z: number): Rect => {
    const l = reach(x, z, -1, 0), r = reach(x, z, 1, 0), b = reach(x, z, 0, -1), f = reach(x, z, 0, 1);
    return { x0: x - l, x1: x + r, z0: z - b, z1: z + f };
  };

  // Walls are where most rays across the room stop. Taking the lower third of
  // five parallel rays ignores doorways and openings, which is what keeps a
  // room from leaking into the next one.
  const refine = (start: Rect): Rect => {
    let cur = start;
    for (let pass = 0; pass < 2; pass++) {
      const cx = (cur.x0 + cur.x1) / 2, cz = (cur.z0 + cur.z1) / 2;
      const xs = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => cur.x0 + (cur.x1 - cur.x0) * t);
      const zs = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => cur.z0 + (cur.z1 - cur.z0) * t);
      const lowThird = (v: (number | null)[]) => { const k = v.filter((d): d is number => d != null).sort((a, b) => a - b); return k.length ? k[Math.floor(k.length / 3)] : null; };
      const r = lowThird(zs.map((z) => cast(cx, z, 1, 0))), l = lowThird(zs.map((z) => cast(cx, z, -1, 0)));
      const f = lowThird(xs.map((x) => cast(x, cz, 0, 1))), b = lowThird(xs.map((x) => cast(x, cz, 0, -1)));
      cur = { x0: l != null ? cx - l : cur.x0, x1: r != null ? cx + r : cur.x1, z0: b != null ? cz - b : cur.z0, z1: f != null ? cz + f : cur.z1 };
    }
    return cur;
  };

  if (seed) return refine(around(seed.x, seed.z)); // the user showed us the room

  // Every point on the floor proposes the room around it; the winner is the
  // largest room after refining (scored so real rooms beat long corridors).
  const step = Math.max(raw.x, raw.z) / 28;
  let best: Rect | null = null, bestScore = 0;
  for (let x = box.min.x + step / 2; x < box.max.x; x += step) {
    for (let z = box.min.z + step / 2; z < box.max.z; z += step) {
      if (!onFloor(x, z)) continue;
      const r = refine(around(x, z));
      if (!(x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) continue; // the point must be in its own room
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const score = w * d * Math.min(1, Math.min(w, d) / (0.45 * Math.max(w, d)));
      if (score > bestScore) { bestScore = score; best = r; }
    }
  }
  return best;
}

let bvhReady = false;
function enableFastRaycast(root: THREE.Object3D) {
  if (!bvhReady) {
    (THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
    (THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    bvhReady = true;
  }
  root.traverse((n: any) => { if (n.isMesh && n.geometry && !n.geometry.boundsTree) n.geometry.computeBoundsTree(); });
}

function measure(root: THREE.Object3D, seed?: { x: number; z: number }): VenueAnalysis {
  enableFastRaycast(root);
  // rays fired from inside a room must hit walls and floors whichever way their faces point
  root.traverse((n: any) => { if (n.isMesh) for (const m of [].concat(n.material)) (m as THREE.Material).side = THREE.DoubleSide; });
  const box = new THREE.Box3().setFromObject(root);
  const raw = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(raw.x, raw.y, raw.z);
  const scale = maxDim > 3000 ? 0.001 : maxDim > 300 ? 0.01 : maxDim < 2 ? 10 : 1;
  const floorY = detectFloor(root, box);
  const room = detectRoom(root, box, floorY, scale, seed);
  const size = new THREE.Vector3(raw.x, box.max.y - floorY, raw.z).multiplyScalar(scale);
  const centre = box.getCenter(new THREE.Vector3());
  const offset: [number, number, number] = [-centre.x * scale, -floorY * scale, -centre.z * scale];
  // room rectangle in scene metres, kept 0.25 m off the walls (skirting, sockets)
  const inset = 0.25;
  const roomFloor = room ? {
    minX: room.x0 * scale + offset[0] + inset, maxX: room.x1 * scale + offset[0] - inset,
    minZ: room.z0 * scale + offset[2] + inset, maxZ: room.z1 * scale + offset[2] - inset,
  } : null;
  let meshes = 0, triangles = 0;
  root.traverse((n: any) => {
    if (!n.isMesh) return;
    meshes++;
    const g = n.geometry as THREE.BufferGeometry;
    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
  });
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    scale, offset: offset.map(r) as any, size: [r(size.x), r(size.y), r(size.z)], meshes, triangles: Math.round(triangles),
    floor: roomFloor
      ? { minX: r(roomFloor.minX), maxX: r(roomFloor.maxX), minZ: r(roomFloor.minZ), maxZ: r(roomFloor.maxZ), floorY: 0 }
      : { minX: r(-size.x / 2), maxX: r(size.x / 2), minZ: r(-size.z / 2), maxZ: r(size.z / 2), floorY: 0 },
    floorDetected: true,
    roomDetected: !!roomFloor,
    v: ANALYSIS_VERSION,
  };
}

export function VenueModel({ url, analysis, cutHeight, onLoaded, visible = true, finishes }: {
  url: string; analysis: VenueAnalysis | null; cutHeight?: number | null; onLoaded?: (root: THREE.Object3D) => void; visible?: boolean;
  /** materials dropped on the venue's own surfaces, by the venue's material name */
  finishes?: Record<string, Finish>;
}) {
  const gltf = useGLTF(fileUrl(url));

  // eslint-disable-next-line react-hooks/exhaustive-deps -- report once per loaded model
  useEffect(() => { onLoaded?.(gltf.scene); }, [gltf.scene]);

  // Cut away the ceiling so the room can be seen from above (doll-house view).
  // Each surface keeps its own material unless one was dropped on it; the key is the venue's material name.
  useEffect(() => {
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cutHeight ?? 1e6);
    gltf.scene.traverse((n: any) => {
      if (!n.isMesh) return;
      n.receiveShadow = true;
      n.userData.original ||= n.material;
      const orig = n.userData.original as THREE.Material;
      n.userData.venueKey = orig.name || n.name;
      const f = finishes?.[n.userData.venueKey];
      n.material = f ? finishMaterial(f, { side: THREE.DoubleSide, clip: plane }) : orig;
      for (const m of [].concat(n.material)) { (m as any).clippingPlanes = [plane]; (m as any).clipShadows = true; (m as any).side = THREE.DoubleSide; }
    });
  }, [gltf.scene, cutHeight, finishes]);

  const s = analysis?.scale ?? 1;
  const o = analysis?.offset ?? [0, 0, 0];
  return (
    <group position={o} visible={visible} name="__venue">
      <primitive object={gltf.scene} scale={s} />
    </group>
  );
}

// Plain floor and low walls, used when a project has no venue model.
const GROUND = {
  grass: { base: '#5E8C3A', dots: ['#4F7A2F', '#6D9C45', '#557F33', '#7AA84F'], rough: 0.95 },
  sand: { base: '#D9C7A0', dots: ['#CDB98F', '#E3D3AF', '#C9B288', '#EADDBE'], rough: 0.98 },
  paving: { base: '#B9B4AA', dots: ['#ADA89E', '#C4BFB5', '#A39E94', '#CBC7BD'], rough: 0.85 },
} as const;
const groundTextures = new Map<string, THREE.CanvasTexture>();
/** A ground surface as a fine, tiling texture: blades of a lawn, grains of sand, or laid stone paving. */
function groundTexture(kind: keyof typeof GROUND) {
  if (groundTextures.has(kind)) return groundTextures.get(kind)!;
  const g = GROUND[kind], S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = g.base; x.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    x.fillStyle = g.dots[Math.floor(rnd() * g.dots.length)];
    if (kind === 'grass') { x.fillRect(rnd() * S, rnd() * S, 1, 2 + rnd() * 3); }
    else x.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
  }
  if (kind === 'paving') { x.strokeStyle = 'rgba(70,66,60,.35)'; x.lineWidth = 2; for (let k = 0; k <= S; k += 64) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, S); x.stroke(); x.beginPath(); x.moveTo(0, k); x.lineTo(S, k); x.stroke(); } }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  groundTextures.set(kind, t);
  return t;
}

/** An open-air site: the ground (lawn, sand or paving) running well past the event, and no walls or ceiling. */
export function OutdoorGround({ site, ground = 'grass', finishes }: { site: { minX: number; maxX: number; minZ: number; maxZ: number }; ground?: string; finishes?: Record<string, Finish> }) {
  const kind = (ground in GROUND ? ground : 'grass') as keyof typeof GROUND;
  const size = Math.max(site.maxX - site.minX, site.maxZ - site.minZ) + 160;
  const cx = (site.minX + site.maxX) / 2, cz = (site.minZ + site.maxZ) / 2;
  const mat = useMemo(() => {
    const t = groundTexture(kind).clone(); t.needsUpdate = true; t.repeat.set(size / 3, size / 3); // a tile every 3 m
    return new THREE.MeshStandardMaterial({ map: t, roughness: GROUND[kind].rough, metalness: 0 });
  }, [kind, size]);
  return (
    <group name="__venue">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.002, cz]} receiveShadow userData={{ venueKey: 'floor' }} material={finishes?.floor ? finishMaterial(finishes.floor) : mat}>
        <planeGeometry args={[size, size]} />
      </mesh>
    </group>
  );
}

export function DefaultRoom({ floor, finishes }: { floor: { minX: number; maxX: number; minZ: number; maxZ: number }; finishes?: Record<string, Finish> }) {
  const w = floor.maxX - floor.minX, d = floor.maxZ - floor.minZ;
  const cx = (floor.minX + floor.maxX) / 2, cz = (floor.minZ + floor.maxZ) / 2;
  return (
    <group name="__venue">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow userData={{ venueKey: 'floor' }}
        material={finishes?.floor ? finishMaterial(finishes.floor) : undefined}>
        <planeGeometry args={[w, d]} />{!finishes?.floor && <meshStandardMaterial color="#ECE6DD" roughness={0.8} />}
      </mesh>
      {!finishes?.floor && <gridHelper args={[Math.max(w, d), Math.round(Math.max(w, d) / 2), '#D6CFC3', '#E0D8CC']} position={[cx, 0.005, cz]} />}
      {([[[cx, 2, floor.minZ], 0, w], [[floor.minX, 2, cz], Math.PI / 2, d]] as const).map(([p, r, len], i) => (
        <mesh key={i} position={p as any} rotation={[0, r, 0]} userData={{ venueKey: 'walls' }} material={finishes?.walls ? finishMaterial(finishes.walls, { side: THREE.DoubleSide }) : undefined}>
          <planeGeometry args={[len, 4]} />{!finishes?.walls && <meshStandardMaterial color={i ? '#E3E9F0' : '#E9EEF4'} />}
        </mesh>
      ))}
    </group>
  );
}
