// The live 3D view used by the editor, design previews and client review page.
import { isPlaying, onClock, setHaze, setRig } from '@/lib/lightFx';
import { TableSettings } from './TableSettings';
import { LedSpill, SceneEffects } from './Effects';
import { ChairDressing } from './ChairDressing';
import { OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Suspense, memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { fileUrl } from '@/lib/api';
import type { Hdri, Scene, SceneObject, Venue } from '@/lib/types';
import { C } from '@/lib/theme';
import { captureState, type CaptureCtx } from './capture';
import { useCatalog, type CatalogItem } from '@/lib/catalog';
import { keepInside } from '@/components/editor/useEditor';
import { NozilaBody, isProcedural } from '@/nozila/adapter';
import { lightPower, setProjectors } from './StageLight';
import { ObjectBody } from './objects';
import { RealModels } from './RealModels';
import { Swing } from './Swing';
import { XRDriver, useXrMode } from './xr';
import { Ghost, NoPick, PartHighlight, type PaintTarget } from './Ghost';
import { slotForPart } from '@/lib/finish';
import { DefaultRoom, OutdoorGround, VenueModel, analyseVenue, needsAnalysis } from './venue';

const MAX_REAL_LIGHTS = 8;

export type TransformMode = 'select' | 'translate' | 'rotate' | 'scale';
export type Pin = { id: number | string; position: [number, number, number]; label: string };

export function roomOf(scene: Scene | null, venue: Venue | null) {
  const f = venue?.analysis?.floor;
  if (f) return { minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ, height: venue?.analysis?.size?.[1] || 8 };
  if (scene?.environment?.setting === 'outdoor') {
    // open air: the event's own extent with room around it, and the sky for a ceiling
    const xs = scene.objects.map((o) => o.position[0]), zs = scene.objects.map((o) => o.position[2]);
    const pad = 6;
    return { minX: Math.min(-15, ...xs) - pad, maxX: Math.max(15, ...xs) + pad, minZ: Math.min(-15, ...zs) - pad, maxZ: Math.max(15, ...zs) + pad, height: 60 };
  }
  const xs = scene?.objects.map((o) => o.position[0]) || [0], zs = scene?.objects.map((o) => o.position[2]) || [0];
  return { minX: Math.min(-15, ...xs) - 1, maxX: Math.max(15, ...xs) + 1, minZ: Math.min(-15, ...zs) - 1, maxZ: Math.max(15, ...zs) + 1, height: 8 };
}

export interface SceneViewProps {
  scene: Scene | null;
  venue: Venue | null;
  /** An object being dragged in from Add objects, previewed where it will land. */
  ghost?: { o: SceneObject; pending?: boolean } | null;
  /** The surface a dragged material would paint, lit up in blue. */
  highlight?: PaintTarget;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  transformMode?: TransformMode;
  onTransform?: (id: string, t: { position: [number, number, number]; rotation: [number, number, number]; size: [number, number, number] }) => void;
  cutaway?: boolean;
  showVenue?: boolean;
  pins?: Pin[];
  onPick?: (point: [number, number, number]) => void;
  onReady?: (ctx: CaptureCtx) => void;
  onVenueAnalysed?: (a: ReturnType<typeof analyseVenue>) => void;
  onVenueLoaded?: () => void;
  /** A point clicked inside the event room: re-measure the room from there. */
  roomSeed?: { x: number; z: number } | null;
  /** Outline the room the layout uses (venue page). */
  showRoom?: boolean;
  compact?: boolean;
  children?: ReactNode;
}

export default function SceneView(props: SceneViewProps) {
  const { scene, venue } = props;
  const hdri = scene?.environment?.hdri || null;
  // evening: the house lights are dimmed and the event's own light (fixtures, LED walls, chandeliers, candles) carries the room
  const evening = scene?.environment?.mode === 'night';
  const room = useMemo(() => roomOf(scene, venue), [scene, venue]);
  const xrMode = useXrMode();
  // open air: a day sky, or a deep night one
  const outdoorSky = !venue && scene?.environment?.setting === 'outdoor' ? (evening ? '#0B1226' : '#BFD8EE') : undefined;
  // what hangs from the ceiling (draped fabric): the camera stays under it too
  const hungKey = (scene?.objects || []).filter((o) => o.type === 'ceiling_drape').map((o) => o.id).join(',');
  const hungIds = useMemo(() => (hungKey ? hungKey.split(',') : []), [hungKey]);
  const cx = (room.minX + room.maxX) / 2, cz = (room.minZ + room.maxZ) / 2;
  const span = Math.max(room.maxX - room.minX, room.maxZ - room.minZ);
  // small previews frame the event itself (from the guests' end, looking at the stage), not the whole hall
  const framed = useMemo(() => {
    const objs = props.compact ? scene?.objects || [] : [];
    if (!objs.length) return null;
    const xs = objs.flatMap((o) => [o.position[0] - o.size[0] / 2, o.position[0] + o.size[0] / 2]);
    const zs = objs.flatMap((o) => [o.position[2] - o.size[2] / 2, o.position[2] + o.size[2] / 2]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const w = x1 - x0, d = z1 - z0, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, dist = Math.max(w * 0.9, d) + 3;
    return { pos: [mx + w * 0.22, dist * 0.6, z1 + dist * 0.45] as [number, number, number], target: [mx, 0.6, mz - d * 0.08] as [number, number, number] };
  }, [props.compact, scene]);

  return (
    <Canvas
      shadows={props.compact ? false : { type: THREE.PCFShadowMap }}
      dpr={[1, props.compact ? 1.25 : 1.5]}
      flat
      gl={{ antialias: true, localClippingEnabled: true, powerPreference: 'high-performance' } as any}
      camera={{ position: framed?.pos || [cx + span * 0.35, span * 0.55, room.maxZ + span * 0.25], fov: 45, near: 0.1, far: 2000 }}
      onPointerMissed={() => props.onSelect?.(null)}
      style={{ background: outdoorSky ?? (evening ? '#101216' : BACKDROP) }}>
      <Environment hdri={hdri} evening={evening} sky={outdoorSky} />
      {/* the event as one piece: in AR it is shrunk and set down on a real table */}
      <group name="__world">
        <Lights room={room} hdri={!!hdri} evening={evening} />
        <Suspense fallback={null}>
          <World {...props} room={room} />
        </Suspense>
      </group>
      <OrbitControls makeDefault target={framed?.target || [cx, 0.8, cz - span * 0.05]} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.4} zoomToCursor maxDistance={span * 3} enableDamping={false} rotateSpeed={0.7} zoomSpeed={1.2} />
      <CeilingGuard room={room} floorY={venue?.analysis?.floor?.floorY ?? 0} hung={hungIds} />
      {/* in a headset the picture is the headset's: no screen effects, no resolution juggling */}
      {!props.compact && !xrMode && <MotionResolution />}
      {!props.compact && !xrMode && <SceneEffects evening={evening} />}
      {!props.compact && !xrMode && <FrameTap />}
      {!props.compact && scene && <XRDriver objects={scene.objects} room={room} floorY={venue?.analysis?.floor?.floorY ?? 0} />}
      {props.children}
    </Canvas>
  );
}

// Blue outline of the room the layout uses, slightly above the floor.
function RoomOutline({ f }: { f: { minX: number; maxX: number; minZ: number; maxZ: number } }) {
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(f.minX, 0.03, f.minZ), new THREE.Vector3(f.maxX, 0.03, f.minZ), new THREE.Vector3(f.maxX, 0.03, f.maxZ),
    new THREE.Vector3(f.minX, 0.03, f.maxZ), new THREE.Vector3(f.minX, 0.03, f.minZ),
  ]), [f.minX, f.maxX, f.minZ, f.maxZ]);
  return (
    <group>
      <line>
        <primitive object={geo} attach="geometry" />
        <lineBasicMaterial color={C.blue} toneMapped={false} />
      </line>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(f.minX + f.maxX) / 2, 0.02, (f.minZ + f.maxZ) / 2]}>
        <planeGeometry args={[f.maxX - f.minX, f.maxZ - f.minZ]} />
        <meshBasicMaterial color={C.blue} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// Numbered comment marker drawn in 3D (no DOM overlay, so it can't fight React over nodes).
