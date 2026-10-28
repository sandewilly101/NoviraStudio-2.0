// Stage and event lighting fixtures, modelled on the units rental companies
// stock, that really light the scene: a spotlight with the fixture's beam
// angle and output, dimmable, in any colour, aimed by pan and tilt on its
// yoke. A visible beam (as in haze) and lens glow can be shown. Fixtures hang
// from a truss on a C-clamp and safety bond, stand on a tripod, or sit on the floor.
// Object space: the fixture's pivot is the object's position; the head's lens faces +z before pan/tilt.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { FIN } from './kit';
import { aimNow, goboTexture, hazeLevel, isPlaying, showTime, step, type FxTarget, type Motor } from '@/lib/lightFx';
import { pickables } from '@/lib/pick';

type Body = 'can' | 'ledpar' | 'mhSpot' | 'mhWash' | 'mhBeam' | 'profile' | 'fresnel' | 'blinder' | 'batten' | 'uplight' | 'follow' | 'pin' | 'floorwash';
export type Mount = 'truss' | 'stand' | 'floor';
export interface FixtureSpec { label: string; body: Body; beam: number; zoom: [number, number]; cd: number; mount: Mount; soft: number }

/** Beam angles and outputs as published for typical units; cd is the on-axis intensity used for the light. */
export const FIXTURES: Record<string, FixtureSpec> = {
  'par-can': { label: 'PAR 64 can', body: 'can', beam: 24, zoom: [12, 60], cd: 700, mount: 'truss', soft: 0.35 },
  wash: { label: 'LED par wash', body: 'ledpar', beam: 40, zoom: [25, 60], cd: 520, mount: 'truss', soft: 0.6 },
  'moving-head-spot': { label: 'Moving head spot', body: 'mhSpot', beam: 18, zoom: [8, 36], cd: 1500, mount: 'truss', soft: 0.25 },
  'moving-head-wash': { label: 'Moving head wash', body: 'mhWash', beam: 35, zoom: [10, 60], cd: 1000, mount: 'truss', soft: 0.6 },
  beam: { label: 'Beam moving head', body: 'mhBeam', beam: 3, zoom: [2, 6], cd: 6000, mount: 'truss', soft: 0.1 },
  'profile-spot': { label: 'Profile (ellipsoidal)', body: 'profile', beam: 26, zoom: [15, 50], cd: 1300, mount: 'truss', soft: 0.15 },
  fresnel: { label: 'Fresnel', body: 'fresnel', beam: 40, zoom: [15, 65], cd: 750, mount: 'truss', soft: 0.75 },
  blinder: { label: 'Audience blinder', body: 'blinder', beam: 60, zoom: [60, 60], cd: 900, mount: 'truss', soft: 0.5 },
  'strip-batten': { label: 'LED batten', body: 'batten', beam: 30, zoom: [15, 45], cd: 380, mount: 'floor', soft: 0.6 },
  uplighter: { label: 'Battery uplighter', body: 'uplight', beam: 25, zoom: [25, 25], cd: 200, mount: 'floor', soft: 0.55 },
  'follow-spot': { label: 'Follow spot', body: 'follow', beam: 8, zoom: [4, 16], cd: 7000, mount: 'stand', soft: 0.2 },
  'gobo-projector': { label: 'Gobo projector', body: 'profile', beam: 20, zoom: [10, 40], cd: 1200, mount: 'truss', soft: 0.15 },
  pinspot: { label: 'Pinspot', body: 'pin', beam: 5, zoom: [4, 8], cd: 450, mount: 'truss', soft: 0.2 },
  'floor-wash': { label: 'Floor wash', body: 'floorwash', beam: 60, zoom: [40, 90], cd: 400, mount: 'floor', soft: 0.7 },
};
export const fixtureOf = (o: SceneObject) => FIXTURES[o.variant || 'par-can'] || FIXTURES['par-can'];

