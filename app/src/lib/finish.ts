// Real materials (Poly Haven PBR scans) applied to the surfaces of objects and
// of the venue. Maps are projected by world position (triplanar), so a
// material tiles at its true real-world size on any shape — instanced deck
// panels, pleated skirting, sourced chairs, venue floors — without needing UVs.
import * as THREE from 'three';
import { fileUrl } from './api';
import type { Finish, SceneObject } from './types';

/** The surfaces of each object type that can take a material (first = the main one). */
export const SLOTS: Record<string, { key: string; label: string }[]> = {
  stage: [{ key: 'deck', label: 'Deck top' }, { key: 'skirt', label: 'Skirting' }],
  dance_floor: [{ key: 'floor', label: 'Floor panels' }],
  curtain: [{ key: 'fabric', label: 'Drape fabric' }],
  booth: [{ key: 'carpet', label: 'Carpet' }, { key: 'walls', label: 'Wall panels' }],
  round_table: [{ key: 'cloth', label: 'Tablecloth' }],
  long_table: [{ key: 'body', label: 'Table' }],
  cocktail_table: [{ key: 'body', label: 'Table' }],
  chair: [{ key: 'body', label: 'Chair' }],
  sofa: [{ key: 'body', label: 'Sofa' }],
  bar: [{ key: 'body', label: 'Bar' }],
  lectern: [{ key: 'body', label: 'Lectern' }],
  speaker: [{ key: 'body', label: 'Speaker' }],
  centrepiece: [{ key: 'body', label: 'Centrepiece' }],
  model: [{ key: 'body', label: 'Model' }],
};
export const slotsOf = (o: SceneObject) => SLOTS[o.type] || [];

/** Which surface a part of a built object belongs to (parts are named when they are built). */
const PART_SLOT: Record<string, Record<string, string>> = {
  stage: { top: 'deck', step: 'deck', skirt: 'skirt' },
  dance_floor: { w: 'floor', b: 'floor', o: 'floor', s: 'floor' },
  booth: { carpet: 'carpet', panel: 'walls' },
  curtain: { cloth: 'fabric' },
};
export function slotForPart(o: SceneObject, part?: string): string | null {
  const slots = slotsOf(o);
  if (!slots.length) return null;
  if (part && PART_SLOT[o.type]?.[part]) return PART_SLOT[o.type][part];
  return PART_SLOT[o.type] ? null : slots[0].key; // a plain part of a built object takes nothing
}

// ---------- the material ----------
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
const texCache = new Map<string, THREE.Texture>();
function tex(url: string, color: boolean) {
  const key = `${url}|${color}`;
  let t = texCache.get(key);
  if (!t) {
    t = loader.load(fileUrl(url));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(key, t);
  }
  return t;
}
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); flat.needsUpdate = true;

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** A standard material whose maps are projected by world position at the material's real tile size. */
export function finishMaterial(f: Finish, opts: { side?: THREE.Side; transparent?: boolean; clip?: THREE.Plane } = {}) {
  const tile = Math.max(0.05, (f.sizeM || 2) * (f.scale || 1));
  const key = JSON.stringify([f.slug, tile, f.tint, opts.side, opts.clip?.constant]);
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: f.tint || '#ffffff', roughness: 1, metalness: /metal/i.test(f.slug) ? 0.85 : 0, side: opts.side ?? THREE.FrontSide });
  const uniforms = {
    tpColor: { value: tex(f.maps.color, true) }, tpRough: { value: f.maps.roughness ? tex(f.maps.roughness, false) : white },
    tpNormal: { value: f.maps.normal ? tex(f.maps.normal, false) : flat }, tpAo: { value: f.maps.ao ? tex(f.maps.ao, false) : white }, tpTile: { value: tile },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 tpWorld = vec4(transformed, 1.0);
        vec3 tpN = objectNormal;
        #ifdef USE_INSTANCING
          tpWorld = instanceMatrix * tpWorld; tpN = mat3(instanceMatrix) * tpN;
        #endif
        tpWorld = modelMatrix * tpWorld;
        vTpPos = tpWorld.xyz; vTpNormal = normalize(mat3(modelMatrix) * tpN);`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tpColor; uniform sampler2D tpRough; uniform sampler2D tpNormal; uniform sampler2D tpAo; uniform float tpTile;
        varying vec3 vTpPos; varying vec3 vTpNormal;
        vec3 tpWeights() { vec3 w = pow(abs(normalize(vTpNormal)), vec3(4.0)); return w / (w.x + w.y + w.z); }
        vec4 tpSample(sampler2D t) { vec3 w = tpWeights(); vec3 p = vTpPos / tpTile;
          return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }`)
      .replace('#include <map_fragment>', 'diffuseColor *= tpSample(tpColor) * vec4(vec3(tpSample(tpAo).r), 1.0);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tpSample(tpRough).g;')
      .replace('#include <normal_fragment_maps>', `{
          vec3 w = tpWeights(); vec3 p = vTpPos / tpTile; vec3 n = normalize(vTpNormal);
          vec3 nx = texture2D(tpNormal, p.zy).xyz * 2.0 - 1.0, ny = texture2D(tpNormal, p.xz).xyz * 2.0 - 1.0, nz = texture2D(tpNormal, p.xy).xyz * 2.0 - 1.0;
          vec3 wn = normalize(n + (vec3(0.0, nx.y, nx.x) * w.x + vec3(ny.x, 0.0, ny.y) * w.y + vec3(nz.x, nz.y, 0.0) * w.z) * 0.9);
          normal = normalize((viewMatrix * vec4(wn * faceDirection, 0.0)).xyz);
        }`);
  };
  if (opts.clip) { m.clippingPlanes = [opts.clip]; m.clipShadows = true; }
  m.customProgramCacheKey = () => 'novira-triplanar';
  matCache.set(key, m);
  return m;
}

/** The material for one surface of an object, or the fallback it is built with. */
export const finishFor = (o: SceneObject, slot: string, fallback: THREE.Material, opts?: Parameters<typeof finishMaterial>[1]) =>
  o.finish?.[slot] ? finishMaterial(o.finish[slot], opts) : fallback;