function PinMarker({ pin }: { pin: Pin }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.orange; g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFFFFF'; g.font = '700 60px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(pin.id), 64, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, [pin.id]);
  return (
    <group position={pin.position}>
      <mesh position={[0, 0.6, 0]}><cylinderGeometry args={[0.02, 0.02, 1.2, 6]} /><meshBasicMaterial color={C.orange} /></mesh>
      <sprite position={[0, 1.4, 0]} scale={[0.7, 0.7, 0.7]}><spriteMaterial map={tex} depthTest={false} toneMapped={false} /></sprite>
    </group>
  );
}

const BACKDROP = '#E9EEF4';

// A key light for shadows plus soft fill. With an HDRI the environment does
// most of the lighting, so the fill is turned down.
function Lights({ room, hdri, evening }: { room: ReturnType<typeof roomOf>; hdri: boolean; evening: boolean }) {
  const cx = (room.minX + room.maxX) / 2, cz = (room.minZ + room.maxZ) / 2;
  const w = room.maxX - room.minX, d = room.maxZ - room.minZ;
  // evening: house lights down to a warm glow (about 2700 K) — the stage fixtures and LED walls do the lighting
  const k = evening ? 0.16 : 1, warm = evening ? '#FFC98F' : '#FFFFFF';
  return (
    <>
      <hemisphereLight args={[evening ? '#FFD7A8' : '#FFFFFF', evening ? '#3A2E26' : '#B9B2A6', (hdri ? 0.35 : 0.8) * k]} />
      <directionalLight color={warm} position={[cx + w * 0.3, 30, cz + d * 0.4]} intensity={(hdri ? 0.9 : 1.3) * (evening ? 0.12 : 1)} castShadow shadow-mapSize={[1536, 1536]}
        shadow-camera-left={-w} shadow-camera-right={w} shadow-camera-top={d} shadow-camera-bottom={-d} shadow-bias={-0.0005} />
      <ambientLight color={warm} intensity={(hdri ? 0.05 : 0.15) * k} />
    </>
  );
}

