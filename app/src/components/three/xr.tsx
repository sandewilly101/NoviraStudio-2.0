// The event in a headset or on a table (WebXR).
//  · VR — walk through it at real size: you start at the entrance facing the
//    stage; the left stick walks (where you look), the right stick turns in 30°
//    steps; the walls stop you.
//  · AR — the event as a 1:50 model on a real table (ARCore phones, passthrough
//    headsets): aim at a surface, tap to set it down, tap again to move it.
// A session must be asked for in the tap itself (startXR), then the driver
// inside the 3D view takes it over until it ends.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { flyPath, type CaptureCtx } from './capture';
import type { SceneObject } from '@/lib/types';

type Mode = 'vr' | 'ar';
type Active = { mode: Mode; session: XRSession; overlay: HTMLElement | null };

// ---- which kinds this device offers, and the session running now ----
const store = { active: null as Active | null, listeners: new Set<() => void>() };
const changed = () => store.listeners.forEach((l) => l());
const subscribe = (l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; };
/** 'vr' / 'ar' while a session runs, else null. */
export const useXrMode = () => useSyncExternalStore(subscribe, () => store.active?.mode ?? null, () => null);

/** Which of VR and AR this device can show (both false on an ordinary computer). */
export function useXrSupport() {
  const [s, setS] = useState({ vr: false, ar: false });
  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    let live = true;
    Promise.all([xr.isSessionSupported('immersive-vr').catch(() => false), xr.isSessionSupported('immersive-ar').catch(() => false)])
      .then(([vr, ar]) => { if (live) setS({ vr, ar }); });
    return () => { live = false; };
  }, []);
  return s;
}

/** Start VR or AR. Call it straight from a tap or click: browsers only allow a session from one. */
export async function startXR(mode: Mode) {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr || store.active) return;
  let overlay: HTMLElement | null = null;
  if (mode === 'ar') {
    // over the camera picture: what to do, and a way out
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 14px system-ui,sans-serif;color:#fff';
    overlay.innerHTML = '<div data-hint style="position:absolute;top:16px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.55)">Aim at a table or the floor, then tap to set the event down</div>'
      + '<button data-exit style="pointer-events:auto;position:absolute;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 22px;border:0;border-radius:999px;background:#fff;color:#111;font:600 15px system-ui,sans-serif">Exit AR</button>';
    document.body.appendChild(overlay);
  }
  const session = await xr.requestSession(mode === 'vr' ? 'immersive-vr' : 'immersive-ar', mode === 'vr'
    ? { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] }
    : { requiredFeatures: ['hit-test'], optionalFeatures: ['local-floor', 'dom-overlay'], ...(overlay ? { domOverlay: { root: overlay } } : {}) } as XRSessionInit);
  overlay?.querySelector<HTMLButtonElement>('[data-exit]')?.addEventListener('click', () => { session.end(); });
  store.active = { mode, session, overlay };
  changed();
}

const SCALE_AR = 1 / 50;
const WALK = 1.8; // metres a second at full stick
const TURN = Math.PI / 6;

