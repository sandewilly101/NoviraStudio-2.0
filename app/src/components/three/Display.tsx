// Display surfaces as they are hired or printed, each carrying its content
// (a design, an image or a looping video) on the right face:
//  · easel      — foam-board poster (5 mm) on a three-leg studio easel with a ledge
//  · rollup     — pull-up banner: aluminium cassette with end caps and swivel
//                 feet, shock-corded pole behind, clip rail on top
//  · backdrop   — step-and-repeat: 40 mm tube frame on T-feet, stretched
//                 pillowcase fabric print wrapping the frame
//  · media-wall — SEG fabric lightbox: deep aluminium frame, silicone-edged
//                 print lit from behind, on feet
//  · hanging    — PVC banner with top and bottom pole pockets, rods, steel wires
//  · tv         — 4K screen with a slim bezel on a mobile trolley stand
// Object space: centred on x/z, floor at y = 0 (a hanging banner's bottom edge is its position).
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { defaultDisplay, displayFace, useSurfaceTexture } from '@/lib/content';
import { BOX, CYL, FIN, PartList, RenderParts, place, tube, v3 } from './kit';

export const DISPLAY_TYPES = [
  ['easel', 'Poster on easel', 'Foam-board A1/A0 poster on a studio easel', [0.66, 1.75, 0.6]],
  ['rollup', 'Roll-up banner', '85 × 200 cm pull-up with cassette base', [0.85, 2.13, 0.32]],
  ['backdrop', 'Step-and-repeat backdrop', 'Fabric print on a tube frame, 3 × 2.4 m', [3, 2.43, 0.5]],
  ['media-wall', 'Backlit media wall', 'SEG fabric lightbox, 3 × 2.4 m', [3, 2.5, 0.35]],
  ['hanging', 'Hanging banner', 'PVC banner on rods, hung on wires', [4, 1.2, 0.04]],
  ['tv', 'Screen on stand', '65″ 4K display on a trolley stand', [1.48, 1.85, 0.7]],
] as const;

function Face({ o, w, h, at, glow = 0, back = false }: { o: SceneObject; w: number; h: number; at: [number, number, number]; glow?: number; back?: boolean }) {
  const tex = useSurfaceTexture(o);
  return (
    <mesh position={at} rotation={[0, back ? Math.PI : 0, 0]} receiveShadow>
      <planeGeometry args={[w, h]} />
      {glow > 0
        ? <meshBasicMaterial map={tex} color={new THREE.Color(1, 1, 1).multiplyScalar(glow)} toneMapped={false} />
        : <meshStandardMaterial map={tex} roughness={0.75} metalness={0} color={tex ? '#ffffff' : '#DDE2E8'} />}
    </mesh>
  );
}