// Image-based lighting: the chosen HDRI lights the scene and every reflection
// (and can show behind the room). Without one — or while it loads, or if it
// fails — a built-in studio environment keeps metal and gloss looking real.
function Environment({ hdri, evening, sky }: { hdri: Hdri | null; evening: boolean; sky?: string }) {
  const { gl, scene } = useThree();
  const studio = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);
  // night outside in the evening; under the open sky, the sky
  const backdrop = useMemo(() => new THREE.Color(sky || (evening ? '#101216' : BACKDROP)), [evening, sky]);
  const [map, setMap] = useState<{ url: string; env: THREE.Texture; sky: THREE.Texture } | null>(null);

  useEffect(() => {
    if (!hdri?.url) return;
    let live = true;
    new HDRLoader().load(fileUrl(hdri.url), (sky) => {
      if (!live) { sky.dispose(); return; }
      sky.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(gl);
      const env = pmrem.fromEquirectangular(sky).texture;
      pmrem.dispose();
      setMap({ url: hdri.url, env, sky });
    }, undefined, (e) => console.warn('[novira] HDRI failed to load:', e));
    return () => { live = false; };
  }, [hdri?.url, gl]);
  useEffect(() => () => { map?.env.dispose(); map?.sky.dispose(); }, [map]);

  const active = hdri && map?.url === hdri.url ? map : null;
  /* eslint-disable react-hooks/immutability -- three.js scenes are mutable by design */
  useEffect(() => {
    const turn = ((hdri?.rotationDeg || 0) * Math.PI) / 180;
    scene.environment = active ? active.env : studio;
    scene.environmentIntensity = (active ? hdri?.intensity ?? 0.8 : 0.3) * (evening ? 0.18 : 1);
    scene.environmentRotation.set(0, turn, 0);
    scene.background = active && hdri?.background ? active.sky : backdrop;
    scene.backgroundRotation.set(0, turn, 0);
    scene.backgroundIntensity = hdri?.intensity ?? 0.8;
    return () => { scene.environment = null; scene.background = null; };
  }, [scene, studio, backdrop, active, hdri?.intensity, hdri?.rotationDeg, hdri?.background, evening]);
  /* eslint-enable react-hooks/immutability */
  return null;
}

