import { router } from 'expo-router';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import SceneView, { roomOf, type TransformMode } from '@/components/three/SceneView';
import { PlanModal } from './PlanModal';
import { startXR, useXrSupport } from '@/components/three/xr';
import { frameHero, nextFrames, panorama, settled, snapshot, visibleIds, walkthrough, type CaptureCtx } from '@/components/three/capture';
import { Badge, Button, ErrorNote, Icon, T, type IconName } from '@/components/ui';
import { api, fileUrl, upload } from '@/lib/api';
import { C } from '@/lib/theme';
import type { BrandKit, SceneObject, Vec3 } from '@/lib/types';
import { needsAnalysis } from '@/components/three/venue';
import { AssetsPanel, ChatPanel, HistoryPanel, Inspector, SceneSettings, ScenePanel } from './panels';
import { HdriModal } from './HdriModal';
import { PanelWidth, ResizablePanel, useCollapsed } from './ResizablePanel';
import { MATERIAL_MIME, MaterialsPanel, fetchFinish } from './MaterialsPanel';
import { warmAddObjects } from './AssetsPanel';
import { ASSET_MIME, draggedAsset, endAssetDrag, ghostSpot, importLibraryModel, prefetchLibraries, setDropIntent, useAssetDrag } from '@/lib/assetDrag';
import type { PaintTarget } from '@/components/three/Ghost';
import { snapToRig } from '@/components/three/rig';
import { slotForPart, slotsOf } from '@/lib/finish';
import { keepInside, useEditor } from './useEditor';
import * as THREE from 'three';
import { hasSurface } from '@/lib/content';
import { isMediaFile, uploadMedia } from '@/lib/media';
import { pickables } from '@/lib/pick';
import { moveBlocked } from '@/lib/placement';
import { isPlaying, momentAt, onClock, seek, setPlaying, showTime, timeline, timelineLength } from '@/lib/lightFx';
import { startShow } from '@/lib/autoLight';
import { useLive } from '@/lib/live';
import { PeerAvatars, PeerMarkers, ShareModal, followPeer } from './Collab';

type Floor = { minX: number; maxX: number; minZ: number; maxZ: number };

type Left = 'scene' | 'assets' | 'materials' | 'chat' | 'history';
type Result = { kind: string; url: string; note?: string } | null;

