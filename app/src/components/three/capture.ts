// Browser-side rendering tools: snapshot, 360° panorama, walkthrough video and
// a top-down floor plan. No servers or GPUs needed.
import { useProgress } from '@react-three/drei';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { muxMp4, type Sample } from '@/lib/mp4';

export interface CaptureCtx {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: any;
  room: { minX: number; maxX: number; minZ: number; maxZ: number; height: number };
  setVenueVisible: (v: boolean) => void;
  /** Draw at this size (for a video), or back at the view's own size. */
  setSize?: (width: number, height: number, pixelRatio: number) => void;
}

/** The current view as a PNG; `scale` renders it at a higher resolution (capped at 2560 px wide). */
export function snapshot({ gl, scene, camera }: CaptureCtx, scale = 1) {
  const ratio = gl.getPixelRatio(), size = gl.getSize(new THREE.Vector2());
  const hi = Math.min(ratio * scale, 2560 / Math.max(1, size.x));
  if (hi > ratio) gl.setPixelRatio(hi);
  gl.render(scene, camera);
  const url = gl.domElement.toDataURL('image/png');
  if (hi > ratio) { gl.setPixelRatio(ratio); gl.render(scene, camera); }
  return url;
}

// Equirectangular 360° panorama from a point in the room (default: eye height, centre).
export function panorama(ctx: CaptureCtx, at?: THREE.Vector3, width = 4096) {
  const { gl, scene, room } = ctx;
  const pos = at || new THREE.Vector3((room.minX + room.maxX) / 2, 1.7, room.minZ + (room.maxZ - room.minZ) * 0.65);
  const cubeRT = new THREE.WebGLCubeRenderTarget(1536, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.05, 1000, cubeRT);
  cubeCam.position.copy(pos);
  scene.add(cubeCam);
  cubeCam.update(gl, scene);
  scene.remove(cubeCam);

  const h = width / 2;
  const outRT = new THREE.WebGLRenderTarget(width, h);
  outRT.texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: cubeRT.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform samplerCube map; varying vec2 vUv;
      void main(){
        float lon = (vUv.x - 0.5) * 6.28318530718;
        float lat = (vUv.y - 0.5) * 3.14159265359;
        vec3 dir = vec3(sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat));
        gl_FragColor = linearToOutputTexel(textureCube(map, dir));
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const qScene = new THREE.Scene(); qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(outRT);
  gl.render(qScene, qCam);
  const pixels = new Uint8Array(width * h * 4);
  gl.readRenderTargetPixels(outRT, 0, 0, width, h, pixels);
  gl.setRenderTarget(prev);
  cubeRT.dispose(); outRT.dispose(); mat.dispose(); quad.geometry.dispose();
  return pixelsToDataUrl(pixels, width, h, 'image/jpeg');
}

function pixelsToDataUrl(px: Uint8Array, w: number, h: number, type = 'image/png') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // flip Y
  g.putImageData(img, 0, 0);
  return c.toDataURL(type, 0.92);
}