function World(props: SceneViewProps & { room: ReturnType<typeof roomOf> }) {
  const { scene, venue, room } = props;
  const { gl, scene: three, camera, controls } = useThree();
  const setSizeState = useThree((st) => st.setSize), setDprState = useThree((st) => st.setDpr);
  const [venueVisible, setVenueVisible] = useState(props.showVenue !== false);

  useEffect(() => {
    // a video is drawn at its own size (1080p), then the view goes back to fitting its box
    const setSize = (w: number, h: number, ratio: number) => { setSizeState(w, h); setDprState(ratio); };
    props.onReady?.({ gl, scene: three, camera: camera as THREE.PerspectiveCamera, controls, room, setVenueVisible, setSize });
  }, [gl, three, camera, controls, room, setSizeState, setDprState]);

  // Shadows only change when the layout or lighting changes, not when the
  // camera moves, so redraw the shadow map on change instead of every frame.
  /* eslint-disable react-hooks/immutability -- the renderer is mutable by design */
  // while the lighting plays, moving fixtures (and their gobo shadows) need the shadows redrawn every frame
  useEffect(() => onClock(() => { gl.shadowMap.autoUpdate = isPlaying(); gl.shadowMap.needsUpdate = true; }), [gl]);
  useEffect(() => {
    gl.shadowMap.autoUpdate = isPlaying();
    gl.shadowMap.needsUpdate = true;
    const t = setTimeout(() => { gl.shadowMap.needsUpdate = true; }, 1500); // after models finish loading
    return () => clearTimeout(t);
  }, [gl, scene, venue]);
  /* eslint-enable react-hooks/immutability */

  // Furniture with a real sourced model is drawn in instanced batches, one per
  // model (the catalogue default, or a replacement chosen for some objects).
  const catalog = useCatalog();
  const realGroups = useMemo(() => {
    const g: Record<string, { item: CatalogItem; objects: SceneObject[] }> = {};
    if (catalog) for (const o of scene?.objects || []) {
      const item = modelFor(o, catalog);
      // objects with a different material on them are drawn as their own batch
      const fin = [o.finish?.body, o.finish?.cloth].map((f) => (f ? `${f.slug}:${f.scale || 1}:${f.tint || ""}` : "")).join("|");
      if (item) (g[`${o.type}|${item.file_url}|${fin}`] ||= { item, objects: [] }).objects.push(o);
    }
    return g;
  }, [scene, catalog]);

  // Only the brightest fixtures are real light sources (each one costs every
  // surface in the scene); the rest glow, show their beams and light a pool.
  const realLights = useMemo(() => new Set([
    ...(scene?.objects || []).filter((o) => o.type === 'light' && lightPower(o) > 0).sort((a, b) => lightPower(b) - lightPower(a)).slice(0, MAX_REAL_LIGHTS).map((o) => o.id),
    // the first few chandeliers light the room too (the rest glow)
    ...(scene?.objects || []).filter((o) => o.type === 'chandelier').slice(0, 4).map((o) => o.id),
  ]), [scene]);
  // A GPU gives each material a fixed number of texture units (16 on many laptops). Kept back for the richest
  // material (its own maps), the environment, the LED wall's area light and the sun's shadow; what is left goes
  // to the brightest fixtures' gobo projections (a pattern and a shadow map each). Too many, and materials
  // fail to compile ("texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS").
  useEffect(() => {
    const spare = Math.max(0, gl.capabilities.maxTextures - 11);
    setProjectors([...realLights].filter((id) => scene?.objects.find((o) => o.id === id)?.type === 'light').slice(0, Math.floor(spare / 2)));
  }, [realLights, gl, scene]);
  const evening = scene?.environment?.mode === 'night';
  // the lighting engine reads each fixture's place in its rig, and how hazy the room is
  useEffect(() => { setRig(scene?.objects || []); setHaze(Number(scene?.environment?.haze ?? 0.6)); }, [scene]);

  // re-measure from the room the user clicked
  const venueRoot = useRef<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!props.roomSeed || !venueRoot.current || !venue?.analysis || !props.onVenueAnalysed) return;
    props.onVenueAnalysed(analyseVenue(venueRoot.current, { ...props.roomSeed, prev: venue.analysis }));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per click
  }, [props.roomSeed]);

  // the ceiling is cut away for the doll-house view from above; standing inside the room, it is there
  const inside = useSyncExternalStore(cameraInside.subscribe, () => cameraInside.get(three), () => false);
  const xrInWorld = useXrMode();
  const cut = props.cutaway === false || inside ? null : Math.max(2.5, room.height * 0.8);
  const pick = props.onPick ? (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); props.onPick!([e.point.x, e.point.y, e.point.z]); } : undefined;

  return (
    <group>
      <group onClick={pick}>
        {venue?.file_url && props.showVenue !== false
          ? <VenueModel url={venue.file_url} analysis={venue.analysis} cutHeight={cut} visible={venueVisible && xrInWorld !== 'ar'} finishes={scene?.environment?.venueFinishes}
              onLoaded={(root) => { venueRoot.current = root; props.onVenueLoaded?.(); if (needsAnalysis(venue.analysis) && props.onVenueAnalysed) props.onVenueAnalysed(analyseVenue(root)); }} />
          : scene?.environment?.setting === 'outdoor'
            ? <OutdoorGround site={room} ground={scene.environment.ground} finishes={scene.environment.venueFinishes} />
            : <DefaultRoom floor={room} finishes={scene?.environment?.venueFinishes} />}
      </group>
      {scene?.objects.map((o) => (
        <ObjectNode key={o.id} o={o} ground={groundUnder(o, scene.objects)} realLight={realLights.has(o.id)} selected={props.selectedId === o.id} onSelect={props.onSelect} onPick={pick} real={!!(catalog && modelFor(o, catalog))} />
      ))}
      {Object.entries(realGroups).map(([key, { item, objects: objs }]) => (
        <RealModels key={key} item={item} objects={objs}
          onPick={(o, e) => (props.onPick ? props.onPick([e.point.x, e.point.y, e.point.z]) : props.onSelect?.(o.id))}
          fallback={<>{objs.map((o) => <group key={o.id} position={o.position} rotation={o.rotation as any}><ObjectBody o={o} /></group>)}</>} />
      ))}
      {scene && <ChairDressing objects={scene.objects} />}
      {scene && !props.compact && <TableSettings objects={scene.objects} />}
      {!props.compact && scene?.objects.filter((o) => o.type === 'led_screen').slice(0, 4).map((o) => <LedSpill key={`spill-${o.id}`} o={o} evening={evening} />)}
      {props.selectedId && props.transformMode && props.transformMode !== 'select' && (
        <Gizmo scene={scene} id={props.selectedId} mode={props.transformMode} onTransform={props.onTransform} room={room} />
      )}
      {props.pins?.map((p) => <PinMarker key={p.id} pin={p} />)}
      {props.highlight && scene && <PartHighlight target={props.highlight} objects={scene.objects} slotOf={slotForPart} />}
      {props.ghost && (() => {
        const g = props.ghost.o, item = catalog && modelFor(g, catalog);
        return (
          <>
            <Ghost o={g} pending={props.ghost.pending}>
              {!item && g.type !== 'model' && (isProcedural(g) ? <NozilaBody o={g} realLight={false} /> : <ObjectBody o={g} />)}
              {/* a real model is drawn at its own origin; the preview group carries it to the spot */}
              {item && <NoPick><RealModels item={item} objects={[{ ...g, position: [0, 0, 0], rotation: [0, 0, 0] }]} fallback={null} /></NoPick>}
            </Ghost>
          </>
        );
      })()}
      {props.showRoom && venue?.analysis?.floor && <RoomOutline f={venue.analysis.floor} />}
    </group>
  );
}