export default function Editor({ projectId }: { projectId: string }) {
  const ed = useEditor(projectId);
  const [left, setLeft] = useState<Left>('scene');
  const [tool, setTool] = useState<TransformMode>('select');
  const [cutaway, setCutaway] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ label: string; pct?: number } | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [menu, setMenu] = useState(false);
  const [aiLabel, setAiLabel] = useState('…');
  const [brand, setBrand] = useState<string[]>([]);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [venueLoaded, setVenueLoaded] = useState(false);
  const [hdriOpen, setHdriOpen] = useState(false);
  const [leftHidden, setLeftHidden] = useCollapsed('novira.panel.left');
  const [rightHidden, setRightHidden] = useCollapsed('novira.panel.right');
  const ctx = useRef<CaptureCtx | null>(null);
  const [view, setView] = useState<CaptureCtx | null>(null); // the same, as state, for effects that bind to the 3D view
  // everyone else with this project open: their edits merge in live, their selections and views show
  const session = useLive(projectId, ed, view);
  const [shareOpen, setShareOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  // phones and tablets get their own arrangement of the same editor
  const { width } = useWindowDimensions();
  const layout = width < 760 ? 'phone' : width < 1100 ? 'tablet' : 'desktop';
  const [sheet, setSheet] = useState<Left | 'edit' | null>(null); // phone: the panel open from the bottom
  const [more, setMore] = useState(false); // phone: the ⋯ menu
  const xr = useXrSupport();
  useEffect(() => { if (__DEV__) (window as any).__noviraEditor = ed; }); // for automated checks

  useEffect(() => {
    api('/health').then((h) => setAiLabel(h.ai === 'rules' ? 'Basic rules' : String(h.ai).toUpperCase())).catch(() => setAiLabel('Offline'));
    api<BrandKit[]>('/brand-kits').then((k) => { setBrand((k[0]?.colors || []).map((c) => c.hex)); setBrandLogo(k[0]?.logo_url || null); }).catch(() => {});
  }, []);

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  // If the layout spills outside the room's walls (e.g. it was saved before the
  // room was measured), lay it out again inside the room and pull hand-placed
  // objects back in.
  const refit = useCallback(async (f: Floor) => {
    const sc = ed.scene;
    const out = (o: SceneObject) => o.position[0] < f.minX || o.position[0] > f.maxX || o.position[2] < f.minZ || o.position[2] > f.maxZ;
    if (!sc || !sc.objects.some(out)) return;
    const extra = sc.objects.filter((o) => o.userAdded).map((o) => keepInside(o, f));
    if (sc.plan && sc.objects.some((o) => !o.userAdded && out(o))) {
      const keep = sc.objects.filter((o) => o.asset || o.tint || o.variant || o.spec).map(({ type, asset, tint, color, variant, spec }) => ({ type, asset, tint, color, variant, spec }));
      const r = await api(`/projects/${projectId}/relayout`, { body: { plan: sc.plan, patch: {}, objects: keep } });
      ed.setScene({ ...r.scene, environment: sc.environment, objects: [...r.scene.objects, ...extra] });
    } else ed.setScene({ ...sc, objects: sc.objects.map((o) => (o.userAdded ? keepInside(o, f) : o)) });
    flash('Layout re-fitted inside the room’s walls — save to keep it');
  }, [ed, projectId]);

  // Drop an image or video on the 3D view: onto a screen, poster, banner or
  // stand it becomes that surface's content; onto the floor it becomes a new
  // poster (portrait), backdrop (landscape) or screen on a stand (video).
  const viewport = useRef<any>(null); // the DOM element on web
  const [dragging, setDragging] = useState<'file' | 'material' | 'object' | null>(null);
  // an object being dragged in from Add objects, previewed where it will land
  const [ghost, setGhost] = useState<{ o: SceneObject; pending?: boolean; onTruss?: boolean } | null>(null);
  useEffect(() => { prefetchLibraries(); warmAddObjects(); }, []);
  // index every mesh for fast picking while the editor is idle, so the first material drag never hitches
  useEffect(() => {
    const idle = (f: () => void) => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 0));
    const t = setTimeout(() => idle(() => { if (ctx.current) pickables(ctx.current.scene); }), 2500);
    return () => clearTimeout(t);
  }, [ed.scene]);

  // What is under a point of the 3D view: objects (with the surface hit), venue surfaces, the floor.
  const hitsAt = (x: number, y: number) => {
    const v = ctx.current, sc = ed.scene;
    if (!v || !sc) return [];
    const r = v.gl.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), v.camera);
    return ray.intersectObjects(pickables(v.scene), false).map((h) => {
      let n: THREE.Object3D | null = h.object, o: SceneObject | undefined, part: string | undefined;
      const ids = h.object.userData.ids as string[] | undefined;
      if (ids && h.instanceId != null) o = sc.objects.find((s) => s.id === ids[h.instanceId!]);
      while (n && !o) { part ||= n.userData.part; o = sc.objects.find((s) => s.id === n!.name); n = n.parent; }
      part ||= h.object.userData.part;
      return { o, part, venueKey: h.object.userData.venueKey as string | undefined, point: h.point, up: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).y : 0 };
    });
  };

  // What a material dropped here would paint: an object's surface, a venue surface, or nothing (and why).
  const paintAt = (x: number, y: number): { o?: SceneObject; slot?: string; venueKey?: string; text: string; reject?: string } | null => {
    const hit = hitsAt(x, y).find((h) => h.o || h.venueKey);
    if (!hit) return null;
    if (hit.o) {
      const slot = slotForPart(hit.o, hit.part);
      if (!slot) return { o: hit.o, text: '', reject: `${hit.o.name} can't take a material here` };
      const label = slotsOf(hit.o).find((x) => x.key === slot)?.label.toLowerCase() || slot;
      return { o: hit.o, slot, text: `Paint the ${label} of ${hit.o.name}` };
    }
    const key = hit.venueKey!;
    return { venueKey: key, text: key === 'floor' || key === 'walls' ? `Apply to the venue ${key}` : 'Apply to this venue surface' };
  };

  // Drop a material: onto an object's surface (Shift: every object of that kind), or onto the venue's floor / walls.
  const dropMaterial = useCallback(async (item: { slug: string; name: string }, x: number, y: number, all: boolean) => {
    const target = paintAt(x, y);
    if (!target) { flash('Drop the material onto a surface.'); return; }
    if (target.reject) { flash(`${target.reject} — try its fabric, deck or floor.`); return; }
    const hit = { o: target.o, venueKey: target.venueKey }, slot = target.slot;
    setBusy({ label: `Applying ${item.name}…` });
    try {
      const f = await fetchFinish(item.slug);
      if (hit.o && slot) {
        const label = slotsOf(hit.o).find((s) => s.key === slot)?.label.toLowerCase() || slot;
        if (all) ed.setScene((sc) => ({ ...sc, objects: sc.objects.map((o) => (o.type === hit.o!.type ? { ...o, finish: { ...o.finish, [slot]: f } } : o)) }));
        else ed.updateObject(hit.o.id, { finish: { ...hit.o.finish, [slot]: f } });
        ed.setSelectedId(hit.o.id);
        flash(all ? `${f.name} on every ${hit.o.type.replace('_', ' ')} (${label})` : `${f.name} on ${hit.o.name} (${label})`);
      } else if (hit.venueKey) {
        const key = hit.venueKey;
        ed.setScene((sc) => ({ ...sc, environment: { ...sc.environment, venueFinishes: { ...sc.environment?.venueFinishes, [key]: f } } }));
        flash(`${f.name} on the venue's ${key === 'floor' || key === 'walls' ? key : 'surface'}`);
      }
    } catch (e: any) { flash(e.message); } finally { setBusy(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- hitsAt reads the live scene and camera
  }, [ed]);

  // Where a dragged object would land: on the floor (or on a dance floor / stage deck), inside the walls,
  // lights clamped onto the nearest truss — exactly what the drop will do.
  const ghostAt = (x: number, y: number): SceneObject | null => {
    const p = draggedAsset(), v = ctx.current, sc = ed.scene;
    if (!p || !v || !sc) return null;
    // only what you can stand things on: the venue floor, dance floors and stage decks (not every chair and light)
    const r = v.gl.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), v.camera);
    ray.firstHitOnly = true;
    const surfaces = [v.scene.getObjectByName('__venue'), ...sc.objects.filter((o) => o.type === 'dance_floor' || o.type === 'stage').map((o) => v.scene.getObjectByName(o.id))].filter(Boolean) as THREE.Object3D[];
    const hit = ray.intersectObjects(surfaces, true).find((h) => !h.face || h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.7);
    let at = hit?.point;
    if (!at) at = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(ed.data?.venue?.analysis?.floor?.floorY ?? 0)), new THREE.Vector3()) || undefined;
    if (!at) return null;
    const proto = p.make ? p.make() : { type: 'model' as const, name: p.label.slice(0, 60), rotation: [0, 0, 0] as Vec3, size: [1, 1, 1] as Vec3, color: '#CBD3DD' };
    const cam = v.camera.position, faceCam = proto.type === 'sign' ? Math.round(Math.atan2(cam.x - at.x, cam.z - at.z) / (Math.PI / 2)) * (Math.PI / 2) : proto.rotation?.[1] || 0;
    let o = { ...proto, id: '__ghost', rotation: [0, faceCam, 0] as Vec3, position: [at.x, at.y + (proto.position?.[1] || 0), at.z] as Vec3 } as SceneObject;
    const floor = ed.data?.venue?.analysis?.floor;
    if (floor) o = keepInside(o, floor);
    const hung = snapToRig(o, sc.objects, Infinity);
    return hung === o ? o : { ...hung, userData: { onTruss: true } } as SceneObject;
  };
  // pointer moves arrive far faster than frames: work out the landing spot once per frame, move the
  // preview directly (ghostSpot), and only re-render when its shape changes (e.g. a light clamps onto a truss)
  const pending = useRef<{ x: number; y: number } | null>(null);
  const frameId = useRef(0);
  const shapeKey = useRef('');
  const [paintTarget, setPaintTarget] = useState<PaintTarget>(null);
  const paintKey = useRef('');
  const trackGhost = (x: number, y: number) => {
    pending.current = { x, y };
    if (frameId.current) return;
    frameId.current = requestAnimationFrame(() => {
      frameId.current = 0;
      const at = pending.current, payload = draggedAsset();
      if (!at || !payload) return;
      if (payload.material) {
        // a material: light up what it would paint, and say so on the chip
        const t = paintAt(at.x, at.y);
        setDropIntent(!t ? { type: 'none' } : t.reject ? { type: 'reject', reason: t.reject } : { type: 'paint', text: t.text, objectId: t.o?.id, slot: t.slot, venueKey: t.venueKey });
        const next = t && !t.reject ? { objectId: t.o?.id, slot: t.slot, venueKey: t.venueKey } : null, key = JSON.stringify(next);
        if (key !== paintKey.current) { paintKey.current = key; setPaintTarget(next); }
        return;
      }
      const g = ghostAt(at.x, at.y) as (SceneObject & { userData?: { onTruss?: boolean } }) | null;
      if (!g) { setDropIntent({ type: 'none' }); return; }
      const { userData, ...o } = g;
      Object.assign(ghostSpot, { x: o.position[0], y: o.position[1], z: o.position[2], ry: o.rotation?.[1] || 0 });
      const lifted = !userData?.onTruss && o.type !== 'light' && o.type !== 'led_screen' && o.position[1] > 0.05;
      setDropIntent({ type: 'place', x: o.position[0], z: o.position[2], y: o.position[1], onTruss: !!userData?.onTruss, on: lifted ? 'a raised surface' : undefined });
      const key = JSON.stringify([o.type, o.variant, o.size, Math.round(o.position[1] * 20), !!userData?.onTruss]);
      if (key !== shapeKey.current) { shapeKey.current = key; setGhost((cur) => (cur?.pending ? cur : { o: o as SceneObject, onTruss: !!userData?.onTruss })); }
    });
  };
  const clearGhost = () => {
    pending.current = null; shapeKey.current = ''; paintKey.current = '';
    setGhost((cur) => (cur?.pending ? cur : null)); setPaintTarget(null); setDropIntent({ type: 'none' });
  };

  const dropObject = async (x: number, y: number, shift: boolean) => {
    const p = draggedAsset(), g0 = ghost?.o;
    endAssetDrag();
    pending.current = null; shapeKey.current = ''; paintKey.current = ''; setPaintTarget(null);
    if (p?.material) { setGhost(null); dropMaterial(p.material, x, y, shift); return; }
    if (!p || !g0) { setGhost(null); return; }
    // the live spot, not the last re-render
    const g = { ...g0, position: [ghostSpot.x, ghostSpot.y, ghostSpot.z] as Vec3, rotation: [0, ghostSpot.ry, 0] as Vec3 };
    const { id: _id, ...placed } = g;
    if (p.make) { ed.addObject(placed); setGhost(null); flash(`Added ${p.label}`); return; }
    if (!p.library) { setGhost(null); return; }
    setGhost({ o: g, pending: true }); // stays on the spot, pulsing, until the model is in
    try {
      const a = await importLibraryModel(p.library);
      const m = p.library;
      ed.addObject({ ...placed, size: a.size || placed.size, modelUrl: a.file_url,
        asset: { url: a.file_url, name: m.name, thumbnail: m.thumbnail, author: m.author, license: m.license, source: m.source, externalId: m.externalId } });
      flash(`${p.label} imported and placed`);
    } catch (e: any) { flash(e.message); } finally { setGhost(null); }
  };

  const dropMedia = useCallback(async (file: File, x: number, y: number) => {
    const v = ctx.current, sc = ed.scene;
    if (!v || !sc) return;
    const r = v.gl.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), v.camera);
    let target: SceneObject | undefined, ground: THREE.Vector3 | undefined;
    for (const h of ray.intersectObjects(v.scene.children, true)) {
      let n: THREE.Object3D | null = h.object, o: SceneObject | undefined;
      while (n && !(o = sc.objects.find((s) => s.id === n!.name))) n = n.parent;
      if (o && hasSurface(o)) { target = o; break; }
      const up = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).y : 0;
      if (!o && !ground && up > 0.7) ground = h.point.clone();
    }
    if (!target && !ground) ground = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()) || undefined;
    setBusy({ label: `Uploading ${file.name}…` });
    try {
      const m = await uploadMedia(file, (pct) => setBusy({ label: `Uploading ${file.name}…`, pct }));
      const content = { mode: 'media' as const, mediaUrl: m.file_url, mediaKind: m.kind, fit: 'cover' as const, mediaBg: '#000000' };
      if (target) { ed.updateObject(target.id, { content }); ed.setSelectedId(target.id); flash(`Now showing ${file.name} on ${target.name}`); return; }
      if (!ground) return;
      const aspect = m.width && m.height ? m.width / m.height : 16 / 9, cam = v.camera.position;
      const facing = Math.atan2(cam.x - ground.x, cam.z - ground.z);
      const base = { type: 'sign' as const, rotation: [0, facing, 0] as [number, number, number], color: '#111111', content, position: [ground.x, ground.y, ground.z] as [number, number, number] };
      if (m.kind === 'video') ed.addObject({ ...base, name: 'Screen', variant: 'tv', size: [1.48, 1.85, 0.7] });
      else if (aspect < 1) ed.addObject({ ...base, name: 'Poster', variant: 'easel', size: [0.66, 0.6 / aspect + 0.82, 0.6] });
      else { const h = Math.max(1, Math.min(3, 3 / aspect)); ed.addObject({ ...base, name: 'Backdrop', variant: 'backdrop', size: [3, h + 0.03, 0.5] }); }
      flash(`Added ${file.name} to the room`);
    } catch (e: any) { flash(e.message); } finally { setBusy(null); }
  }, [ed]);
  useEffect(() => {
    const el = viewport.current as unknown as HTMLElement | null;
    if (!el) return;
    const kind = (e: DragEvent) => { const t = Array.from(e.dataTransfer?.types || []); return t.includes(ASSET_MIME) ? 'object' : t.includes(MATERIAL_MIME) ? 'material' : t.includes('Files') ? 'file' : null; };
    const over = (e: DragEvent) => {
      const k = kind(e);
      if (!k) return;
      e.preventDefault();
      setDragging((cur) => (cur === k ? cur : k)); // no re-render on every move
      if (k === 'object') trackGhost(e.clientX, e.clientY);
    };
    const leave = (e: DragEvent) => { if (!el.contains(e.relatedTarget as Node)) { setDragging(null); clearGhost(); } };
    const drop = (e: DragEvent) => {
      const k = kind(e);
      if (!k) return;
      e.preventDefault(); setDragging(null);
      if (k === 'object') { dropObject(e.clientX, e.clientY, e.shiftKey); return; }
      if (k === 'material') { try { dropMaterial(JSON.parse(e.dataTransfer!.getData(MATERIAL_MIME)), e.clientX, e.clientY, e.shiftKey); } catch { /* not ours */ } return; }
      const file = e.dataTransfer!.files[0];
      if (file && isMediaFile(file)) dropMedia(file, e.clientX, e.clientY); else flash('Drop an image or a video.');
    };
    el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', drop);
    return () => { el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', drop); };
  });

  // Select, then drag: click an item to select it (its outline shows), then drag
  // it — it slides under the cursor at its own height, takes its chairs and
  // centrepiece along, stops at the walls (a light clamps onto a truss). A drag
  // anywhere else — empty space or an item that isn't selected — orbits, so
  // looking around a full hall never moves anything by accident; right-drag pans.
  // Shift snaps to a 0.25 m grid, Esc puts it back; the whole move is one undo step.
  const live = useRef({ hitsAt, ed, tool });
  useEffect(() => { live.current = { hitsAt, ed, tool }; });
  const press = useRef<{ id: string; x: number; y: number; plane: THREE.Plane; grab: THREE.Vector3; start: Map<string, Vec3>; moving: boolean } | null>(null);
  const canvas = view?.gl.domElement as HTMLCanvasElement | undefined;
  useEffect(() => {
    const el = canvas;
    if (!el) return;
    let frame = 0, last: { x: number; y: number; shift: boolean } | null = null;
    const ray = new THREE.Raycaster();
    const onPlane = (x: number, y: number, plane: THREE.Plane) => {
      const v = ctx.current, r = el.getBoundingClientRect();
      if (!v) return null;
      ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), v.camera);
      return ray.ray.intersectPlane(plane, new THREE.Vector3());
    };
    const objectAt = (x: number, y: number) => live.current.hitsAt(x, y).find((h) => h.o || h.venueKey);
    if (__DEV__) (window as any).__moveDrag = { objectAt }; // for automated checks
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
      const E = live.current.ed, o = objectAt(e.clientX, e.clientY)?.o, v = ctx.current;
      if (!o || !v || o.id !== E.selectedId) return; // not the selected item: the camera orbits as usual
      if (live.current.tool !== 'select') return; // the gizmo's own handles work on the selected object
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -o.position[1]), grab = onPlane(e.clientX, e.clientY, plane);
      if (!grab) return;
      v.controls.enabled = false; // this press moves the object, not the camera
      const members = E.scene!.objects.filter((x) => x.id === o.id || x.group === o.id);
      press.current = { id: o.id, x: e.clientX, y: e.clientY, plane, grab, start: new Map(members.map((m) => [m.id, [...m.position] as Vec3])), moving: false };
    };
    const apply = () => {
      frame = 0;
      const pr = press.current;
      if (!pr || !last) return;
      const p = onPlane(last.x, last.y, pr.plane);
      if (!p) return;
      const E = live.current.ed, base = pr.start.get(pr.id)!;
      let nx = base[0] + p.x - pr.grab.x, nz = base[2] + p.z - pr.grab.z;
      if (last.shift) { nx = Math.round(nx * 4) / 4; nz = Math.round(nz * 4) / 4; }
      // things don't pass through each other: against something, it slides along it (or stays)
      const all = E.scene!.objects, members = all.filter((x) => pr.start.has(x.id)).map((x) => ({ ...x, position: pr.start.get(x.id)! }));
      const cur = all.find((x) => x.id === pr.id)!.position, was = [cur[0] - base[0], cur[2] - base[2]];
      const blocked = (dx: number, dz: number) => moveBlocked(members, dx, dz, all);
      if (blocked(nx - base[0], nz - base[2])) {
        if (!blocked(nx - base[0], was[1])) nz = base[2] + was[1];
        else if (!blocked(was[0], nz - base[2])) nx = base[0] + was[0];
        else return;
      }
      if (pr.start.size === 1) { E.updateObject(pr.id, { position: [nx, base[1], nz] }); return; } // walls and truss snapping included
      const floor = E.data?.venue?.analysis?.floor, main = E.scene!.objects.find((x) => x.id === pr.id)!;
      const kept = floor ? keepInside({ ...main, position: [nx, base[1], nz] }, floor).position : [nx, base[1], nz];
      const dx = kept[0] - base[0], dz = kept[2] - base[2], start = pr.start;
      E.setScene((sc) => ({ ...sc, objects: sc.objects.map((x) => { const s0 = start.get(x.id); return s0 ? { ...x, position: [s0[0] + dx, s0[1], s0[2] + dz] as Vec3 } : x; }) }));
    };
    const move = (e: PointerEvent) => {
      const pr = press.current;
      if (!pr) return;
      if (!pr.moving) {
        if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 4) return;
        pr.moving = true;
        live.current.ed.beginGesture(); live.current.ed.setSelectedId(pr.id);
      }
      last = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const finish = (cancel: boolean) => {
      const pr = press.current;
      if (!pr) return;
      const E = live.current.ed, start = pr.start;
      if (frame) { cancelAnimationFrame(frame); frame = 0; if (!cancel) apply(); }
      if (pr.moving) {
        if (cancel) E.setScene((sc) => ({ ...sc, objects: sc.objects.map((x) => (start.has(x.id) ? { ...x, position: start.get(x.id)! } : x)) }));
        E.endGesture();
      }
      if (ctx.current) ctx.current.controls.enabled = true;
      press.current = null; last = null;
    };
    const up = (e: PointerEvent) => { if (e.button === 0 || !e.buttons) finish(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && press.current?.moving) { e.stopPropagation(); finish(true); } };
    const menu = (e: MouseEvent) => e.preventDefault(); // no browser menu over the 3D view
    el.addEventListener('pointerdown', down, { capture: true }); el.addEventListener('contextmenu', menu);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('keydown', key, { capture: true });
    return () => {
      finish(false);
      el.removeEventListener('pointerdown', down, { capture: true }); el.removeEventListener('contextmenu', menu);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', key, { capture: true });
    };
  }, [canvas]); // reads the live editor through `live`

  // check once when a project opens on an already-measured venue
  const checked = useRef(false);
  const analysis = ed.data?.venue?.analysis;
  useEffect(() => {
    if (checked.current || !ed.scene || !analysis?.floor || needsAnalysis(analysis)) return;
    checked.current = true;
    refit(analysis.floor).catch((e) => flash(e.message));
  }, [ed.scene, analysis, refit]);

  const onSave = useCallback(async () => {
    try { const v = await ed.save(); if (v) flash(`Saved as version ${v}`); } catch (e: any) { flash(e.message); }
  }, [ed]);

  // Fly around with the keyboard, as in game and 3D tools: W/S forward and back
  // along where you look (kept level), A/D sideways, Q/E down and up; Shift is
  // faster, Alt slower. The orbit point travels with the camera, so orbiting and
  // zooming carry on from wherever you end up.
  useEffect(() => {
    const v = view;
    if (!v) return;
    const held = new Set<string>();
    let frame = 0, last = 0;
    const KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
    const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };
    const fwd = new THREE.Vector3(), side = new THREE.Vector3(), step = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    // one step of movement for the time since the last step (by time held, not frames drawn: the same speed when the view is slow)
    const advance = (now: number) => {
      const dt = Math.min(0.5, (now - (last || now)) / 1000); last = now;
      if (!held.size) return;
      const speed = (held.has('shift') ? 12 : held.has('alt') ? 1.2 : 4) * dt; // metres per second
      v.camera.getWorldDirection(fwd); fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize(); side.crossVectors(fwd, UP).normalize();
      step.set(0, 0, 0);
      if (held.has('w')) step.add(fwd); if (held.has('s')) step.sub(fwd);
      if (held.has('d')) step.add(side); if (held.has('a')) step.sub(side);
      if (held.has('e')) step.y += 1; if (held.has('q')) step.y -= 1;
      if (step.lengthSq()) {
        step.normalize().multiplyScalar(speed);
        if (v.camera.position.y + step.y < 0.3) step.y = 0.3 - v.camera.position.y; // never through the floor
        v.camera.position.add(step);
        const target = (v.controls as any)?.target as THREE.Vector3 | undefined;
        if (target) { target.add(step); (v.controls as any).update?.(); }
      }
    };
    // the one animation loop: runs while any key is held
    const tick = (now: number) => {
      advance(now);
      if (held.size) frame = requestAnimationFrame(tick); else { frame = 0; last = 0; }
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'shift' || k === 'alt') { held.add(k); return; }
      if (!KEYS.has(k)) return;
      e.preventDefault();
      if (!held.has(k) && last) advance(performance.now()); // settle the keys already held before adding this one
      held.add(k);
      if (!last) last = performance.now(); // the clock starts at the key press, not at the next frame
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (KEYS.has(k) && held.has(k) && last) advance(performance.now()); // the distance since the last frame still counts
      held.delete(k);
    };
    const stop = () => held.clear(); // the window lost focus: let go of everything
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', stop);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', stop); if (frame) cancelAnimationFrame(frame); };
  }, [view]);

  // play the lighting: a rig nobody has programmed runs Novira's timeline for the event
  const playLights = () => {
    const sc = ed.scene;
    if (!sc) return;
    if (timeline().length || sc.objects.some((o) => o.type === 'light' && o.spec?.fx)) { setPlaying(true); return; }
    const next = startShow(sc, 'auto');
    if (next !== sc) ed.setScene(next);
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) ed.redo(); else ed.undo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); ed.redo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); onSave(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'd' && ed.selectedId) { e.preventDefault(); ed.duplicate(ed.selectedId); }
      else if (k === 'v') setTool('select');
      else if (k === 'g' || k === 'm') setTool('translate');
      else if (k === 'r') setTool('rotate');
      else if (k === 't') setTool('scale'); // S is for walking back (WASD)
      else if (k === 'p') { if (isPlaying()) setPlaying(false); else playLights(); } // the lighting, programmed by Novira
      else if ((k === 'delete' || k === 'backspace') && ed.selectedId) ed.removeObject(ed.selectedId);
      else if (k === 'escape') ed.setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // "Saved · 2 min ago" stays current
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);


  const run = async (label: string, fn: () => Promise<Result>) => {
    setMenu(false);
    if (!ctx.current) return;
    setBusy({ label });
    try { setResult(await fn()); } catch (e: any) { flash(e.message || 'Render failed'); } finally { setBusy(null); }
  };
  const version = () => ed.data?.version;
  const renders = {
    snapshot: () => run('Capturing image…', async () => {
      const r = await api(`/renders/project/${projectId}/capture`, { body: { kind: 'image', dataUrl: snapshot(ctx.current!), version: version() } });
      return { kind: 'image', url: r.file_url };
    }),
    photoreal: () => run('Nano Banana is rendering a photoreal preview…', async () => {
      // a clean frame: no selection box or move arrows, at twice the screen resolution
      ed.setSelectedId(null);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = await api(`/renders/project/${projectId}/enhance`, { body: { dataUrl: snapshot(ctx.current!, 2), lighting: ed.scene?.environment?.hdri?.name, scene: ed.scene, version: version() } });
      return { kind: r.kind, url: r.file_url, note: r.note };
    }),
    pano: () => run('Rendering 360° panorama…', async () => {
      await new Promise((res) => setTimeout(res, 30));
      const r = await api(`/renders/project/${projectId}/capture`, { body: { kind: 'panorama', dataUrl: panorama(ctx.current!), version: version() } });
      return { kind: 'panorama', url: r.file_url };
    }),
    plan: () => { setMenu(false); setPlanOpen(true); },
    video: () => run('Recording walkthrough…', async () => {
      ed.setSelectedId(null); // a clean picture: no selection outline
      const playing = isPlaying(), from = showTime();
      const { blob, ext } = await walkthrough(ctx.current!, ed.scene!.objects, {
        seconds: 16, fps: 30, show: { playing, time: from, seek },
        onProgress: (p) => setBusy({ label: 'Recording the walkthrough, frame by frame…', pct: Math.round(p * 100) }),
      });
      setBusy({ label: 'Uploading video…' });
      const form = new FormData();
      form.append('file', blob, `walkthrough.${ext}`);
      form.append('version', String(version() || ''));
      const r = await upload(`/renders/project/${projectId}/video`, form);
      return { kind: 'video', url: r.file_url };
    }),
  };

  /**
   * The concept picture of the design as it now stands, rendered from this 3D scene (after the AI redesigns it):
   * the hero view once everything has loaded, made photoreal with everything kept exactly as built.
   */
  const renderConcept = async (): Promise<string | null> => {
    const v = ctx.current;
    if (!v) return null;
    const cam = v.camera as THREE.PerspectiveCamera;
    const keep = { pos: v.camera.position.clone(), target: v.controls?.target?.clone() as THREE.Vector3 | undefined, fov: cam.fov };
    try {
      await settled(v);
      const sc = live.current.ed.scene;
      if (!sc) return null;
      frameHero(v, sc);
      await nextFrames(4);
      const dataUrl = snapshot(v, 1.5), visible = visibleIds(v, sc.objects);
      const r = await api<{ url: string }>('/projects/concept', { body: { dataUrl, scene: sc, plan: sc.plan, visible } });
      return r.url;
    } finally {
      v.camera.position.copy(keep.pos);
      cam.fov = keep.fov; cam.updateProjectionMatrix();
      if (keep.target && v.controls) { v.controls.target.copy(keep.target); v.controls.update(); }
    }
  };

  if (ed.error) return <View style={{ flex: 1, padding: 40, gap: 12 }}><ErrorNote text={ed.error} /><Button kind="secondary" label="Back to projects" onPress={() => router.replace('/projects')} /></View>;
  if (!ed.data || !ed.scene) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.blue} /></View>;

  const sel = ed.scene.objects.find((o) => o.id === ed.selectedId) || null;
  const hdri = ed.scene.environment?.hdri || null;
  const focus = (): [number, number] => { const t = ctx.current?.controls?.target; return t ? [Math.round(t.x * 10) / 10, Math.round(t.z * 10) / 10] : [0, 0]; };

  // the parts of the editor, arranged below for a desktop, a tablet or a phone
  const phone = layout === 'phone', tablet = layout === 'tablet';
  const panel = (k: Left) => (k === 'scene' ? <ScenePanel ed={ed} />
    : k === 'assets' ? <AssetsPanel ed={ed} focus={focus} />
      : k === 'chat' ? <ChatPanel ed={ed} projectId={projectId} aiLabel={aiLabel} renderConcept={renderConcept} />
        : k === 'history' ? <HistoryPanel ed={ed} projectId={projectId} />
          : <MaterialsPanel ed={ed} flash={flash} />);
  const properties = sel ? <Inspector key={sel.id} ed={ed} obj={sel} brandColors={brand} brandLogo={brandLogo} /> : <SceneSettings ed={ed} projectId={projectId} />;
  const tools = <Segment items={[['mouse-pointer', 'select', 'Select (V)'], ['move', 'translate', 'Move (G)'], ['rotate-cw', 'rotate', 'Rotate (R)'], ['maximize-2', 'scale', 'Resize (T)']]} value={tool} onChange={(v) => setTool(v as TransformMode)} />;
  const dayNight = <Segment items={[['sun', 'day', 'Daytime light'], ['moon', 'night', 'Evening — event lighting']]} value={ed.scene?.environment?.mode === 'night' ? 'night' : 'day'}
    onChange={(v) => ed.setScene((x) => ({ ...x, environment: { ...x.environment, mode: v as 'day' | 'night' } }))} />;
  const hdriButton = (
    <Pressable onPress={() => setHdriOpen(true)} accessibilityLabel="Lighting environment (HDRI)" {...({ title: hdri ? `Lighting: ${hdri.name}` : 'Lighting: studio — choose an HDRI' } as any)}
      style={({ hovered }: any) => ({ height: 36, width: hdri ? 56 : 36, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: hovered ? C.blue : C.border })}>
      {hdri ? <Image source={{ uri: hdri.thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name="sun" size={16} color={C.blue} />}
    </Pressable>
  );
  const peers = <PeerAvatars live={session} scene={ed.scene} onFollow={(p) => { if (!followPeer(ctx.current, p)) flash(`${p.name} hasn't looked around yet`); }} />;
  const renderItems = (
    <>
      <MenuItem icon="zap" title="Photoreal preview" sub="AI (Nano Banana) from this view" onPress={renders.photoreal} />
      <MenuItem icon="image" title="Snapshot" sub="Exactly what you see" onPress={renders.snapshot} />
      <MenuItem icon="globe" title="360° panorama" sub="From the centre at eye height" onPress={renders.pano} />
      <MenuItem icon="video" title="Walkthrough video" sub="16 s fly-through, 1080p, smooth" onPress={renders.video} />
      <MenuItem icon="grid" title="Floor plan" sub="Measured drawing: PDF, DXF (AutoCAD)" onPress={renders.plan} />
      {/* only on devices that can show them: a headset, an ARCore phone */}
      {xr.vr && <MenuItem icon="eye" title="Walk through in VR" sub="Real size: left stick walks, right turns" onPress={() => { setMenu(false); setMore(false); startXR('vr').catch((e) => flash(e.message)); }} />}
      {xr.ar && <MenuItem icon="smartphone" title="View on a table in AR" sub="A 1:50 model of the event, tap to place" onPress={() => { setMenu(false); setMore(false); startXR('ar').catch((e) => flash(e.message)); }} />}
    </>
  );
  const status = `${ed.saving || ed.dirty ? 'Saving…' : ed.savedAt ? `Saved · ${savedAgo(ed.savedAt)}` : 'All changes saved'}`;
  const back = <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/projects'))} accessibilityLabel="Back to projects" style={{ padding: 6 }}><Icon name="chevron-left" size={20} /></Pressable>;
  const RAIL: [IconName, Left, string][] = [['layers', 'scene', 'Scene'], ['box', 'assets', 'Add objects'], ['droplet', 'materials', 'Materials'], ['message-square', 'chat', 'AI assistant'], ['clock', 'history', 'History']];

  const viewportArea = (
    <View ref={viewport} style={{ flex: 1 }}>
      <SceneView
        scene={ed.scene}
        venue={ed.data.venue}
        selectedId={ed.selectedId}
        onSelect={ed.setSelectedId}
        transformMode={tool}
        onTransform={(id, t) => ed.updateObject(id, t)}
        cutaway={cutaway}
        ghost={ghost}
        highlight={paintTarget}
        onReady={(c) => { ctx.current = c; setView(c); if (__DEV__) (window as any).__noviraView = c; /* camera access for automated checks */ }}
        onVenueLoaded={() => setVenueLoaded(true)}
        onVenueAnalysed={async (a) => {
          const v = await api(`/venues/${ed.data!.venue!.id}/analysis`, { method: 'PUT', body: a });
          ed.setData((d) => (d ? { ...d, venue: v } : d));
          refit(a.floor); // the room was just measured
        }}
      />
      {dragging && dragging !== 'object' && (
        <View pointerEvents="none" style={{ position: 'absolute', inset: 12, borderRadius: 14, borderWidth: 3, borderStyle: 'dashed', borderColor: C.blue, backgroundColor: 'rgba(0,106,177,.08)', alignItems: 'center', justifyContent: 'center' } as any}>
          <View style={{ backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}><T size={14} weight="600" color={C.blue}>{dragging === 'material' ? 'Drop on a surface: chair, tablecloth, stage, drape, floor, walls… (Shift: all of that kind)' : 'Drop on a screen, poster or banner, or on the floor to add a new one'}</T></View>
        </View>
      )}
      {ed.data.venue && !venueLoaded && (
        <View style={{ position: 'absolute', top: phone ? 60 : 16, left: 16, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.surface, borderRadius: 8, paddingHorizontal: 12, height: 34 }}>
          <ActivityIndicator size="small" color={C.blue} /><T size={12.5}>Loading venue model…</T>
        </View>
      )}
      {/* on a phone the tools float over the view, and the selected object has a quick way to its settings */}
      {phone && <View style={{ position: 'absolute', top: 10, left: 10, borderRadius: 10, backgroundColor: C.surface, boxShadow: '0 4px 14px rgba(20,30,50,.15)' } as any}>{tools}</View>}
      {phone && sel && sheet !== 'edit' && (
        <Pressable onPress={() => setSheet('edit')} accessibilityLabel={`Edit ${sel.name}`}
          style={{ position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: C.blue, boxShadow: '0 6px 18px rgba(0,60,120,.3)' } as any}>
          <Icon name="edit-3" size={15} color="#fff" /><T size={13} weight="600" color="#fff" numberOfLines={1}>Edit {sel.name}</T>
        </Pressable>
      )}
      {!phone && (
        <View style={{ position: 'absolute', left: 16, bottom: 16, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.surface, borderRadius: 8, paddingHorizontal: 12, height: 32 }}>
          <Icon name={(ed.scene.checks || []).some((c) => c.level === 'warn') ? 'alert-triangle' : 'check-circle'} size={14} color={(ed.scene.checks || []).some((c) => c.level === 'warn') ? C.amber : C.green} />
          <T size={12}>{ed.scene.stats?.seats ?? 0} seats · {ed.scene.objects.length} objects</T>
        </View>
      )}
      <PeerMarkers live={session} view={view} scene={ed.scene} />
      <ShowTimeline />
      {busy && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(18,26,43,.35)', alignItems: 'center', justifyContent: 'center', padding: 16 } as any}>
          <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 22, minWidth: Math.min(300, width - 32), maxWidth: '100%', gap: 12, alignItems: 'center' } as any}>
            <ActivityIndicator color={C.blue} />
            <T weight="600">{busy.label}</T>
            {busy.pct != null && <View style={{ width: 240, maxWidth: '100%', height: 6, borderRadius: 3, backgroundColor: C.border } as any}><View style={{ width: `${busy.pct}%`, height: 6, borderRadius: 3, backgroundColor: C.blue }} /></View>}
          </View>
        </View>
      )}
    </View>
  );

  const overlays = (
    <>
      {toast && <View style={{ position: 'absolute', bottom: phone ? 76 : 24, alignSelf: 'center', backgroundColor: C.dark, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, maxWidth: Math.min(640, width - 24) }}><T size={13} color="#fff">{toast}</T></View>}
      <ResultModal result={result} onClose={() => setResult(null)} />
      {planOpen && <PlanModal scene={ed.scene} room={view?.room || roomOf(ed.scene, ed.data.venue)} title={ed.data.project.name} venue={ed.data.venue?.name || ''} projectId={projectId} version={ed.data.version}
        onClose={() => setPlanOpen(false)} onSaved={(url) => { setPlanOpen(false); setResult({ kind: 'floorplan', url }); }} />}
      {shareOpen && <ShareModal projectId={projectId} ed={ed} live={session} onClose={() => setShareOpen(false)} flash={flash} />}
      <DragChip />
      {hdriOpen && <HdriModal value={hdri} onClose={() => setHdriOpen(false)} onChange={(h) => ed.setScene((x) => ({ ...x, environment: { ...x.environment, hdri: h } }))} />}
    </>
  );

  if (phone) {
    // a phone: the room fills the screen; panels come up from the bottom, one at a time
    const tabs: [IconName, Left | 'edit', string][] = [...RAIL.map(([ic, k, label]) => [ic, k, label.replace('Add objects', 'Add').replace('AI assistant', 'AI')] as [IconName, Left, string]), [sel ? 'edit-3' : 'sliders', 'edit', sel ? 'Edit' : 'Event']];
    const sheetTitle = sheet === 'edit' ? (sel ? sel.name : 'Event settings') : RAIL.find(([, k]) => k === sheet)?.[2];
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 4, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, zIndex: 20 }}>
          {back}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={14} weight="600" numberOfLines={1}>{ed.data.project.name}</T>
            <T size={11} color={C.muted} numberOfLines={1}>{status}</T>
          </View>
          <IconBtn icon="corner-up-left" label="Undo" onPress={ed.undo} disabled={!ed.canUndo} />
          <IconBtn icon="corner-up-right" label="Redo" onPress={ed.redo} disabled={!ed.canRedo} />
          {peers}
          <Pressable onPress={() => setMore((m) => !m)} accessibilityLabel="More" style={{ padding: 8 }}><Icon name="more-vertical" size={20} /></Pressable>
          {more && (
            <ScrollView style={{ position: 'absolute', top: 50, right: 6, width: Math.min(300, width - 12), maxHeight: 520, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, zIndex: 50, boxShadow: '0 12px 30px rgba(20,30,50,.2)' } as any} contentContainerStyle={{ padding: 6, gap: 2 }}>
              <View style={{ flexDirection: 'row', gap: 8, padding: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <PlayLights onPlay={playLights} />{dayNight}{hdriButton}
                <IconBtn icon={cutaway ? 'eye-off' : 'eye'} label={cutaway ? 'Ceiling hidden' : 'Ceiling shown'} onPress={() => setCutaway((c) => !c)} />
              </View>
              <MenuItem icon="save" title={ed.dirty ? 'Save now' : 'Saved'} sub={status} onPress={() => { setMore(false); onSave(); }} />
              <MenuItem icon="share-2" title="Share" sub="Invite people, or a client review link" onPress={() => { setMore(false); setShareOpen(true); }} />
              <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
              {renderItems}
            </ScrollView>
          )}
        </View>
        <View style={{ flex: 1 }}>
          {viewportArea}
          {sheet && (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%', backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, boxShadow: '0 -8px 30px rgba(20,30,50,.18)', zIndex: 30 } as any}>
              <Pressable onPress={() => setSheet(null)} accessibilityLabel="Close panel" style={{ alignItems: 'center', paddingTop: 8 }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.border }} />
              </Pressable>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6 }}>
                <T size={15} weight="700" numberOfLines={1} style={{ flex: 1 }}>{sheetTitle}</T>
                <Pressable onPress={() => setSheet(null)} accessibilityLabel="Close" style={{ padding: 6 }}><Icon name="x" size={18} /></Pressable>
              </View>
              <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 8 }}>
                <PanelWidth.Provider value={width - 24}>{sheet === 'edit' ? properties : panel(sheet)}</PanelWidth.Provider>
              </View>
            </View>
          )}
        </View>
        <View style={{ height: 58, flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, paddingBottom: 2 }}>
          {tabs.map(([ic, k, label]) => {
            const on = sheet === k;
            return (
              <Pressable key={k} onPress={() => setSheet(on ? null : k)} accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <Icon name={ic} size={19} color={on ? C.blue : C.sub} />
                <T size={10.5} weight={on ? '700' : '500'} color={on ? C.blue : C.sub}>{label}</T>
              </Pressable>
            );
          })}
        </View>
        {overlays}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* top bar */}
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: tablet ? 8 : 12, gap: tablet ? 6 : 10, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, zIndex: 20 }}>
        {back}
        {!tablet && <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }}><Icon name="box" size={16} color="#fff" /></View>}
        <View style={{ maxWidth: tablet ? 170 : 260, flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><T size={14} weight="600" numberOfLines={1}>{ed.data.project.name}</T>{!tablet && <Badge label={`v${ed.data.version}`} />}</View>
          <T size={11} color={C.muted} numberOfLines={1}>{tablet ? status : `${ed.data.venue?.name || 'No venue'} · ${status}`}</T>
        </View>
        <View style={{ flex: 1 }} />
        {tools}
        <IconBtn icon="corner-up-left" label="Undo (Ctrl+Z)" onPress={ed.undo} disabled={!ed.canUndo} />
        <IconBtn icon="corner-up-right" label="Redo (Ctrl+Y)" onPress={ed.redo} disabled={!ed.canRedo} />
        {hdriButton}
        <PlayLights onPlay={playLights} />
        {/* day: the room's own light; evening: house lights down, the event lighting carries the room (and the render) */}
        {dayNight}
        <IconBtn icon={cutaway ? 'eye-off' : 'eye'} label={cutaway ? 'Ceiling hidden' : 'Ceiling shown'} onPress={() => setCutaway((c) => !c)} />
        <View style={{ flex: 1 }} />
        {peers}
        {ed.role === 'viewer' && <Badge label="View only" kind="gray" />}
        <Button kind="secondary" icon="save" label={tablet ? undefined : 'Save'} onPress={onSave} loading={ed.saving} disabled={!ed.dirty} />
        <Button kind="secondary" icon="share-2" label={tablet ? undefined : 'Share'} onPress={() => setShareOpen(true)} />
        {tablet && <IconBtn icon="sliders" label={sel ? 'Object settings' : 'Event settings'} onPress={() => setRightHidden(!rightHidden)} />}
        <View>
          <Button icon="camera" label={tablet ? undefined : 'Render'} onPress={() => setMenu((m) => !m)} />
          {menu && (
            <View style={{ position: 'absolute', top: 44, right: 0, width: 260, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 6, zIndex: 50, boxShadow: '0 12px 30px rgba(20,30,50,.18)' } as any}>
              {renderItems}
            </View>
          )}
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* left rail */}
        <View style={{ width: 56, backgroundColor: C.surface, borderRightWidth: 1, borderRightColor: C.border, alignItems: 'center', paddingTop: 12, gap: 8, zIndex: 12 }}>
          {RAIL.map(([ic, k, label]) => (
            <Pressable key={k} onPress={() => { if (left === k && !leftHidden) setLeftHidden(true); else { setLeft(k); setLeftHidden(false); } }} accessibilityLabel={label} style={{ width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: left === k && !leftHidden ? C.blueTint : 'transparent' }}>
              <Icon name={ic} size={20} color={left === k && !leftHidden ? C.blue : C.sub} />
            </Pressable>
          ))}
        </View>
        {tablet ? (
          // a tablet: the panels float over the room, so the view keeps its whole width
          <>
            {viewportArea}
            {!leftHidden && (
              <View style={{ position: 'absolute', left: 56, top: 0, bottom: 0, zIndex: 11, flexDirection: 'row', boxShadow: '8px 0 24px rgba(20,30,50,.14)' } as any}>
                <ResizablePanel side="left" storageKey="novira.panel.left" defaultWidth={300} min={240} max={Math.min(480, width - 160)} snaps={[260, 300, 380]} collapsed={false} onCollapsedChange={setLeftHidden}>{panel(left)}</ResizablePanel>
              </View>
            )}
            {(!rightHidden || sel) && (
              <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 11, flexDirection: 'row', boxShadow: '-8px 0 24px rgba(20,30,50,.14)' } as any}>
                <ResizablePanel side="right" storageKey="novira.panel.right" defaultWidth={300} min={260} max={Math.min(460, width - 160)} snaps={[280, 310, 380]} collapsed={false}
                  onCollapsedChange={(c) => { if (c) { setRightHidden(true); ed.setSelectedId(null); } }}>{properties}</ResizablePanel>
              </View>
            )}
          </>
        ) : (
          <>
            {/* left panel */}
            <ResizablePanel side="left" storageKey="novira.panel.left" defaultWidth={300} min={240} max={560} snaps={[260, 300, 380, 480]} collapsed={leftHidden} onCollapsedChange={setLeftHidden}>
              {panel(left)}
            </ResizablePanel>
            {viewportArea}
            {/* right panel */}
            <ResizablePanel side="right" storageKey="novira.panel.right" defaultWidth={310} min={260} max={520} snaps={[280, 310, 380, 460]} collapsed={rightHidden} onCollapsedChange={setRightHidden}>
              {properties}
            </ResizablePanel>
          </>
        )}
      </View>
      {overlays}
    </View>
  );
}