// ---------- the visible beam: light scattered by haze, ray-marched ----------
// For every pixel the camera ray is traced through the beam's real cone (apex
// at the lens, axis +z, cut where the beam meets the first surface) and the
// light scattered towards the eye is summed along it: the beam's profile (a
// spot's hotspot, a wash's even field), the gobo cut into it, inverse-square
// falloff, haze density that drifts, and forward scattering — a beam is far
// brighter looking up it towards the lens (Henyey–Greenstein, g = 0.55).
const BEAM_VS = `varying vec3 vWorld;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FS = `uniform mat4 uInv; uniform float uR0; uniform float uK; uniform float uLen; uniform vec3 uColor; uniform float uStrength;
  uniform float uTime; uniform float uHaze; uniform float uSoft; uniform vec3 uDir;
  uniform sampler2D uGobo; uniform float uUseGobo; uniform float uGoboAngle;
  varying vec3 vWorld;
  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  void main() {
    vec3 ro = cameraPosition, rd = normalize(vWorld - ro);
    float tExit = length(vWorld - ro);                               // drawn on the back faces: where the ray leaves the cone
    vec3 lo = (uInv * vec4(ro, 1.0)).xyz, ld = (uInv * vec4(rd, 0.0)).xyz;
    // the stretch of the ray inside 0 <= z <= 1 (lens to the surface the beam lands on)
    float t0 = 0.0, t1 = tExit;
    if (abs(ld.z) > 1e-5) { float a = -lo.z / ld.z, b = (1.0 - lo.z) / ld.z; t0 = max(t0, min(a, b)); t1 = min(t1, max(a, b)); }
    else if (lo.z < 0.0 || lo.z > 1.0) discard;
    // and inside the cone r = r0 + k z (the quadratic narrows it when the ray crosses the side)
    float A = dot(ld.xy, ld.xy) - uK * uK * ld.z * ld.z, rz = uR0 + uK * lo.z;
    float B = 2.0 * (dot(lo.xy, ld.xy) - rz * uK * ld.z), C = dot(lo.xy, lo.xy) - rz * rz, D = B * B - 4.0 * A * C;
    if (A > 1e-6) { if (D < 0.0) discard; float q = sqrt(D); t0 = max(t0, (-B - q) / (2.0 * A)); t1 = min(t1, (-B + q) / (2.0 * A)); }
    if (t1 <= t0) discard;
    const int N = 16; // per-pixel jitter (smoothed by the bloom) keeps 16 steps looking like many more
    float dt = (t1 - t0) / float(N), jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) * 43758.5453);
    float acc = 0.0, ca = cos(uGoboAngle), sa = sin(uGoboAngle);
    for (int i = 0; i < N; i++) {
      float t = t0 + (float(i) + jitter) * dt;
      vec3 pl = lo + ld * t;
      float R = uR0 + uK * pl.z, r = length(pl.xy);
      if (r > R || pl.z < 0.0 || pl.z > 1.0) continue;
      float e = r / R;
      float profile = mix(exp(-e * e * 2.6), 1.0 - smoothstep(0.72, 1.0, e), uSoft);
      float cut = 1.0;
      if (uUseGobo > 0.5) { vec2 g = pl.xy / R; g = vec2(g.x * ca - g.y * sa, g.x * sa + g.y * ca); cut = texture2D(uGobo, g * 0.5 + 0.5).r; }
      float d = pl.z * uLen;                                           // metres from the lens
      float falloff = 1.0 / (1.0 + d * d * 0.05);
      vec3 pw = ro + rd * t;
      float dens = 0.5 + noise(pw * 0.9 + vec3(0.0, uTime * 0.12, uTime * 0.05)) * 0.9; // haze drifting through the beam
      acc += profile * cut * falloff * dens;
    }
    float g = 0.55, c = dot(uDir, -rd), phase = min(3.0, (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5)); // looking up the beam: brightest, capped
    vec3 col = uColor * uStrength * uHaze * acc * dt * phase;
    gl_FragColor = vec4(col, 1.0);
  }`;
const beamMaterial = (soft: number) => new THREE.ShaderMaterial({
  uniforms: { uInv: { value: new THREE.Matrix4() }, uR0: { value: 0.002 }, uK: { value: 0.2 }, uLen: { value: 8 }, uColor: { value: new THREE.Color('#ffffff') }, uStrength: { value: 0 },
    uTime: { value: 0 }, uHaze: { value: 0.6 }, uSoft: { value: soft }, uDir: { value: new THREE.Vector3(0, -1, 0) }, uGobo: { value: null }, uUseGobo: { value: 0 }, uGoboAngle: { value: 0 } },
  vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
  transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, toneMapped: false,
});
/** A unit cone along +z (apex at the lens, z = 1 at the far end), scaled to the throw: the volume the beam is marched in. */
const coneGeometry = (half: number) => { const g = new THREE.CylinderGeometry(Math.tan(half) * 1.04 + 0.002, 0.002, 1, 40, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.5); return g; };

// ---------- what a beam lands on: one shared list of solid surfaces, refreshed now and then ----------
// `epoch` counts refreshes: a beam that has not moved keeps where it landed until the room may have changed
const hitCache = { list: [] as THREE.Object3D[], frame: -999, scene: null as THREE.Object3D | null, epoch: 0 };
function surfaces(scene: THREE.Object3D, frame: number) {
  if (hitCache.scene !== scene || frame - hitCache.frame > 90) { hitCache.list = pickables(scene); hitCache.frame = frame; hitCache.scene = scene; hitCache.epoch++; }
  return hitCache.list;
}
/**
 * Which fixtures may project their gobo through the real spotlight (a pattern texture and a shadow map:
 * two of the GPU's texture units each, in every lit material). The scene grants it to the brightest that
 * fit the GPU's budget; the others show the gobo in their beam and their pool on the floor.
 */
const projectors = { ids: new Set<string>(), version: 0 };
export function setProjectors(ids: string[]) {
  const next = new Set(ids);
  if (next.size === projectors.ids.size && ids.every((id) => projectors.ids.has(id))) return;
  projectors.ids = next; projectors.version++;
}
let fixtureCount = 0; // each fixture takes its turn to look for where its beam lands, so they don't all on one frame
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const haloTexture = (() => {
  let t: THREE.Texture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    return (t = new THREE.CanvasTexture(c));
  };
})();

// ---------- shared parts ----------
const black = () => FIN.powder('#18191C');
const Z = new THREE.Euler(Math.PI / 2, 0, 0); // cylinders along z
function Cyl({ r, l, z = 0, x = 0, y = 0, mat, seg = 24, r2 }: { r: number; l: number; z?: number; x?: number; y?: number; mat: THREE.Material; seg?: number; r2?: number }) {
  return <mesh position={[x, y, z]} rotation={Z} material={mat} castShadow><cylinderGeometry args={[r2 ?? r, r, l, seg]} /></mesh>;
}
function Box({ s, p = [0, 0, 0], mat, rot }: { s: [number, number, number]; p?: [number, number, number]; mat: THREE.Material; rot?: [number, number, number] }) {
  return <mesh position={p} rotation={rot} material={mat} castShadow><boxGeometry args={s} /></mesh>;
}

/** The head of each fixture, lens at +z; returns the lens radius and its z. */
function Head({ body, lens }: { body: Body; lens: THREE.Material }): { node: React.ReactNode; r: number; z: number } {
  const k = black(), grey = FIN.powder('#2A2C30'), alu = FIN.aluminium('#9EA4AB');
  switch (body) {
    case 'can': return { r: 0.09, z: 0.19, node: <>
      <Cyl r={0.105} l={0.36} mat={k} /><Cyl r={0.112} l={0.025} z={0.17} mat={k} /><Cyl r={0.06} l={0.06} z={-0.2} mat={k} />
      <Box s={[0.255, 0.255, 0.006]} p={[0, 0, 0.192]} mat={alu} /><Cyl r={0.09} l={0.004} z={0.196} mat={lens} /></> };
    case 'ledpar': return { r: 0.1, z: 0.09, node: <>
      <Cyl r={0.12} l={0.16} mat={grey} />
      {Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; return <Box key={i} s={[0.004, 0.05, 0.08]} p={[Math.cos(a) * 0.1, Math.sin(a) * 0.1, -0.11]} rot={[0, 0, a + Math.PI / 2]} mat={grey} />; })}
      <Cyl r={0.104} l={0.004} z={0.082} mat={lens} /></> };
    case 'mhSpot': return { r: 0.065, z: 0.2, node: <>
      <Cyl r={0.13} l={0.34} mat={k} /><Cyl r={0.085} l={0.06} z={0.18} mat={grey} /><Cyl r={0.065} l={0.004} z={0.212} mat={lens} />
      <Box s={[0.27, 0.12, 0.2]} p={[0, 0, -0.06]} mat={k} /></> };
    case 'mhWash': return { r: 0.12, z: 0.13, node: <>
      <Cyl r={0.15} l={0.24} mat={k} /><Cyl r={0.125} l={0.004} z={0.122} mat={lens} /></> };
    case 'mhBeam': return { r: 0.045, z: 0.16, node: <>
      <Cyl r={0.1} l={0.27} mat={k} /><Cyl r={0.06} l={0.04} z={0.14} mat={grey} /><Cyl r={0.045} l={0.004} z={0.162} mat={lens} /></> };
    case 'profile': return { r: 0.08, z: 0.45, node: <>
      <Box s={[0.2, 0.22, 0.2]} p={[0, 0, -0.16]} mat={k} /><Cyl r={0.1} l={0.26} z={0.05} mat={k} /><Cyl r={0.085} l={0.22} z={0.3} mat={k} />
      {[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y], i) => <Cyl key={i} r={0.008} l={0.05} x={x * 0.11} y={y * 0.11} z={0.12} mat={alu} />)}
      <Box s={[0.2, 0.2, 0.006]} p={[0, 0, 0.42]} mat={alu} /><Cyl r={0.08} l={0.004} z={0.425} mat={lens} /></> };
    case 'fresnel': return { r: 0.1, z: 0.15, node: <>
      <Cyl r={0.13} l={0.27} mat={k} /><Cyl r={0.1} l={0.004} z={0.137} mat={lens} />
      {[0.04, 0.065, 0.088].map((r) => <mesh key={r} position={[0, 0, 0.14]} material={grey}><torusGeometry args={[r, 0.003, 6, 32]} /></mesh>)}
      {[0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2; return <Box key={i} s={[0.24, 0.002, 0.13]} p={[Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.2]} rot={[0, 0, a + Math.PI / 2]} mat={k} />; })}</> };
    case 'blinder': return { r: 0.08, z: 0.07, node: <>
      <Box s={[0.42, 0.22, 0.12]} mat={k} />
      {[-0.1, 0.1].map((x) => <group key={x}><Cyl r={0.085} l={0.04} x={x} z={0.07} mat={alu} /><Cyl r={0.075} l={0.004} x={x} z={0.092} mat={lens} /></group>)}</> };
    case 'batten': return { r: 0.03, z: 0.05, node: <>
      <Box s={[1.0, 0.07, 0.09]} mat={k} />
      {Array.from({ length: 12 }, (_, i) => <Cyl key={i} r={0.025} l={0.004} x={-0.46 + i * 0.0836} z={0.047} mat={lens} />)}</> };
    case 'uplight': return { r: 0.06, z: 0.085, node: <>
      <Box s={[0.16, 0.22, 0.16]} mat={k} /><Box s={[0.13, 0.13, 0.004]} p={[0, 0.02, 0.082]} mat={lens} /></> };
    case 'follow': return { r: 0.1, z: 0.55, node: <>
      <Cyl r={0.14} l={0.9} z={0.05} mat={k} /><Cyl r={0.11} l={0.05} z={0.5} mat={grey} /><Cyl r={0.1} l={0.004} z={0.527} mat={lens} />
      {[-1, 1].map((s) => <Box key={s} s={[0.02, 0.02, 0.3]} p={[s * 0.18, -0.08, -0.3]} mat={alu} />)}</> };
    case 'pin': return { r: 0.035, z: 0.065, node: <>
      <Cyl r={0.05} l={0.12} mat={FIN.chrome()} /><Cyl r={0.035} l={0.004} z={0.062} mat={lens} /></> };
    case 'floorwash': return { r: 0.08, z: 0.1, node: <>
      <Box s={[0.3, 0.14, 0.2]} mat={k} /><Box s={[0.26, 0.1, 0.004]} p={[0, 0, 0.102]} mat={lens} /></> };
  }
}

const NO_YOKE = new Set<Body>(['batten', 'uplight', 'floorwash']);
const yokeOf = (b: Body) => (NO_YOKE.has(b) ? 0 : 0.24);
/** How far below the truss's underside a hung fixture's pivot sits (clamp + yoke, + base unit for moving heads). */
export function hangDrop(o: SceneObject) {
  const b = fixtureOf(o).body;
  return yokeOf(b) + (b.startsWith('mh') ? 0.16 : 0.03) + 0.08;
}
/** A fixture's output, used to decide which ones cast real light when there are many. */
export const lightPower = (o: SceneObject) => (o.spec?.on === false ? 0 : fixtureOf(o).cd * Number(o.spec?.intensity ?? 0.8));

/**
 * `realLight` false: the fixture still glows, shows its beam and lights a soft
 * pool where the beam lands, but adds no light source — so a rig of dozens of
 * fixtures stays fast. The brightest few are real lights.
 *
 * Everything that changes over time (pan, tilt, level, colour, strobe, gobo
 * rotation) is applied every frame from the lighting engine — the motors
 * accelerate and brake like the real fixture — without re-rendering React.
 */
export function StageLight({ o, ground = 0, realLight = true }: { o: SceneObject; ground?: number; realLight?: boolean }) {
  const fx = fixtureOf(o), s = o.spec || {};
  const mount: Mount = s.mount || fx.mount;
  const on = s.on !== false, level = Math.max(0, Math.min(1, Number(s.intensity ?? 0.8)));
  const beamDeg = Math.max(fx.zoom[0], Math.min(fx.zoom[1], Number(s.beamDeg ?? fx.beam)));
  const color = o.color || '#FFFFFF';
  const basePan = Number(s.pan ?? 0), baseTilt = Number(s.tilt ?? (mount === 'floor' ? -65 : mount === 'stand' ? 15 : 50));
  const floor = ground - o.position[1]; // the floor in object space
  const isMoving = fx.body.startsWith('mh');
  const yokeH = yokeOf(fx.body);
  // on the floor the fixture rests on its own base (or its yoke), wherever the object was placed
  const rest: Partial<Record<Body, number>> = { batten: 0.035, uplight: 0.11, floorwash: 0.07 };
  const pivotY = mount === 'floor' ? floor + (rest[fx.body] ?? yokeH + (isMoving ? 0.17 : 0.02)) : 0;
  const { scene: world } = useThree();

  const lensMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#3A3F46', toneMapped: false }), []);
  const head = Head({ body: fx.body, lens: lensMat });
  const half = (beamDeg * Math.PI) / 360;

  // the beam volume (three for a prism), the pool / gobo on the surface it hits, the lens halo
  const coneGeo = useMemo(() => coneGeometry(half), [half]);
  const vols = useMemo(() => [0, 1, 2].map(() => beamMaterial(fx.soft)), [fx.soft]);
  const poolMat = useMemo(() => new THREE.MeshBasicMaterial({ map: haloTexture(), color: '#000000', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }), []);
  const haloMat = useMemo(() => new THREE.SpriteMaterial({ map: haloTexture(), color: '#000000', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  // the pool lives in the world (it lies on whatever surface the beam reaches, not under the fixture)
  const pool = useMemo(() => { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48), poolMat); m.raycast = () => undefined; m.visible = false; m.renderOrder = 2; return m; }, [poolMat]);
  useEffect(() => { world.add(pool); return () => { world.remove(pool); }; }, [world, pool]);
  useEffect(() => () => { coneGeo.dispose(); vols.forEach((m) => m.dispose()); }, [coneGeo, vols]);
  useEffect(() => () => { poolMat.dispose(); haloMat.dispose(); lensMat.dispose(); pool.geometry.dispose(); }, [poolMat, haloMat, lensMat, pool]);

  const volRefs = useRef<(THREE.Mesh | null)[]>([]);
  const panRef = useRef<THREE.Group>(null), tiltRef = useRef<THREE.Group>(null), beamRef = useRef<THREE.Group>(null);
  const spotRef = useRef<THREE.SpotLight>(null), aim = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => { if (spotRef.current) spotRef.current.target = aim; }, [aim, realLight]);
  const motor = useRef<Motor>({ pan: basePan, tilt: baseTilt, vp: 0, vt: 0, level: 0, colour: new THREE.Color(color), init: false });
  const target = useMemo<FxTarget>(() => ({ pan: basePan, tilt: baseTilt, dimmer: 1, colour: new THREE.Color(color), goboAngle: 0 }), []); // eslint-disable-line react-hooks/exhaustive-deps -- a scratch object reused every frame
  const last = useRef(-1), frameNo = useRef(0), shownGobo = useRef<string>('');
  // the beam's last ray and what it hit: tested again only when the head has moved or the room changed
  const cast = useMemo(() => ({ lens: new THREE.Vector3(Infinity, 0, 0), dir: new THREE.Vector3(), epoch: -1, turn: fixtureCount++ }), []);
  const tmp = useMemo(() => ({ dir: new THREE.Vector3(), lens: new THREE.Vector3(), q: new THREE.Quaternion(), lit: new THREE.Color(), n: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), m: new THREE.Matrix4() }), []);

  /* eslint-disable react-hooks/immutability -- three.js objects are driven directly, every frame */
  useFrame(() => {
    frameNo.current++;
    const playing = isPlaying(), t = showTime();
    const dt = last.current < 0 || !playing ? 1 / 60 : Math.min(0.1, Math.max(0, t - last.current));
    last.current = t;
    // with no show running a fixture sits at its own aim; while playing, its effect (or the timeline's moment) drives it
    const base = { pan: basePan, tilt: baseTilt, colour: color };
    const now = playing ? aimNow(o, t, base, target) : { target: Object.assign(target, { pan: basePan, tilt: baseTilt, dimmer: 1, goboAngle: 0 }, { colour: target.colour.set(color) }), fx: null };
    const fxNow = now.fx, tg = now.target;
    const { out, colour } = step(motor.current, tg, fx.body, dt, o, t, fxNow);
    const m = motor.current, pan = (m.pan * Math.PI) / 180, tilt = (m.tilt * Math.PI) / 180;
    if (panRef.current) panRef.current.rotation.y = pan;
    if (tiltRef.current) tiltRef.current.rotation.x = tilt;
    const lvl = on ? level * out : 0, lit = tmp.lit.copy(colour);
    // the gobo and prism follow the moment (a timeline can change them)
    const goboKey = fxNow?.gobo || s.fx?.gobo || 'none', gobo = goboTexture(goboKey as any), prism = !!(fxNow?.prism ?? s.fx?.prism);
    const shownKey = `${goboKey}|${projectors.version}`;
    if (shownGobo.current !== shownKey) {
      shownGobo.current = shownKey;
      poolMat.map = gobo || haloTexture(); poolMat.needsUpdate = true;
      vols.forEach((mt) => { mt.uniforms.uGobo.value = gobo; mt.uniforms.uUseGobo.value = gobo ? 1 : 0; });
      // projected through the light only if the GPU has room for it
      const project = !!gobo && projectors.ids.has(o.id);
      if (spotRef.current) { spotRef.current.map = project ? gobo : null; spotRef.current.castShadow = project; }
    }
    lensMat.color.copy(lvl > 0.01 ? lit : new THREE.Color('#3A3F46')).multiplyScalar(lvl > 0.01 ? 0.35 + lvl * 0.9 : 1);
    haloMat.color.copy(lit).multiplyScalar(0.55 * lvl);

    // where the beam goes: from the lens along the head, to the first solid surface
    const tiltG = tiltRef.current;
    if (!tiltG) return;
    tiltG.updateWorldMatrix(true, false);
    tiltG.getWorldQuaternion(tmp.q); tmp.dir.set(0, 0, 1).applyQuaternion(tmp.q).normalize();
    tmp.lens.set(0, 0, head.z + 0.02).applyMatrix4(tiltG.matrixWorld);
    let throwLen = 30, hit: THREE.Intersection | null = null;
    const list = lvl > 0.01 ? surfaces(world, frameNo.current) : null;
    const moved = cast.lens.distanceToSquared(tmp.lens) > 1e-6 || cast.dir.dot(tmp.dir) < 0.99999 || cast.epoch !== hitCache.epoch;
    // a moving head looks again on its turn (one in three frames); a still one only when something changed
    if (list && moved && (!playing || (frameNo.current + cast.turn) % 3 === 0)) {
      ray.set(tmp.lens, tmp.dir); ray.near = 0.15; ray.far = 40;
      hit = ray.intersectObjects(list, false)[0] || null;
      (pool.userData as any).hit = hit;
      cast.lens.copy(tmp.lens); cast.dir.copy(tmp.dir); cast.epoch = hitCache.epoch;
    } else hit = (pool.userData as any).hit || null;
    if (hit) throwLen = Math.max(0.3, hit.distance);

    if (beamRef.current) {
      const showBeam = lvl > 0.01 && s.haze !== false && hazeLevel() > 0.01;
      beamRef.current.visible = showBeam;
      if (prism) beamRef.current.rotation.z = tg.goboAngle * 2;
      if (showBeam) volRefs.current.forEach((mesh, i) => {
        if (!mesh) return;
        mesh.visible = prism || i === 0;
        if (!mesh.visible) return;
        mesh.scale.setScalar(throwLen); mesh.position.set(0, 0, head.z);
        mesh.updateWorldMatrix(true, false);
        const u = vols[i].uniforms;
        u.uInv.value.copy(mesh.matrixWorld).invert(); u.uR0.value = head.r / throwLen; u.uK.value = Math.tan(half); u.uLen.value = throwLen;
        u.uColor.value.copy(lit); u.uStrength.value = (prism ? 0.55 : 1.2) * lvl; u.uTime.value = t; u.uHaze.value = hazeLevel();
        u.uDir.value.set(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(tmp.q)); u.uGoboAngle.value = tg.goboAngle;
      });
    }
    if (spotRef.current) { spotRef.current.intensity = fx.cd * lvl; spotRef.current.color.copy(lit); aim.position.set(0, 0, head.z + 5); }

    // the pool of light (with its gobo) on the surface the beam reaches — for every fixture that isn't a real light
    const showPool = !realLight && lvl > 0.01 && !!hit;
    pool.visible = showPool;
    if (showPool && hit) {
      const n = tmp.n.copy(hit.face?.normal || new THREE.Vector3(0, 1, 0)).transformDirection(hit.object.matrixWorld);
      if (n.dot(tmp.dir) > 0) n.negate();
      // an ellipse: stretched along the beam's direction across the surface, the more so the more glancing the angle
      const r = head.r + Math.tan(half) * throwLen, cosI = Math.max(0.22, Math.abs(n.dot(tmp.dir)));
      const u = tmp.u.copy(tmp.dir).addScaledVector(n, -tmp.dir.dot(n));
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0).addScaledVector(n, -n.x);
      u.normalize(); const v = tmp.v.crossVectors(n, u).normalize();
      tmp.m.makeBasis(u, v, n);
      pool.quaternion.setFromRotationMatrix(tmp.m);
      pool.rotateZ(tg.goboAngle);
      pool.position.copy(hit.point).addScaledVector(n, 0.012);
      pool.scale.set((r * 1.15) / cosI, r * 1.15, 1);
      // further throws spread the same light over a bigger area: dimmer pools
      poolMat.color.copy(lit).multiplyScalar(0.85 * lvl * Math.min(1, 20 / (throwLen * throwLen + 4)));
    }
  });
  /* eslint-enable react-hooks/immutability */

  const k = black();
  const yokeW = fx.body === 'blinder' ? 0.25 : fx.body === 'follow' ? 0.18 : fx.body === 'mhWash' ? 0.18 : fx.body === 'mhSpot' ? 0.16 : fx.body === 'mhBeam' ? 0.13 : 0.14;
  const hung = mount === 'truss', up = hung ? 1 : -1; // yoke crossbar above (hung) or below the head

  return (
    <group>
      {/* mounting: C-clamp and safety bond on the truss, or a tripod stand */}
      {hung && (
        <group position={[0, yokeH + (isMoving ? 0.16 : 0.03), 0]}>
          <Box s={[0.06, 0.08, 0.07]} p={[0, 0.04, 0]} mat={FIN.aluminium('#B9BEC5')} />
          <Cyl r={0.008} l={0.09} y={0.06} mat={FIN.chrome()} />
          <mesh position={[0.05, 0.03, 0]} rotation={[0, Math.PI / 2, 0]} material={FIN.chrome()}><torusGeometry args={[0.035, 0.003, 6, 24]} /></mesh>
        </group>
      )}
      {mount === 'stand' && (() => {
        const base = floor, top = -yokeH, legs = [0, 1, 2].map((i) => (i / 3) * Math.PI * 2);
        return (
          <group>
            <mesh position={[0, (base + 0.55 + top) / 2, 0]} material={k}><cylinderGeometry args={[0.018, 0.022, top - base - 0.55, 12]} /></mesh>
            {legs.map((a, i) => { const foot = new THREE.Vector3(Math.cos(a) * 0.55, base, Math.sin(a) * 0.55), hub = new THREE.Vector3(0, base + 0.55, 0), mid = foot.clone().add(hub).multiplyScalar(0.5), len = foot.distanceTo(hub); return <mesh key={i} position={mid} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hub.clone().sub(foot).normalize())} material={k}><cylinderGeometry args={[0.012, 0.012, len, 8]} /></mesh>; })}
          </group>
        );
      })()}
      <group ref={panRef} position={[0, pivotY, 0]} rotation={[0, (basePan * Math.PI) / 180, 0]}>
        {/* moving-head base unit with its display, or the yoke of a static fixture */}
        {isMoving && <group position={[0, up * (yokeH + 0.08), 0]}><Box s={[0.4, 0.15, 0.3]} mat={k} /><Box s={[0.07, 0.04, 0.004]} p={[0, 0, 0.152]} mat={FIN.glow('#4FA3FF')} /></group>}
        {yokeH > 0 && <>
          {[-1, 1].map((sx) => <Box key={sx} s={[0.012, yokeH + 0.02, 0.05]} p={[sx * yokeW, (up * yokeH) / 2, 0]} mat={k} />)}
          <Box s={[yokeW * 2 + 0.012, 0.012, 0.05]} p={[0, up * yokeH, 0]} mat={k} />
          {[-1, 1].map((sx) => <Cyl key={sx} r={0.018} l={0.02} x={sx * yokeW} mat={FIN.aluminium('#B9BEC5')} />)}
        </>}
        <group ref={tiltRef} rotation={[(baseTilt * Math.PI) / 180, 0, 0]}>
          {head.node}
          {on && level > 0 && <>
            {realLight && <>
              <primitive object={aim} />
              <spotLight ref={spotRef} position={[0, 0, head.z + 0.01]} color={color} intensity={0} angle={Math.min(1.4, half * 1.15)} penumbra={fx.soft} decay={2} distance={0}
                shadow-mapSize={[512, 512]} shadow-bias={-0.0004} />
            </>}
            <group ref={beamRef}>
              {[0, 1, 2].map((i) => (
                // a prism tilts each facet a few degrees off the axis, 120° apart
                <group key={i} rotation={[0, 0, (i / 3) * Math.PI * 2]}>
                  <group rotation={[i === 0 && !s.fx?.prism ? 0 : 0.07, 0, 0]}>
                    <mesh ref={(m) => { volRefs.current[i] = m; }} geometry={coneGeo} material={vols[i]} frustumCulled={false} raycast={() => undefined} />
                  </group>
                </group>
              ))}
            </group>
            <sprite position={[0, 0, head.z + 0.02]} scale={[head.r * 6, head.r * 6, 1]} material={haloMat} raycast={() => undefined} />
          </>}
        </group>
      </group>
    </group>
  );
}
