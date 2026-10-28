// Picture of a procedural object, rendered once with Nozila's own build in an
// offscreen renderer, then cached. Used for the inspector thumbnail and the
// "varieties" window.
import { createRoot, extend } from '@react-three/fiber';
import { Suspense, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { NozilaBody } from './adapter';

// this offscreen root can draw before any <Canvas> has mounted, so it registers three.js itself
extend(THREE as any);

const SIZE = 320;
const TIMEOUT_MS = 20000;
const cache = new Map<string, string>();
const STORE = 'novira.thumbs.v1';
// pictures survive a reload, so the library never waits on them twice
try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(STORE) || '{}'))) cache.set(k, v as string); } catch { /* no storage */ }
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...cache.entries()].slice(-120)))); } catch { /* full: keep in memory */ } };
/** The picture of an object if it has already been drawn. */
export const cachedThumbnail = (o: SceneObject) => cache.get(keyOf(o)) || null;
let queue: Promise<unknown> = Promise.resolve();

const keyOf = (o: SceneObject) => JSON.stringify([o.type, o.variant, o.size, o.color, o.spec, o.text?.content]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One shared offscreen renderer (a single WebGL context), reused for every picture.
let canvas: HTMLCanvasElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function render(o: SceneObject): Promise<string> {
  if (!canvas || !root) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    root = createRoot(canvas);
    await root.configure({
      size: { width: SIZE, height: SIZE, top: 0, left: 0 }, dpr: 1, frameloop: 'never', flat: true,
      gl: { preserveDrawingBuffer: true, antialias: true, alpha: false },
      camera: { fov: 32, near: 0.05, far: 500, position: [5, 4, 8] },
    });
  }
  {
    root.render(null); // never leave the previous item on screen
    await wait(0);
    // LED walls are drawn from their bottom edge, like in the room
    const lift = o.type === 'led_screen' ? (o.spec?.bottomMm ?? 1000) / 1000 : 0;
    const shown: SceneObject = { ...o, position: [0, lift, 0], rotation: [0, 0, 0] };
    const store: any = root.render(
      <>
        <color attach="background" args={['#F1F4F8']} />
        <hemisphereLight args={['#ffffff', '#9aa4b2', 1.6]} />
        <directionalLight position={[6, 10, 8]} intensity={1.8} />
        <directionalLight position={[-6, 4, -4]} intensity={0.6} />
        {/* builds with lettering load a font first; the marker appears once they are ready */}
        <Suspense fallback={null}>
          <group name="thumb-subject" position={[0, lift, 0]}><NozilaBody o={shown} /></group>
        </Suspense>
      </>,
    );
    const { gl, scene, camera } = store.getState() as { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera };
    for (let i = 0; i < 3; i++) await wait(60); // geometry and canvas textures settle
    for (let i = 0; i < 40 && !scene.getObjectByName('thumb-subject'); i++) await wait(100); // fonts
    const subject = scene.getObjectByName('thumb-subject');
    let box = subject ? new THREE.Box3().setFromObject(subject) : new THREE.Box3();
    // text still loading fonts can leave an empty or infinite box: frame the real size instead
    const ok = !box.isEmpty() && [box.min.x, box.min.y, box.max.x, box.max.y, box.max.z].every(Number.isFinite);
    if (!ok) box = new THREE.Box3(new THREE.Vector3(-o.size[0] / 2, lift, -o.size[2] / 2), new THREE.Vector3(o.size[0] / 2, lift + o.size[1], o.size[2] / 2));
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z, 0.5) * 1.9 + 0.3;
    camera.position.set(centre.x + dist * 0.55, centre.y + dist * 0.42, centre.z + dist * 0.75);
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
    gl.render(scene, camera);
    return canvas.toDataURL('image/jpeg', 0.86);
  }
}

export function thumbnailFor(o: SceneObject): Promise<string> {
  const key = keyOf(o);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const job = queue.then(() => Promise.race([
    render(o),
    wait(TIMEOUT_MS).then(() => { throw new Error('timed out'); }),
  ])).then((url) => { cache.set(key, url as string); persist(); return url as string; });
  queue = job.catch(() => undefined); // one slow or failed picture never blocks the rest
  return job;
}

export function ProceduralThumb({ o, size = 56 }: { o: SceneObject; size?: number | `${number}%` }) {
  const [url, setUrl] = useState<string | null>(() => cache.get(keyOf(o)) || null);
  useEffect(() => {
    let live = true;
    thumbnailFor(o).then((u) => live && setUrl(u)).catch((e) => console.warn('[novira] thumbnail failed', o.type, o.variant, e?.message || e));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on what the picture shows
  }, [keyOf(o)]);
  return (
    <View style={{ width: size, height: size, backgroundColor: '#F1F4F8' }}>
      {url ? <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
    </View>
  );
}