// What a free-standing structure's feet rest on: the top of a stage it stands
// over (LED walls are often ground-stacked on the back of the stage), else the floor.
function groundUnder(o: SceneObject, all: SceneObject[]): number {
  if (o.type !== 'led_screen') return 0;
  const stage = all.find((s) => s.type === 'stage' && Math.abs(o.position[0] - s.position[0]) < s.size[0] / 2 && Math.abs(o.position[2] - s.position[2]) < s.size[2] / 2);
  return stage ? stage.position[1] + stage.size[1] : 0;
}

// The real model an object is drawn with, or null for built-to-measure objects
// (stage, LED wall, signs) and freely imported models.
function modelFor(o: SceneObject, catalog: Record<string, CatalogItem>): CatalogItem | null {
  if (o.type === 'model' || o.modelUrl) return null;
  const base = catalog[o.type];
  if (o.asset) {
    return {
      ...(base || { type: o.type, yaw: Math.PI, stretch: false }),
      file_url: o.asset.url, name: o.asset.name, thumbnail: o.asset.thumbnail ?? null,
      author: o.asset.author ?? null, license: o.asset.license ?? null,
    } as CatalogItem;
  }
  return base || null;
}

const edgeCache = new Map<string, THREE.EdgesGeometry>();
function boxEdges(w: number, h: number, d: number) {
  const k = `${w}|${h}|${d}`;
  if (!edgeCache.has(k)) edgeCache.set(k, new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)));
  return edgeCache.get(k)!;
}