/**
 * The chip that follows the cursor while dragging: what you are holding, and —
 * live, before you let go — what releasing will do: where it lands, which
 * surface a material paints, or why it can't go there.
 */
function DragChip() {
  const { payload, pointer, intent, busy } = useAssetDrag();
  if (!payload) return null;
  const tone = intent.type === 'reject' ? { bg: '#FDECEC', border: '#F2B8B5', fg: C.red } : intent.type === 'none' ? { bg: C.surface, border: C.border, fg: C.sub } : { bg: '#EAF3FB', border: '#9CC7E8', fg: C.blue };
  const m = (v: number) => `${v.toFixed(2)} m`;
  const hint = busy || (intent.type === 'place'
    ? `Drop at ${m(intent.x)}, ${m(intent.z)}${intent.onTruss ? ' · clamps onto the truss' : intent.on ? ` · on ${intent.on} ${m(intent.y)} up` : ''}`
    : intent.type === 'paint' ? intent.text
      : intent.type === 'reject' ? intent.reason
        : payload.material ? 'Move over a surface in the 3D view' : 'Move over the 3D view');
  const icon: IconName = intent.type === 'reject' ? 'slash' : payload.material ? 'droplet' : 'box';
  const brush = !!payload.material;
  return (
    <>
    {brush && <Brush x={pointer.x} y={pointer.y} thumb={payload.thumb} state={intent.type === 'paint' ? 'paint' : intent.type === 'reject' ? 'reject' : 'none'} />}
    <View pointerEvents="none" style={{ position: 'fixed', left: pointer.x + (brush ? 34 : 16), top: pointer.y - (brush ? 40 : 0), transform: [{ translateY: -24 }], zIndex: 1000, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: tone.border, backgroundColor: tone.bg, boxShadow: '0 10px 28px rgba(14,42,74,.22)', backdropFilter: 'blur(6px)', maxWidth: 300 } as any}>
      <View style={{ width: 36, height: 36, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,.08)', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
        {payload.thumb ? <Image source={{ uri: payload.thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name={icon} size={16} color={tone.fg} />}
      </View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <T size={12} weight="600" color={intent.type === 'none' ? C.text : tone.fg} numberOfLines={1}>{payload.label}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          {intent.type !== 'none' && intent.type !== 'reject' && !busy ? <Icon name="check" size={11} color={tone.fg} /> : null}
          <T size={10.5} color={tone.fg} numberOfLines={1}>{hint}</T>
        </View>
      </View>
    </View>
    </>
  );
}

/**
 * The paintbrush cursor for materials: its bristle tip is exactly where the
 * material lands, the bristles are loaded with the material itself, and a small
 * ring marks the spot (blue: paints here, red: can't take a material).
 */
function Brush({ x, y, thumb, state }: { x: number; y: number; thumb?: string | null; state: 'paint' | 'reject' | 'none' }) {
  const S = 58, k = S / 24, tip = [2, 22]; // the tip in the 24-unit drawing
  const ring = state === 'paint' ? C.blue : state === 'reject' ? C.red : '#8A94A6';
  const h = createElement;
  return h('div', { style: { position: 'fixed', left: x - tip[0] * k, top: y - tip[1] * k, width: S, height: S, zIndex: 1001, pointerEvents: 'none', filter: 'drop-shadow(0 3px 5px rgba(14,42,74,.35))', opacity: state === 'reject' ? 0.75 : 1 } },
    h('svg', { width: S, height: S, viewBox: '0 0 24 24' },
      h('defs', null, h('pattern', { id: 'novira-brush-load', patternUnits: 'objectBoundingBox', width: 1, height: 1 },
        h('rect', { width: 12, height: 12, fill: '#C9CED6' }),
        thumb ? h('image', { href: thumb, width: 12, height: 12, preserveAspectRatio: 'xMidYMid slice' }) : null)),
      // handle, then the metal ferrule
      h('path', { d: 'M13.2 10.8 L21.2 2.8', stroke: '#1E2B3A', strokeWidth: 3.4, strokeLinecap: 'round' }),
      h('path', { d: 'M21 3 L19.6 4.4', stroke: '#5B7088', strokeWidth: 1.4, strokeLinecap: 'round' }),
      h('path', { d: 'M10.3 13.7 L13.3 10.7', stroke: '#C3CCD6', strokeWidth: 4.6, strokeLinecap: 'butt' }),
      h('path', { d: 'M10.1 13.9 L13.5 10.5', stroke: '#8D99A6', strokeWidth: 4.6, strokeLinecap: 'butt', strokeDasharray: '0.6 1.4' }),
      // bristles loaded with the material, tapering to the tip
      h('path', { d: 'M8.6 12.4 C7 13.2 6.2 14.6 5.8 16.4 C5.3 18.6 4 20.6 2 22 C4.4 21.8 7 21 8.8 19 C10.4 17.4 11.4 16.2 11.6 15.4 Z', fill: 'url(#novira-brush-load)', stroke: 'rgba(14,42,74,.55)', strokeWidth: 0.6, strokeLinejoin: 'round' }),
      // the spot being painted
      h('circle', { cx: tip[0], cy: tip[1], r: 1.6, fill: 'none', stroke: ring, strokeWidth: 0.9 }),
      state === 'reject' ? h('path', { d: 'M0.9 23.1 L3.1 20.9', stroke: C.red, strokeWidth: 0.9, strokeLinecap: 'round' }) : null,
    ));
}

/** Play / pause the lighting: moving heads run their effects, dimmers chase, colours fade (P). */
function PlayLights({ onPlay }: { onPlay: () => void }) {
  const [on, setOn] = useState(isPlaying());
  useEffect(() => { const off = onClock(() => setOn(isPlaying())); return () => { off(); }; }, []);
  return (
    <Pressable onPress={() => { if (on) setPlaying(false); else onPlay(); }} accessibilityLabel={on ? 'Pause the lighting (P)' : 'Play the lighting (P)'} {...({ title: on ? 'Pause the lighting (P)' : 'Play the lighting effects (P)' } as any)}
      style={({ hovered }: any) => ({ height: 36, paddingHorizontal: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? C.blue : C.bg, borderWidth: 1, borderColor: on ? C.blue : hovered ? C.blue : C.border })}>
      <Icon name={on ? 'pause' : 'play'} size={14} color={on ? '#fff' : C.blue} />
      <T size={12} weight="600" color={on ? '#fff' : C.text}>Lights</T>
    </Pressable>
  );
}

/** The show as it runs: each moment of the evening, the one playing and how far into it; click a moment to go there. */
function ShowTimeline() {
  const [, tick] = useState(0);
  const [on, setOn] = useState(isPlaying());
  useEffect(() => { const off = onClock(() => { setOn(isPlaying()); tick((n) => n + 1); }); return () => { off(); }; }, []);
  useEffect(() => { if (!on) return; const t = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(t); }, [on]);
  const moments = timeline(), total = timelineLength();
  if (!on || !moments.length || !total) return null;
  const at = momentAt(showTime());
  const starts = moments.map((_, i) => moments.slice(0, i).reduce((n, x) => n + x.seconds, 0));
  return (
    <View style={{ position: 'absolute', left: '50%', bottom: 16, transform: [{ translateX: '-50%' }], flexDirection: 'row', gap: 3, padding: 4, borderRadius: 10, backgroundColor: 'rgba(14,18,26,.72)', backdropFilter: 'blur(6px)', width: 460, maxWidth: '70%' } as any}>
      {moments.map((m, i) => {
        const from = starts[i];
        const current = at?.i === i, progress = current && at ? Math.min(1, at.into / m.seconds) : 0;
        return (
          <Pressable key={i} onPress={() => seek(from)} accessibilityLabel={`Go to ${m.label}`} {...({ title: `${m.label} · click to go there` } as any)}
            style={({ hovered }: any) => ({ flex: m.seconds, height: 30, borderRadius: 7, overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 8, backgroundColor: current ? 'rgba(255,255,255,.16)' : hovered ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.05)' })}>
            {current && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, backgroundColor: 'rgba(0,106,177,.55)' }} />}
            <T size={11} weight={current ? '700' : '500'} color={current ? '#fff' : 'rgba(255,255,255,.7)'} numberOfLines={1}>{m.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

function savedAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Segment({ items, value, onChange }: { items: [IconName, string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: C.bg, borderRadius: 8, padding: 3, gap: 2 }}>
      {items.map(([ic, v, label]) => (
        <Pressable key={v} onPress={() => onChange(v)} accessibilityLabel={label} {...({ title: label } as any)}
          style={{ height: 30, minWidth: 34, paddingHorizontal: 8, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: value === v ? C.surface : 'transparent', boxShadow: value === v ? '0 1px 3px rgba(0,0,0,.12)' : undefined } as any}>
          <Icon name={ic} size={15} color={value === v ? C.blue : C.sub} />
        </Pressable>
      ))}
    </View>
  );
}
function IconBtn({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} {...({ title: label } as any)} style={{ padding: 7, opacity: disabled ? 0.35 : 1 }}><Icon name={icon} size={17} /></Pressable>;
}
function MenuItem({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ hovered }: any) => ({ flexDirection: 'row', gap: 12, padding: 10, borderRadius: 8, backgroundColor: hovered ? C.bg : 'transparent' })}>
      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: C.blueTint, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={16} color={C.blue} /></View>
      <View><T size={13} weight="600">{title}</T><T size={11.5} color={C.sub}>{sub}</T></View>
    </Pressable>
  );
}

function ResultModal({ result, onClose }: { result: Result; onClose: () => void }) {
  if (!result) return null;
  const url = fileUrl(result.url);
  const title = { image: 'Snapshot saved', enhanced: 'Photoreal preview', panorama: '360° panorama saved', video: 'Walkthrough video saved', floorplan: 'Floor plan saved' }[result.kind] || 'Saved';
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(18,26,43,.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {/* always fits the window: the picture takes what room there is, the title and buttons stay in view */}
        <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 1100, maxHeight: '100%', gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={18} weight="700">{title}</T>
            <Pressable onPress={onClose}><Icon name="x" size={20} /></Pressable>
          </View>
          {result.note ? <ErrorNote text={result.note} /> : null}
          <View style={{ height: 'min(68vh, 640px)', flexShrink: 1, minHeight: 160, backgroundColor: '#0E1525', borderRadius: 10, overflow: 'hidden' } as any}>
            {result.kind === 'video'
              ? <video src={url} controls autoPlay style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
            <Button kind="secondary" icon="download" label="Download" onPress={() => window.open(url, '_blank')} />
            <Button kind="secondary" label="All renders" onPress={() => { onClose(); router.push('/renders'); }} />
            <Button label="Done" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