/** Inside the 3D view: runs the session — where you stand, walking, placing the model. */
export function XRDriver({ objects, room, floorY }: { objects: SceneObject[]; room: CaptureCtx['room']; floorY: number }) {
  const { gl, scene, controls } = useThree() as unknown as { gl: THREE.WebGLRenderer; scene: THREE.Scene; controls: { enabled: boolean } | null };
  const mode = useXrMode();
  const sim = useMemo(() => ({ x: 0, z: 0, yaw: 0, base: null as XRReferenceSpace | null, turned: false, hit: null as XRHitTestSource | null, placed: false }), []);
  const reticle = useMemo(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
    m.matrixAutoUpdate = false; m.visible = false;
    return m;
  }, []);

  useEffect(() => {
    const active = store.active;
    if (!active) return;
    const { session, mode: m } = active;
    const world = scene.getObjectByName('__world');
    const saved = { background: scene.background, controls: controls?.enabled ?? true };
    let cancelled = false;
    (async () => {
      gl.xr.enabled = true;
      gl.xr.setReferenceSpaceType(m === 'vr' ? 'local-floor' : 'local');
      await gl.xr.setSession(session);
      if (cancelled) return;
      if (controls) controls.enabled = false;
      sim.base = gl.xr.getReferenceSpace();
      if (m === 'vr') {
        // stand at the entrance, facing the stage
        const start = flyPath(objects, room)[0];
        sim.x = start.pos.x; sim.z = start.pos.z;
        sim.yaw = Math.atan2(-(start.look.x - start.pos.x), -(start.look.z - start.pos.z));
        place();
      } else {
        scene.background = null; // the room around you shows through
        if (world) world.visible = false; // until it is set down
        scene.add(reticle);
        const viewer = await session.requestReferenceSpace('viewer');
        sim.hit = (await session.requestHitTestSource?.({ space: viewer })) || null;
        sim.placed = false;
        session.addEventListener('select', setDown);
      }
    })();
    // set the model down where the ring is, turned so its guests' side faces you
    function setDown() {
      if (!world || !reticle.visible) return;
      const at = new THREE.Vector3().setFromMatrixPosition(reticle.matrix), eye = new THREE.Vector3().setFromMatrixPosition(gl.xr.getCamera().matrixWorld);
      const yaw = Math.atan2(eye.x - at.x, eye.z - at.z);
      const cx = (room.minX + room.maxX) / 2, cz = (room.minZ + room.maxZ) / 2;
      world.scale.setScalar(SCALE_AR);
      world.rotation.set(0, yaw, 0);
      const centre = new THREE.Vector3(cx, floorY, cz).multiplyScalar(SCALE_AR).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      world.position.copy(at).sub(centre);
      world.visible = true;
      sim.placed = true;
      active?.overlay?.querySelector('[data-hint]')?.remove();
    }
    const ended = () => {
      session.removeEventListener('select', setDown);
      sim.hit?.cancel(); sim.hit = null; sim.base = null;
      scene.remove(reticle);
      if (world) { world.scale.setScalar(1); world.position.set(0, 0, 0); world.rotation.set(0, 0, 0); world.visible = true; }
      scene.background = saved.background;
      if (controls) controls.enabled = saved.controls;
      gl.xr.enabled = false;
      active.overlay?.remove();
      store.active = null;
      changed();
    };
    session.addEventListener('end', ended);
    return () => { cancelled = true; session.removeEventListener('end', ended); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per session
  }, [mode]);

  /** Put the viewer at (x, z) facing yaw: the reference space is moved the opposite way. */
  function place() {
    if (!sim.base) return;
    const m = new THREE.Matrix4().makeRotationY(sim.yaw).setPosition(sim.x, floorY, sim.z).invert();
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    m.decompose(p, q, new THREE.Vector3());
    gl.xr.setReferenceSpace(sim.base.getOffsetReferenceSpace(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w })));
  }

  useFrame((_, dt) => {
    const active = store.active;
    if (!active || !gl.xr.isPresenting) return;
    if (active.mode === 'ar') {
      const frame = gl.xr.getFrame(), space = gl.xr.getReferenceSpace();
      const hits = sim.hit && frame && space ? frame.getHitTestResults(sim.hit) : [];
      const pose = hits[0]?.getPose(space!);
      reticle.visible = !!pose;
      if (pose) reticle.matrix.fromArray(pose.transform.matrix);
      return;
    }
    // VR: the sticks
    let moveX = 0, moveY = 0, turn = 0;
    for (const src of active.session.inputSources) {
      const a = src.gamepad?.axes;
      if (!a || a.length < 4) continue;
      if (src.handedness === 'left') { moveX = a[2]; moveY = a[3]; } else if (src.handedness === 'right') turn = a[2];
    }
    let moved = false;
    if (Math.abs(turn) > 0.7 && !sim.turned) { sim.yaw -= Math.sign(turn) * TURN; sim.turned = true; moved = true; }
    if (Math.abs(turn) < 0.3) sim.turned = false;
    if (Math.hypot(moveX, moveY) > 0.15) {
      // walk where you look, level
      const look = new THREE.Vector3(); gl.xr.getCamera().getWorldDirection(look); look.y = 0;
      if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
      look.normalize();
      const side = new THREE.Vector3(-look.z, 0, look.x), step = Math.min(dt, 0.1) * WALK;
      sim.x += (look.x * -moveY + side.x * moveX) * step;
      sim.z += (look.z * -moveY + side.z * moveX) * step;
      sim.x = Math.min(room.maxX - 0.4, Math.max(room.minX + 0.4, sim.x));
      sim.z = Math.min(room.maxZ - 0.4, Math.max(room.minZ + 0.4, sim.z));
      moved = true;
    }
    if (moved) place();
  });
  return null;
}