// Every object keeps a named node (for selection and the move gizmo); objects
// drawn by RealModels have no body of their own here.
const ObjectNode = memo(function ObjectNode({ o, ground, realLight, selected, onSelect, onPick, real }: { o: SceneObject; ground: number; realLight: boolean; selected: boolean; onSelect?: (id: string | null) => void; onPick?: (e: ThreeEvent<MouseEvent>) => void; real: boolean }) {
  return (
    <group
      name={o.id}
      position={o.position}
      rotation={o.rotation as any}
      onClick={onPick || (onSelect ? (e) => { e.stopPropagation(); onSelect(o.id); } : undefined)}>
      {!real && (o.type === 'curtain' || o.type === 'ceiling_drape'
        // hung fabric swings about the line it hangs from when it is moved
        ? <Swing o={o} top={o.type === 'curtain' ? o.size[1] : 0} length={o.type === 'curtain' ? o.size[1] : o.size[1] * 1.5}>{isProcedural(o) ? <NozilaBody o={o} ground={ground} realLight={realLight} /> : <ObjectBody o={o} />}</Swing>
        : isProcedural(o) ? <NozilaBody o={o} ground={ground} realLight={realLight} /> : <ObjectBody o={o} />)}
      {selected && (
        <lineSegments position={[0, o.size[1] / 2, 0]} geometry={boxEdges(o.size[0] + 0.06, o.size[1] + 0.06, o.size[2] + 0.06)}>
          <lineBasicMaterial color={C.orange} toneMapped={false} />
        </lineSegments>
      )}
    </group>
  );
});

