// Fast, honest picking under the pointer (used while dragging materials and
// media over the 3D view, many times a second). Only what you can see and touch
// counts: hidden meshes, light beams, glows and helper shapes are skipped, and
// every mesh is ray-tested through a bounding-volume tree (built once per
// geometry) instead of triangle by triangle.
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

export function ensureFastRaycast() {
  if (THREE.Mesh.prototype.raycast === acceleratedRaycast) return;
  (THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  (THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

// beams, haze cones, glows and selection overlays: you see through them, so you can't paint them
const seeThrough = (m: THREE.Material | undefined) =>
  !m || !m.visible || !m.colorWrite || (m.transparent && (m.blending === THREE.AdditiveBlending || m.opacity < 0.3));

/** The meshes under `root` a pointer can land on, ready for fast ray tests. */
export function pickables(root: THREE.Object3D): THREE.Object3D[] {
  ensureFastRaycast();
  const out: THREE.Object3D[] = [];
  root.traverseVisible((n: any) => {
    if (!n.isMesh || n.isSkinnedMesh) return;
    if (Object.prototype.hasOwnProperty.call(n, 'raycast')) return; // switched off on purpose (drag previews)
    const mats: THREE.Material[] = Array.isArray(n.material) ? n.material : [n.material];
    if (mats.every(seeThrough)) return;
    const g = n.geometry as THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree?: () => void };
    if (!g?.attributes?.position?.count) return;
    if (!g.boundsTree) g.computeBoundsTree!();
    out.push(n);
  });
  return out;
}
