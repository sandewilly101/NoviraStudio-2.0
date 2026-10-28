// Blender scene helpers (fire/smoke simulation domains, colliders, proxy boxes)
// are invisible in Blender renders but would draw as solid boxes in a browser.
// The server strips them on import; this also covers files cached before that.
import type * as THREE from 'three';

const HELPER_NAME = /^(domain|smoke|fluid|flow|effector|collider|collision|bounds?|bbox|bounding|proxy|ucx_|ubx_|ucp_|usp_)/i;
const HELPER_MATERIAL = /(flame|smoke|fire|volume|domain)/i;

function isHelper(n: any) {
  if (!n.isMesh) return false;
  if (HELPER_NAME.test(n.name) || HELPER_NAME.test(n.geometry?.name || '')) return true;
  const mats: THREE.Material[] = Array.isArray(n.material) ? n.material : [n.material];
  const tris = (n.geometry.index?.count ?? n.geometry.attributes.position?.count ?? 0) / 3;
  return tris <= 24 && mats.every((m) => HELPER_MATERIAL.test(m?.name || ''));
}

/** Removes helper meshes from a (cloned) model in place and returns it. */
export function stripHelpers<T extends THREE.Object3D>(root: T): T {
  const helpers: THREE.Object3D[] = [];
  root.traverse((n) => { if (isHelper(n)) helpers.push(n); });
  helpers.forEach((n) => n.removeFromParent());
  return root;
}
