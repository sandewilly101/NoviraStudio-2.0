// Level of detail: what is far from the camera is drawn with less.
//  · simplified(): a lighter version of a mesh (meshoptimizer, in the browser),
//    sharing the original's vertices with fewer triangles — made once, cached;
//  · useLodSplit(): which objects are near the camera right now, rechecked a few
//    times a second and only re-rendering when an object crosses the line.
import { useFrame } from '@react-three/fiber';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier'; // the simplifier alone, not the whole library
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SceneObject } from './types';

const cache = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();

/** `g` with about `ratio` of its triangles (never below a small floor), or `g` itself if it can't be simplified. */
export async function simplified(g: THREE.BufferGeometry, ratio: number): Promise<THREE.BufferGeometry> {
  const byRatio = cache.get(g) || new Map<number, THREE.BufferGeometry>();
  cache.set(g, byRatio);
  const had = byRatio.get(ratio);
  if (had) return had;
  const pos = g.attributes.position;
  if (!pos || pos.count < 300) return g;
  await MeshoptSimplifier.ready;
  // positions may be compressed or interleaved in the file: read them as plain floats
  const p = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { p[i * 3] = pos.getX(i); p[i * 3 + 1] = pos.getY(i); p[i * 3 + 2] = pos.getZ(i); }
  const index = g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const target = Math.max(120, Math.floor((index.length / 3) * ratio)) * 3;
  // an error of 2% of the model's size is invisible at the distance this is shown
  const [out] = MeshoptSimplifier.simplify(index, p, 3, target, 0.02, ['Prune']);
  if (out.length >= index.length * 0.9) { byRatio.set(ratio, g); return g; }
  const lite = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) lite.setAttribute(name, attr);
  lite.setIndex(new THREE.BufferAttribute(out, 1));
  lite.boundingBox = g.boundingBox; lite.boundingSphere = g.boundingSphere;
  byRatio.set(ratio, lite);
  return lite;
}

/** Lighter versions of several meshes, null until they are ready. */
export function useSimplified(geometries: THREE.BufferGeometry[], ratio: number) {
  const [lite, setLite] = useState<{ from: THREE.BufferGeometry[]; to: THREE.BufferGeometry[] } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(geometries.map((g) => simplified(g, ratio).catch(() => g))).then((to) => { if (live) setLite({ from: geometries, to }); });
    return () => { live = false; };
  }, [geometries, ratio]);
  return lite && lite.from === geometries ? lite.to : null;
}

/**
 * Split objects into those within `near` metres of the camera and the rest.
 * Checked four times a second; the lists only change (and re-render) when an
 * object crosses the line, with a little slack so it doesn't flicker on it.
 */
export function useLodSplit(objects: SceneObject[], near: number) {
  const [split, setSplit] = useState<{ of: SceneObject[]; near: SceneObject[]; far: SceneObject[] }>({ of: objects, near: objects, far: [] });
  const wait = useRef(0);
  useFrame(({ camera }, dt) => {
    wait.current -= dt;
    if (wait.current > 0 && split.of === objects) return;
    wait.current = 0.25;
    const c = camera.position, inNear = new Set(split.of === objects ? split.near.map((o) => o.id) : []);
    const nearNow: SceneObject[] = [], farNow: SceneObject[] = [];
    for (const o of objects) {
      const d = Math.hypot(o.position[0] - c.x, o.position[1] - c.y, o.position[2] - c.z);
      // inside the line, or still within the slack of an object that was near
      (d < near || (inNear.has(o.id) && d < near * 1.12) ? nearNow : farNow).push(o);
    }
    if (split.of === objects && nearNow.length === split.near.length && nearNow.every((o, i) => o === split.near[i])) return;
    setSplit({ of: objects, near: nearNow, far: farNow });
  });
  return split.of === objects ? split : { near: objects, far: [] as SceneObject[] };
}
