// The silhouette of each chair's real model, so covers and sashes are tailored
// to it: where the seat is, how the back leans and how thick it is, how far the
// legs splay. RealModels measures a model once and publishes the shape (in
// metres, in the chair's own space: footprint centred, floor at 0, front -z)
// for every chair drawn with it; ChairDressing reads them.
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';

export type BackSlice = { y: number; a: number; front: number; back: number };
export type ChairShape = { key: string; seat: number; top: number; skirt: { a: number; front: number }; rear: number; back: BackSlice[] };

/** A model's extents per height band, in its template space. */
export type Bands = { height: number; rows: { y: number; minZ: number; maxZ: number; maxX: number }[] };

const BANDS = 40;

export function measureBands(parts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[], height: number): Bands {
  const rows = Array.from({ length: BANDS }, (_, i) => ({ y: ((i + 0.5) / BANDS) * height, minZ: Infinity, maxZ: -Infinity, maxX: 0 }));
  const v = new THREE.Vector3();
  for (const { geometry, matrix } of parts) {
    const pos = geometry.attributes.position;
    if (!pos) continue;
    const step = Math.max(1, Math.floor(pos.count / 20000)); // a sample is plenty for a silhouette
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      const r = rows[Math.min(BANDS - 1, Math.max(0, Math.floor((v.y / height) * BANDS)))];
      if (v.z < r.minZ) r.minZ = v.z;
      if (v.z > r.maxZ) r.maxZ = v.z;
      if (Math.abs(v.x) > r.maxX) r.maxX = Math.abs(v.x);
    }
  }
  return { height, rows };
}

/** The shape of a chair drawn from these bands at this scale. */
export function shapeOf(b: Bands, s: THREE.Vector3): ChairShape | null {
  const rows = b.rows.filter((r) => Number.isFinite(r.minZ)).map((r) => ({ y: r.y * s.y, minZ: r.minZ * s.z, maxZ: r.maxZ * s.z, maxX: r.maxX * s.x }));
  if (rows.length < 6) return null;
  const front = Math.min(...rows.map((r) => r.minZ)), rear = Math.max(...rows.map((r) => r.maxZ)), top = b.height * s.y;
  // the seat is the highest band that still reaches well forward, in the lower part of the chair
  const reach = front + 0.4 * (rear - front);
  const seatRows = rows.filter((r) => r.minZ < reach && r.y < top * 0.75);
  if (!seatRows.length) return null;
  const seat = Math.max(...seatRows.map((r) => r.y)) + (b.height * s.y) / BANDS / 2;
  const below = rows.filter((r) => r.y <= seat);
  const above = rows.filter((r) => r.y > seat + 0.02);
  if (above.length < 2) return null;
  // the cloth has to clear every part of the back near each height, so take the envelope over neighbours
  const back = above.map((r, i) => {
    const near = above.slice(Math.max(0, i - 2), i + 3);
    return { y: r.y, a: Math.max(...near.map((n) => n.maxX)), front: Math.min(...near.map((n) => n.minZ)), back: Math.max(...near.map((n) => n.maxZ)) };
  });
  const r2 = (v: number) => Math.round(v * 1000) / 1000;
  const shape = { seat, top, rear, skirt: { a: Math.max(...below.map((r) => r.maxX)), front: Math.min(...below.map((r) => r.minZ)) }, back };
  return { key: JSON.stringify([shape.seat, shape.top, shape.rear, shape.skirt.a, shape.skirt.front, ...back.map((x) => [x.y, x.a, x.front])].flat().map(r2)), ...shape };
}

// ---------------------------------------------------------------------------
// chair id → shape, shared between the renderers

const byId = new Map<string, ChairShape>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => { version++; listeners.forEach((l) => l()); };

export function publishShapes(entries: [string, ChairShape][]) {
  let any = false;
  for (const [id, s] of entries) if (byId.get(id)?.key !== s.key) { byId.set(id, s); any = true; }
  if (any) changed();
}
export function withdrawShapes(ids: string[]) {
  let any = false;
  for (const id of ids) any = byId.delete(id) || any;
  if (any) changed();
}
export const chairShape = (id: string) => byId.get(id);

/** Re-renders when any chair's shape is published or withdrawn. */
export function useChairShapes() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => version, () => version);
}
