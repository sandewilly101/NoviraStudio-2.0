// The preview of an object being dragged into the room: the real object, drawn
// as a translucent blue hologram where it will land, on a soft blue footprint
// with its size — gently pulsing while a library model finishes importing.
// And, for a material, the exact surface it would paint lit up in blue.
// Neither takes clicks or drops.
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { C } from '@/lib/theme';
import { ghostSpot } from '@/lib/assetDrag';

function label(text: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(14,42,74,0.92)';
  g.beginPath(); g.roundRect(8, 24, 496, 80, 40); g.fill();
  g.fillStyle = '#fff'; g.font = '600 44px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// one hologram material for every preview: translucent, glowing faintly, never hiding what is behind it
const HOLO = new THREE.MeshStandardMaterial({ color: C.blue, transparent: true, opacity: 0.36, depthWrite: false, roughness: 0.5, metalness: 0, emissive: new THREE.Color(C.blue), emissiveIntensity: 0.22 });
const HOLO_LINE = new THREE.MeshBasicMaterial({ color: C.blue, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });

/** Children that clicks and drops pass straight through. */
export function NoPick({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  // instanced models mount a little later, so check a few frames, then stop
  const frames = useRef(0);
  useFrame(() => { if (frames.current++ < 30) g.current?.traverse((n) => { n.raycast = () => undefined; }); });
  return <group ref={g}>{children}</group>;
}

// `o` is built once per drag; where it is comes from `ghostSpot` every frame, so moving it costs no re-render.
export function Ghost({ o, pending, children }: { o: SceneObject; pending?: boolean; children?: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  // the object's own meshes (they mount over a few frames) all become the hologram
  const holoFrames = useRef(0);
  useLayoutEffect(() => { holoFrames.current = 0; }, [o]);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const outline = useRef<THREE.LineSegments>(null);
  const [w, h, d] = o.size;
  const text = pending ? 'Importing…' : `${w.toFixed(2).replace(/\.?0+$/, '')} × ${d.toFixed(2).replace(/\.?0+$/, '')} m`;
  const tex = useMemo(() => label(text), [text]);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(w + 0.08, d + 0.08)), [w, d]);

  // the preview is not part of the scene: nothing can click or drop onto it
  useLayoutEffect(() => { group.current?.traverse((n) => { n.raycast = () => undefined; }); outline.current?.computeLineDistances(); });
  useFrame(({ clock }) => {
    if (body.current && holoFrames.current++ < 40) body.current.traverse((n: any) => {
      n.raycast = () => undefined;
      if (n.isMesh || n.isInstancedMesh) { n.material = n.isLine ? HOLO_LINE : HOLO; n.castShadow = false; n.receiveShadow = false; }
      if (n.isSpotLight || n.isPointLight) n.visible = false;
    });
    if (fill.current) fill.current.opacity = pending ? 0.12 + 0.1 * Math.sin(clock.elapsedTime * 5) : 0.2;
    if (group.current && !pending) { group.current.position.set(ghostSpot.x, ghostSpot.y, ghostSpot.z); group.current.rotation.set(0, ghostSpot.ry, 0); }
  });

  // what sits on the floor gets its footprint at the floor; lights and screens carry their own height
  const floorY = -o.position[1];
  return (
    <group ref={group} position={o.position} rotation={o.rotation as any}>
      <group ref={body}>{children}</group>
      <group position={[0, floorY + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh><planeGeometry args={[w + 0.08, d + 0.08]} /><meshBasicMaterial ref={fill} color={C.blue} transparent opacity={0.2} depthWrite={false} toneMapped={false} /></mesh>
        <lineSegments ref={outline} geometry={edges}><lineDashedMaterial color={C.blue} dashSize={0.12} gapSize={0.07} toneMapped={false} /></lineSegments>
      </group>
      <sprite position={[0, Math.max(h, 0.4) + 0.35, 0]} scale={[1.3, 0.32, 1]}>
        <spriteMaterial map={tex} depthTest={false} transparent toneMapped={false} />
      </sprite>
      {pending && (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w, h, d]} />
          <meshBasicMaterial color={C.blue} wireframe transparent opacity={0.45} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/** What a material drag would paint: an object's surface, or a venue surface. */
export type PaintTarget = { objectId?: string; slot?: string; venueKey?: string } | null;

/**
 * Light up the exact surface a material would paint — the deck but not the
 * legs, the tablecloth but not the chairs, one venue floor. An additive blue
 * copy of those meshes drawn over the scene; the scene's own materials are
 * never touched, so a cancelled drag can't leave anything blue.
 */
export function PartHighlight({ target, objects, slotOf }: { target: PaintTarget; objects: SceneObject[]; slotOf: (o: SceneObject, part?: string) => string | null }) {
  const { scene } = useThree();
  const overlay = useMemo(() => {
    if (!target) return null;
    const group = new THREE.Group(), material = new THREE.MeshBasicMaterial({ color: C.blue, transparent: true, opacity: 0.4, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    scene.updateMatrixWorld();
    const tmp = new THREE.Matrix4();
    const copy = (mesh: THREE.Mesh, matrix: THREE.Matrix4) => {
      const m = new THREE.Mesh(mesh.geometry, material);
      m.matrixAutoUpdate = false; m.matrix.copy(matrix); m.renderOrder = 999; m.raycast = () => undefined;
      group.add(m);
    };
    const each = (mesh: any) => {
      if (mesh.isInstancedMesh) for (let i = 0; i < Math.min(mesh.count, 400); i++) { mesh.getMatrixAt(i, tmp); copy(mesh, mesh.matrixWorld.clone().multiply(tmp)); }
      else copy(mesh, mesh.matrixWorld);
    };
    if (target.venueKey) scene.getObjectByName('__venue')?.traverse((n: any) => { if (n.isMesh && n.userData.venueKey === target.venueKey) each(n); });
    else if (target.objectId) {
      const o = objects.find((x) => x.id === target.objectId);
      if (!o) return null;
      // built objects: the parts of that surface
      scene.getObjectByName(o.id)?.traverse((n: any) => {
        if (!n.isMesh) return;
        let part: string | undefined, p: any = n;
        while (p && !part) { part = p.userData?.part; p = p.parent; }
        if (slotOf(o, part) === target.slot) each(n);
      });
      // sourced models drawn in batches: just this object's copy
      scene.traverse((n: any) => {
        if (!n.isInstancedMesh || !n.userData.ids) return;
        const i = (n.userData.ids as string[]).indexOf(o.id);
        if (i < 0 || slotOf(o, n.userData.part) !== target.slot) return;
        n.getMatrixAt(i, tmp); copy(n, n.matrixWorld.clone().multiply(tmp));
      });
    }
    return group.children.length ? { group, material } : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the target changes
  }, [scene, target?.objectId, target?.slot, target?.venueKey]);
  useLayoutEffect(() => () => overlay?.material.dispose(), [overlay]);
  return overlay ? <primitive object={overlay.group} /> : null;
}