// Move / rotate / resize the selected object. Resizing is written back as metres.
function Gizmo({ scene, id, mode, onTransform, room }: { scene: Scene | null; id: string; mode: TransformMode; onTransform?: SceneViewProps['onTransform']; room: ReturnType<typeof roomOf> }) {
  const { scene: three } = useThree();
  const obj = scene?.objects.find((o) => o.id === id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-find the node when the scene changes
  const target = useMemo(() => three.getObjectByName(id) || null, [three, id, scene]);
  const ref = useRef<any>(null);
  if (!target || !obj) return null;
  const commit = () => {
    const sc = target.scale;
    const size: [number, number, number] = [round(obj.size[0] * sc.x), round(obj.size[1] * sc.y), round(obj.size[2] * sc.z)];
    target.scale.set(1, 1, 1);
    onTransform?.(id, {
      position: [round(target.position.x), round(target.position.y), round(target.position.z)],
      rotation: [0, round(target.rotation.y, 1000), 0],
      size,
    });
  };
  // stop at the walls while dragging, not only after letting go
  /* eslint-disable react-hooks/immutability -- the gizmo moves the three.js node directly */
  const stopAtWalls = () => {
    if (mode !== 'translate') return;
    const s = target.scale;
    const live = keepInside({ position: [target.position.x, target.position.y, target.position.z], rotation: [0, target.rotation.y, 0], size: [obj.size[0] * s.x, obj.size[1] * s.y, obj.size[2] * s.z] }, room);
    target.position.x = live.position[0]; target.position.z = live.position[2];
  };
  /* eslint-enable react-hooks/immutability */
  return <TransformControls ref={ref} object={target} mode={mode as any} showY={mode !== 'translate'} showX={mode !== 'rotate'} showZ={mode !== 'rotate'} onObjectChange={stopAtWalls} onMouseUp={commit} size={0.8} />;
}

const round = (v: number, k = 100) => Math.round(v * k) / k;

/**
 * Inside the venue, the camera stays under its ceiling: orbiting, zooming, panning
 * and flying (WASD) all stop a little below it, and so does the point the camera
 * turns about. The ceiling is found where the camera is, with a ray straight up
 * into the venue model (vaulted and stepped ceilings included), remembered on a
 * metre grid; a venue without a ceiling uses its overall height. Outside the
 * walls the camera is free, for the doll-house view from above.
 */
/** Whether each view's camera is inside the room's walls (then the ceiling is shown, not cut away). */
const cameraInside = (() => {
  const value = new WeakMap<THREE.Scene, boolean>();
  const listeners = new Set<() => void>();
  return {
    get: (scene: THREE.Scene) => value.get(scene) || false,
    set: (scene: THREE.Scene, v: boolean) => { if (v !== (value.get(scene) || false)) { value.set(scene, v); listeners.forEach((l) => l()); } },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
})();

/* eslint-disable react-hooks/immutability -- the camera and the ceiling cache are three.js state, driven directly every frame */
function CeilingGuard({ room, floorY, hung }: { room: { minX: number; maxX: number; minZ: number; maxZ: number; height: number }; floorY: number; hung: string[] }) {
  const { camera, scene, controls } = useThree() as unknown as { camera: THREE.Camera; scene: THREE.Scene; controls: { target: THREE.Vector3; update: () => void } | null };
  const ceilings = useMemo(() => new Map<string, number>(), []);
  const tools = useMemo(() => ({ ray: new THREE.Raycaster(), up: new THREE.Vector3(0, 1, 0), from: new THREE.Vector3() }), []);
  useEffect(() => { ceilings.clear(); }, [room, floorY, hung, ceilings]);
  useEffect(() => () => cameraInside.set(scene, false), [scene]);
  // the lowest of the ceilings around the spot, so a sagging drape beside the camera counts as well as one straight above
  const ceilingAt = (x: number, z: number) => Math.min(ceilingCell(x, z), ceilingCell(x + 0.8, z), ceilingCell(x - 0.8, z), ceilingCell(x, z + 0.8), ceilingCell(x, z - 0.8));
  const ceilingCell = (x: number, z: number) => {
    const key = `${Math.round(x)},${Math.round(z)}`;
    let c = ceilings.get(key);
    if (c === undefined) {
      const venue = scene.getObjectByName('__venue');
      const above = [venue, ...hung.map((id) => scene.getObjectByName(id))].filter(Boolean) as THREE.Object3D[];
      c = floorY + room.height;
      if (above.length) {
        tools.ray.set(tools.from.set(Math.round(x), floorY + 1.6, Math.round(z)), tools.up);
        tools.ray.far = room.height + 2;
        const hit = tools.ray.intersectObjects(above, true).find((h) => h.distance > 0.8);
        if (hit) c = hit.point.y;
        else if (venue && !venue.children.length) return c; // the venue model is still loading: don't remember the guess
      }
      ceilings.set(key, c);
    }
    return c;
  };
  useFrame(() => {
    const p = camera.position;
    const inRoom = p.x >= room.minX && p.x <= room.maxX && p.z >= room.minZ && p.z <= room.maxZ;
    cameraInside.set(scene, inRoom);
    if (!inRoom) return; // outside the walls: free
    const limit = ceilingAt(p.x, p.z) - 0.25;
    if (p.y > limit) p.y = limit;
    const t = controls?.target;
    if (t) {
      const tl = (t.x >= room.minX && t.x <= room.maxX && t.z >= room.minZ && t.z <= room.maxZ ? ceilingAt(t.x, t.z) : floorY + room.height) - 0.25;
      if (t.y > tl) { t.y = tl; controls!.update(); }
    }
  });
  return null;
}
/* eslint-enable react-hooks/immutability */

/**
 * Sharp when still, smooth when moving: while the camera moves (orbit, pan, zoom,
 * WASD) the view is drawn at a lower resolution — most of the cost of a frame is
 * its pixels — and back at full resolution the moment it stops.
 */
function MotionResolution() {
  const { camera, setDpr, viewport } = useThree();
  const state = useMemo(() => ({ last: new THREE.Matrix4(), movedAt: -1e9, low: false, full: viewport.dpr }), []); // eslint-disable-line react-hooks/exhaustive-deps -- the resolution when this first mounted
  /* eslint-disable react-hooks/immutability -- a per-frame scratch object, like three.js state */
  useFrame(() => {
    const now = performance.now();
    if (!camera.matrixWorld.equals(state.last)) { state.last.copy(camera.matrixWorld); state.movedAt = now; }
    const moving = now - state.movedAt < 220 && !captureState.recording;
    if (moving !== state.low) { state.low = moving; setDpr(moving ? Math.max(0.5, state.full * 0.55) : state.full); }
  });
  /* eslint-enable react-hooks/immutability */
  return null;
}

/** Hands each finished frame to a video being recorded, the moment the effects have drawn it (they draw at priority 1). */
function FrameTap() {
  const gl = useThree((st) => st.gl);
  useFrame(() => { captureState.tap?.(gl.domElement); }, 2);
  return null;
}