// Top-down orthographic plan of the furniture (venue shell hidden so the roof
// doesn't cover the room).
export function floorPlan(ctx: CaptureCtx, px = 2400) {
  const { gl, scene, room } = ctx;
  const w = room.maxX - room.minX, d = room.maxZ - room.minZ, pad = 1.5;
  const aspect = (w + pad * 2) / (d + pad * 2);
  const cam = new THREE.OrthographicCamera(-(w / 2 + pad), w / 2 + pad, d / 2 + pad, -(d / 2 + pad), 0.1, 200);
  cam.position.set((room.minX + room.maxX) / 2, 80, (room.minZ + room.maxZ) / 2);
  cam.up.set(0, 0, -1);
  cam.lookAt(cam.position.x, 0, cam.position.z);
  const pw = aspect >= 1 ? px : Math.round(px * aspect), ph = aspect >= 1 ? Math.round(px / aspect) : px;
  const rt = new THREE.WebGLRenderTarget(pw, ph, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prevBg = scene.background;
  scene.background = new THREE.Color('#FFFFFF');
  ctx.setVenueVisible(false);
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.render(scene, cam);
  const pixels = new Uint8Array(pw * ph * 4);
  gl.readRenderTargetPixels(rt, 0, 0, pw, ph, pixels);
  gl.setRenderTarget(prev);
  ctx.setVenueVisible(true);
  scene.background = prevBg;
  rt.dispose();
  return pixelsToDataUrl(pixels, pw, ph);
}

// ---------------------------------------------------------------------------
// The walkthrough video

/** While a video is being recorded: the view keeps full resolution (it would drop it while the camera moves). */
export const captureState = { recording: false, tap: null as ((canvas: HTMLCanvasElement) => void) | null };

type Key = { pos: THREE.Vector3; look: THREE.Vector3 };

/**
 * A fly-through a guest would take: in at the entrance end at eye height, down
 * the clearest aisle towards the stage, across the stage front, then up over
 * the tables for the reveal — always under the ceiling and inside the walls.
 */
export function flyPath(objects: SceneObject[], room: CaptureCtx['room']): Key[] {
  const cx = (room.minX + room.maxX) / 2, cz = (room.minZ + room.maxZ) / 2;
  const focus = objects.find((o) => o.type === 'stage') || objects.find((o) => o.type === 'led_screen');
  const sx = focus ? focus.position[0] : cx, sz = focus ? focus.position[2] : room.minZ + 1;
  // towards the guests: from the stage to the middle of the room
  let dx = cx - sx, dz = cz - sz;
  const dl = Math.hypot(dx, dz);
  if (dl < 0.5) { dx = 0; dz = 1; } else { dx /= dl; dz /= dl; }
  const px = -dz, pz = dx; // across the room
  const inside = (x: number, z: number): [number, number] => [Math.min(room.maxX - 0.8, Math.max(room.minX + 0.8, x)), Math.min(room.maxZ - 0.8, Math.max(room.minZ + 0.8, z))];
  // how far the room runs from the stage in a direction
  const reach = (ux: number, uz: number) => {
    let t = 0;
    while (t < 200) { const x = sx + ux * t, z = sz + uz * t; if (x < room.minX || x > room.maxX || z < room.minZ || z > room.maxZ) break; t += 0.25; }
    return t;
  };
  const far = Math.max(4, reach(dx, dz) - 1.2), half = Math.max(2, Math.min(reach(px, pz), reach(-px, -pz)) - 1.2);
  // the clearest aisle: the line from the far end to the stage that keeps furthest from the furniture
  const floorObjects = objects.filter((o) => o.position[1] < 0.6 && o.type !== 'dance_floor' && o.type !== 'stage' && o.type !== 'light');
  let aisle = 0, best = -Infinity;
  for (let s = -half; s <= half; s += 0.25) {
    let clear = Infinity;
    for (let t = 2.5; t <= far; t += 0.75) {
      const x = sx + dx * t + px * s, z = sz + dz * t + pz * s;
      for (const o of floorObjects) clear = Math.min(clear, Math.hypot(o.position[0] - x, o.position[2] - z) - Math.max(o.size[0], o.size[2]) / 2);
    }
    if (clear > best + 0.05 || (Math.abs(clear - best) <= 0.05 && Math.abs(s) < Math.abs(aisle))) { best = clear; aisle = s; }
  }
  const eye = 1.65, top = Math.max(2.4, Math.min(room.height - 0.7, 5.5));
  const stageDepth = focus ? Math.min(focus.size[0], focus.size[2]) : 1;
  const at = (t: number, s: number, y: number) => { const [x, z] = inside(sx + dx * t + px * s, sz + dz * t + pz * s); return new THREE.Vector3(x, y, z); };
  const stageLook = new THREE.Vector3(sx, focus?.type === 'stage' ? focus.size[1] + 1.3 : 1.8, sz);
  const roomLook = at(far * 0.55, aisle * 0.3, 0.7);
  return [
    { pos: at(far, aisle, eye), look: stageLook }, // in at the entrance end
    { pos: at(far * 0.62, aisle, eye - 0.05), look: stageLook }, // down the aisle
    { pos: at(far * 0.3, aisle * 0.6, eye + 0.1), look: stageLook },
    { pos: at(stageDepth / 2 + 3, half * 0.55, eye + 0.4), look: stageLook }, // across the stage front
    { pos: at(stageDepth / 2 + 3.2, -half * 0.55, eye + 1.2), look: stageLook },
    { pos: at(stageDepth / 2 + 1.5, 0, top), look: roomLook }, // up, turning to the room
  ];
}

/**
 * Records the fly-through frame by frame with the browser's own H.264 encoder:
 * each frame is drawn at its exact moment of the path and stamped with its exact
 * time, so the video plays a smooth `fps` however slowly this computer draws.
 * Written out as a standard MP4.
 */
export async function walkthrough(ctx: CaptureCtx, objects: SceneObject[], opts: {
  seconds?: number; fps?: number; width?: number; height?: number; onProgress?: (p: number) => void;
  show?: { playing: boolean; time: number; seek: (t: number) => void };
} = {}): Promise<{ blob: Blob; ext: 'mp4' }> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('This browser can’t make videos. Use Chrome, Edge or a recent Safari.');
  const { camera, controls, room, gl } = ctx, seconds = opts.seconds ?? 16, fps = opts.fps ?? 30, frames = Math.round(seconds * fps);
  const W = opts.width ?? 1920, H = opts.height ?? 1080;
  // the best H.264 this browser can write at this size: High, then Main, then Baseline profile
  let config: VideoEncoderConfig | null = null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']) {
    const c: VideoEncoderConfig = { codec, width: W, height: H, bitrate: 12_000_000, framerate: fps, avc: { format: 'avc' } };
    if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; }
  }
  if (!config) throw new Error('This browser can’t write H.264 video at this size.');

  const keys = flyPath(objects, room);
  const posCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal');
  // where to look: eased from one key's target to the next (a curve through repeated points would break down)
  const lookAt = (e: number) => {
    const f = e * (keys.length - 1), i = Math.min(keys.length - 2, Math.floor(f)), k = f - i, sm = k * k * (3 - 2 * k);
    return keys[i].look.clone().lerp(keys[i + 1].look, sm);
  };
  const prevSize = gl.getSize(new THREE.Vector2()), prevRatio = gl.getPixelRatio();
  const cam = camera as THREE.PerspectiveCamera, prevAspect = cam.aspect;
  const start = { pos: camera.position.clone(), target: controls?.target?.clone() as THREE.Vector3 | undefined };

  const samples: Sample[] = [];
  let description: Uint8Array | null = null, failed: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d as ArrayBuffer).slice();
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
    },
    error: (e) => { failed = e as Error; },
  });
  encoder.configure(config);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** The next frame as drawn (taken the moment the drawing is finished), encoded as frame `i`. */
  const encodeNext = (i: number) => new Promise<void>((resolve) => {
    captureState.tap = (canvas) => {
      captureState.tap = null;
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      resolve();
    };
  });

  captureState.recording = true;
  if (controls) controls.enabled = false;
  ctx.setSize?.(W, H, 1);
  cam.aspect = W / H; cam.updateProjectionMatrix();
  try {
    for (let n = 0; n < 3; n++) await new Promise((r) => requestAnimationFrame(r)); // the new size settles
    for (let i = 0; i < frames && !failed; i++) {
      const t = i / (frames - 1), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in and out
      const look = lookAt(e);
      camera.position.copy(posCurve.getPoint(e)); // by key, in step with where it looks
      camera.lookAt(look);
      if (controls?.target) controls.target.copy(look);
      if (opts.show?.playing) opts.show.seek(opts.show.time + i / fps); // the lighting runs in video time
      await encodeNext(i);
      while (encoder.encodeQueueSize > 4) await wait(4);
      opts.onProgress?.((i + 1) / frames);
    }
    await encoder.flush();
  } finally {
    captureState.tap = null;
    if (encoder.state !== 'closed') encoder.close();
    ctx.setSize?.(prevSize.x, prevSize.y, prevRatio);
    cam.aspect = prevAspect; cam.updateProjectionMatrix();
    camera.position.copy(start.pos);
    if (controls) { if (start.target) controls.target.copy(start.target); controls.enabled = true; controls.update(); }
    if (opts.show?.playing) opts.show.seek(opts.show.time);
    captureState.recording = false;
  }
  if (failed) throw failed;
  if (!description || !samples.length) throw new Error('The video encoder gave nothing back.');
  return { blob: muxMp4(samples, description, W, H, fps), ext: 'mp4' };
}