export function Display({ o }: { o: SceneObject }) {
  const kind = o.variant || defaultDisplay(o);
  const [W, H, D] = o.size;
  const f = displayFace(o);
  const L = new PartList();
  const alu = FIN.aluminium('#C3C7CC'), black = FIN.powder('#17181B');

  switch (kind) {
    case 'easel': {
      const bottom = H - f.h, wood = FIN.plastic('#2A2420');
      L.add('board', BOX, FIN.melamine('#F6F6F4'), place(0, bottom + f.h / 2 + 0.012, 0.012, f.w, f.h, 0.005, new THREE.Euler(-0.12, 0, 0)));
      const top = v3(0, bottom + f.h * 0.7, -0.03);
      for (const sx of [-1, 1]) L.add('leg', CYL, wood, tube(v3(sx * W * 0.42, 0, 0.12), top.clone().add(v3(sx * 0.05, 0, 0)), 0.012));
      L.add('leg', CYL, wood, tube(v3(0, 0, -D * 0.7), top, 0.012));
      L.add('ledge', BOX, wood, place(0, bottom - 0.01, 0.06, W, 0.025, 0.07));
      return <group><RenderParts list={L} /><group position={[0, bottom + f.h / 2 + 0.012, 0.012]} rotation={[-0.12, 0, 0]}><Face o={o} w={f.w} h={f.h} at={[0, 0, 0.0031]} /></group></group>;
    }
    case 'rollup': {
      L.add('cassette', BOX, alu, place(0, 0.06, 0, W, 0.09, 0.16));
      for (const sx of [-1, 1]) L.add('cap', BOX, black, place(sx * (W / 2 + 0.008), 0.06, 0, 0.016, 0.1, 0.17));
      for (const sx of [-1, 1]) L.add('foot', BOX, alu, place(sx * W * 0.32, 0.008, 0, 0.04, 0.012, 0.32, new THREE.Euler(0, sx * 0.25, 0)));
      L.add('pole', CYL, alu, tube(v3(0, 0.11, -0.05), v3(0, H - 0.02, -0.05), 0.008));
      L.add('rail', BOX, alu, place(0, H - 0.01, 0.002, W, 0.025, 0.02));
      return <group><RenderParts list={L} /><Face o={o} w={f.w} h={f.h} at={[0, 0.11 + f.h / 2, 0.006]} /></group>;
    }
    case 'backdrop': {
      for (const sx of [-1, 1]) {
        L.add('upright', CYL, alu, tube(v3(sx * (W / 2 - 0.03), 0.02, -0.03), v3(sx * (W / 2 - 0.03), H - 0.02, -0.03), 0.02));
        L.add('foot', BOX, alu, place(sx * (W / 2 - 0.03), 0.015, -0.03, 0.05, 0.03, D));
      }
      for (const y of [0.04, H - 0.03]) L.add('bar', CYL, alu, tube(v3(-W / 2 + 0.03, y, -0.03), v3(W / 2 - 0.03, y, -0.03), 0.02));
      // the pillowcase print wraps the frame: front face, edges and a plain back
      L.add('sleeve', BOX, FIN.plastic('#EDEDED'), place(0, 0.015 + f.h / 2, -0.03, W + 0.03, f.h, 0.05));
      return <group><RenderParts list={L} /><Face o={o} w={W + 0.03} h={f.h} at={[0, 0.015 + f.h / 2, -0.004]} /></group>;
    }
    case 'media-wall': {
      L.add('frame', BOX, alu, place(0, 0.05 + (H - 0.05) / 2, 0, W, H - 0.05, 0.1));
      for (const sx of [-1, 1]) L.add('foot', BOX, alu, place(sx * (W / 2 - 0.15), 0.025, 0, 0.06, 0.05, D));
      return <group><RenderParts list={L} /><Face o={o} w={f.w} h={f.h} at={[0, 0.05 + (H - 0.05) / 2, 0.051]} glow={0.95} /></group>;
    }
    case 'hanging': {
      for (const y of [0.01, H - 0.01]) L.add('rod', CYL, alu, tube(v3(-W / 2 - 0.03, y, 0), v3(W / 2 + 0.03, y, 0), 0.012));
      for (const sx of [-1, 1]) L.add('wire', CYL, FIN.chrome(), tube(v3(sx * (W / 2 - 0.05), H, 0), v3(sx * (W / 2 - 0.05), H + 3, 0), 0.0015));
      L.add('pvc', BOX, FIN.plastic('#F2F2F2'), place(0, H / 2, -0.002, W, H, 0.002));
      return <group><RenderParts list={L} /><Face o={o} w={f.w} h={f.h} at={[0, H / 2, 0.0005]} /><Face o={o} w={f.w} h={f.h} at={[0, H / 2, -0.0035]} back /></group>;
    }
    case 'tv': {
      const sy = H - f.h / 2 - 0.05;
      L.add('bezel', BOX, FIN.gloss('#0B0C0E'), place(0, sy, 0, W, f.h + 0.03, 0.06));
      for (const sx of [-1, 1]) L.add('post', BOX, black, place(sx * 0.3, (sy - 0.1) / 2 + 0.06, -0.08, 0.05, sy - 0.1, 0.05));
      L.add('base', BOX, black, place(0, 0.08, -0.08, 0.8, 0.04, D));
      for (const [x, z] of [[-0.35, -D / 2 + 0.05], [0.35, -D / 2 + 0.05], [-0.35, D / 2 - 0.13], [0.35, D / 2 - 0.13]]) L.add('wheel', CYL, FIN.rubber(), place(x, 0.04, z, 0.04, 0.03, 0.04, new THREE.Euler(0, 0, Math.PI / 2)));
      L.add('mount', BOX, black, place(0, sy, -0.06, 0.7, 0.35, 0.04));
      return <group><RenderParts list={L} /><Face o={o} w={f.w} h={f.h} at={[0, sy, 0.031]} glow={0.9} /></group>;
    }
    default: {
      L.add('board', BOX, FIN.melamine(), place(0, H / 2, 0, W, H, D));
      return <group><RenderParts list={L} /><Face o={o} w={W * 0.98} h={H * 0.98} at={[0, H / 2, D / 2 + 0.002]} /></group>;
    }
  }
}