// ---------------------------------------------------------------------------
// The concept picture's view

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** After `n` frames have been drawn. */
export const nextFrames = (n: number) => new Promise<void>((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

/**
 * The hero view, as an event photographer frames it: from the guests' end of the room, on its centre
 * line and above their heads, looking at the stage with the room opening out in front of it.
 */
export function heroView(objects: SceneObject[], room: CaptureCtx['room']) {
  const cx = (room.minX + room.maxX) / 2, cz = (room.minZ + room.maxZ) / 2;
  const focus = objects.find((o) => o.type === 'stage') || objects.find((o) => o.type === 'led_screen');
  const sx = focus ? focus.position[0] : cx, sz = focus ? focus.position[2] : room.minZ + 1;
  let dx = cx - sx, dz = cz - sz;
  const dl = Math.hypot(dx, dz);
  if (dl < 0.5) { dx = 0; dz = 1; } else { dx /= dl; dz /= dl; }
  // as far down the room as it goes, short of the far wall
  let t = 0;
  while (t < 200) { const x = sx + dx * (t + 0.25), z = sz + dz * (t + 0.25); if (x < room.minX || x > room.maxX || z < room.minZ || z > room.maxZ) break; t += 0.25; }
  // just behind the last guests (an open-air site runs far beyond them), short of any wall
  const SEATING = ['chair', 'round_table', 'long_table', 'cocktail_table', 'sofa', 'dance_floor'];
  const guests = objects.filter((o) => SEATING.includes(o.type));
  const seen = guests.length ? guests : objects.filter((o) => o.type !== 'stage' && o.type !== 'led_screen' && o.position[1] < 2.5);
  const along = (o: SceneObject) => (o.position[0] - sx) * dx + (o.position[2] - sz) * dz;
  const across = (o: SceneObject) => Math.abs((o.position[0] - sx) * dz - (o.position[2] - sz) * dx);
  const reach = Math.max(0, ...seen.map(along));
  // and far enough back that the widest seating fits the 3:2 frame of a 50° lens (half-width ≈ 35°; the outer edges may crop a little)
  const fit = Math.max(0, ...seen.map((o) => along(o) + across(o) / Math.tan(THREE.MathUtils.degToRad(38))));
  const back = Math.max(4, Math.min(t - 1.5, Math.max(reach + 4, fit)));
  // a small room: eye level over the heads, looking at the stage. A big site: higher the further back,
  // looking down onto the middle of the guests so they fill the frame, with the stage above them
  const big = back > 14;
  // (indoors no higher than about half the ceiling: below the chandeliers and drapes)
  const top = room.height >= 30 ? 14 : Math.max(3.6, Math.min(room.height * 0.55, 6));
  const h = Math.max(2.2, Math.min(room.height - 0.6, big ? Math.min(top, back * 0.3) : 3.6));
  const pos = new THREE.Vector3(sx + dx * back, h, sz + dz * back);
  let lookY = focus?.type === 'stage' ? focus.size[1] + 1.1 : 1.6;
  if (big) {
    // tilted so the nearest guests sit just above the bottom edge (no empty foreground), but never so far
    // down that the stage and its screen leave the top of the frame
    const deg = THREE.MathUtils.degToRad, half = deg(25);
    const toNear = Math.atan2(h, Math.max(1, back - reach)), toStageTop = Math.atan2(h - (focus ? focus.position[1] + focus.size[1] + 5 : 4), back);
    const pitch = Math.max(deg(4), Math.min(toNear - half * 0.8, toStageTop + half * 0.85));
    lookY = h - Math.tan(pitch) * back;
  }
  const look = new THREE.Vector3(sx + dx * back * 0.15 * (big ? 0 : 1), lookY, sz + dz * back * 0.15 * (big ? 0 : 1));
  return { pos, look };
}

/** Put the camera at the hero view (a 50 mm-ish 50° lens). */
export function frameHero(ctx: CaptureCtx, scene: { objects: SceneObject[] }) {
  const { pos, look } = heroView(scene.objects, ctx.room);
  ctx.camera.position.copy(pos);
  (ctx.camera as THREE.PerspectiveCamera).fov = 50;
  ctx.camera.updateProjectionMatrix();
  ctx.camera.lookAt(look);
  if (ctx.controls?.target) { ctx.controls.target.copy(look); ctx.controls.update(); }
}

/**
 * Ready when every model and texture has finished downloading (three.js's loading manager, as drei's
 * useProgress reports it) and nothing new has appeared in the scene for a while after that.
 */
export async function settled(ctx: CaptureCtx, quietMs = 2500, maxMs = 120000) {
  // what is actually drawn, not just what exists: a model can be in the scene before it renders (instances
  // moving between detail levels, a lighter mesh swapped in, shaders still compiling)
  const count = () => {
    let n = 0, inst = 0, geo = 0;
    ctx.scene.traverseVisible((o) => {
      const m = o as THREE.InstancedMesh;
      if (!m.isMesh) return;
      n++; inst += m.isInstancedMesh ? m.count : 1; geo += m.geometry?.id || 0;
    });
    return `${n}:${inst}:${geo}:${ctx.gl.info.programs?.length ?? 0}`;
  };
  const loading = () => { const p = useProgress.getState(); return p.active || p.loaded < p.total; };
  let last = '', since = performance.now();
  const start = performance.now();
  await wait(1500); // let the first downloads start
  while (performance.now() - start < maxMs) {
    const n = count();
    if (n !== last || loading()) { last = n; since = performance.now(); }
    else if (performance.now() - since > quietMs) return;
    await wait(400);
  }
}

/** The ids of the objects the camera can see (inside its view, in front of it, not too far): what the picture shows. */
export function visibleIds(ctx: CaptureCtx, objects: SceneObject[]) {
  const v = new THREE.Vector3();
  return objects.filter((o) => {
    // its middle, or its top for tall things (a screen, a truss), on screen
    for (const y of [o.position[1] + o.size[1] / 2, o.position[1] + o.size[1] * 0.9]) {
      v.set(o.position[0], y, o.position[2]).project(ctx.camera);
      if (v.z < 1 && Math.abs(v.x) <= 1.02 && Math.abs(v.y) <= 1.02) return true;
    }
    return false;
  }).map((o) => o.id);
}
