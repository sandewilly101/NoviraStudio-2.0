// An exhibition stand in the octagonal shell-scheme system used at trade
// fairs: 50 mm octagonal aluminium posts on a 1 m grid, top and bottom beams,
// white melamine infill panels, a fascia board with the exhibitor's name in
// cut vinyl, needle-punch carpet, arm spotlights on the back beam (they light
// the stand), an information counter with a brand panel, a chrome brochure
// stand and a double socket. Corner, peninsula and island stands open up
// their sides as the organiser's manual describes; islands stand on a raised
// floor with an aluminium trim and a backlit lightbox wall.
// Object space: centred on x/z, floor at y = 0, open front towards +z.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { finishMaterial } from '@/lib/finish';
import { BOX, CYL, CYL8, FIN, PartList, RenderParts, Spot, place, tube, v3 } from './kit';
import { textTexture } from './objects';
import { displayFace, useSurfaceTexture } from '@/lib/content';

type Side = 'back' | 'left' | 'right';

/** A printed graphic panel across the back wall, showing the stand's content. */
function BackGraphic({ o, floorY }: { o: SceneObject; floorY: number }) {
  const tex = useSurfaceTexture(o), f = displayFace(o);
  return (
    <mesh position={[0, floorY + 0.06 + f.h / 2, -o.size[2] / 2 + 0.009]} receiveShadow>
      <planeGeometry args={[f.w, f.h]} />
      <meshStandardMaterial map={tex} roughness={0.7} color={tex ? '#ffffff' : '#DDE2E8'} />
    </mesh>
  );
}
const WALLS: Record<string, Side[]> = { 'shell-scheme': ['back', 'left', 'right'], inline: ['back', 'left', 'right'], corner: ['back', 'left'], peninsula: ['back'], island: [], 'double-decker': [] };

export function Booth({ o }: { o: SceneObject }) {
  const [W, H, D] = o.size;
  const type = o.variant || 'shell-scheme';
  const walls = WALLS[type] ?? WALLS['shell-scheme'];
  const island = !walls.length, fascia = walls.length >= 2;
  const panelTone = o.color || '#F4F4F1', carpetTone = o.spec?.carpet || '#2E3D5C', name = o.text?.content || 'Exhibitor';
  const floorY = island ? 0.05 : 0.006;
  const wallFinish = o.finish?.walls, carpetFinish = o.finish?.carpet;

  const list = useMemo(() => {
    const L = new PartList();
    const alu = FIN.aluminium('#C6CACF'), panel = wallFinish ? finishMaterial(wallFinish) : FIN.melamine(panelTone);
    const line = (side: Side): [THREE.Vector3, THREE.Vector3] =>
      side === 'back' ? [v3(-W / 2, 0, -D / 2), v3(W / 2, 0, -D / 2)] : side === 'left' ? [v3(-W / 2, 0, -D / 2), v3(-W / 2, 0, D / 2)] : [v3(W / 2, 0, -D / 2), v3(W / 2, 0, D / 2)];
    const posts = new Map<string, THREE.Vector3>();
    for (const side of walls) {
      const [a, b] = line(side), len = a.distanceTo(b), n = Math.max(1, Math.round(len / 1.0)), alongX = side === 'back';
      for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); posts.set(`${p.x.toFixed(2)},${p.z.toFixed(2)}`, p); }
      for (let i = 0; i < n; i++) {
        const p = a.clone().lerp(b, (i + 0.5) / n), seg = len / n;
        // melamine infill held in the post slots, beams top and bottom
        L.add('panel', BOX, panel, place(p.x, floorY + (H - 0.1) / 2 + 0.05, p.z, alongX ? seg - 0.045 : 0.004, H - 0.1, alongX ? 0.004 : seg - 0.045));
        for (const y of [floorY + 0.025, H - 0.02]) L.add('beam', BOX, alu, place(p.x, y, p.z, alongX ? seg - 0.04 : 0.02, 0.04, alongX ? 0.02 : seg - 0.04));
      }
    }
    // the fascia runs across the open front on two front posts
    if (fascia) { posts.set('fl', v3(-W / 2, 0, D / 2)); posts.set('fr', v3(W / 2, 0, D / 2)); }
    for (const p of posts.values()) {
      L.add('post', CYL8, alu, place(p.x, floorY + (H - floorY) / 2, p.z, 0.025, H - floorY, 0.025));
      L.add('cap', BOX, FIN.plastic('#D9DCE0'), place(p.x, H + 0.006, p.z, 0.05, 0.012, 0.05));
    }
    // carpet (on a raised, trimmed floor for islands)
    if (island) {
      L.add('platform', BOX, FIN.powder('#2A2C30'), place(0, (floorY - 0.006) / 2, 0, W, floorY - 0.006, D));
      for (const [x, z, w, d] of [[0, D / 2, W + 0.02, 0.01], [0, -D / 2, W + 0.02, 0.01], [W / 2, 0, 0.01, D], [-W / 2, 0, 0.01, D]]) L.add('trim', BOX, alu, place(x, floorY / 2, z, w, floorY + 0.004, d));
    }
    L.add('carpet', BOX, carpetFinish ? finishMaterial(carpetFinish) : FIN.carpet(carpetTone), place(0, floorY - 0.003, 0, W - 0.01, 0.006, D - 0.01));
    // arm spotlights on the back beam
    const spots = Math.max(2, Math.round(W / 1.5)), backZ = island ? -D / 2 + 0.6 : -D / 2;
    for (let i = 0; i < spots; i++) {
      const x = -W / 2 + ((i + 0.5) / spots) * W, root = v3(x, H - 0.03, backZ + 0.02), head = v3(x, H + 0.05, backZ + 0.45);
      L.add('arm', CYL, FIN.powder('#E9EAEC'), tube(root, head, 0.008));
      L.add('spot', CYL, FIN.powder('#F1F2F3'), tube(head, head.clone().add(v3(0, -0.1, 0.05)), 0.035));
      L.add('lens', CYL, FIN.glow('#FFF4DE'), tube(head.clone().add(v3(0, -0.1, 0.05)), head.clone().add(v3(0, -0.103, 0.0515)), 0.03));
    }
    // information counter with a brand panel, brochure stand, double socket
    const cx = -W / 2 + Math.min(0.9, W * 0.3), cz = D / 2 - 0.5;
    L.add('counter', BOX, FIN.melamine('#F7F7F5'), place(cx, floorY + 0.5, cz, 1.0, 1.0, 0.5));
    L.add('counterTop', BOX, FIN.melamine('#2B2D31'), place(cx, floorY + 1.01, cz, 1.04, 0.025, 0.54));
    L.add('brand', BOX, FIN.plastic(o.text?.accent || '#0E6AB1'), place(cx, floorY + 0.55, cz + 0.252, 0.9, 0.7, 0.004));
    const bx = W / 2 - 0.45, bz = D / 2 - 0.4, chrome = FIN.chrome();
    L.add('rack', CYL, chrome, tube(v3(bx, floorY, bz), v3(bx, floorY + 1.45, bz), 0.012));
    L.add('rackBase', CYL, chrome, place(bx, floorY + 0.006, bz, 0.16, 0.012, 0.16));
    for (let k = 0; k < 4; k++) L.add('pocket', BOX, FIN.sheer('#E8F1F8'), place(bx, floorY + 0.55 + k * 0.25, bz + 0.03, 0.23, 0.2, 0.025, new THREE.Euler(-0.18, 0, 0)));
    if (walls.includes('back')) L.add('socket', BOX, FIN.plastic('#FAFAFA'), place(W / 2 - 0.4, floorY + 0.3, -D / 2 + 0.006, 0.14, 0.08, 0.012));
    return L;
  }, [W, H, D, walls, panelTone, carpetTone, floorY, island, fascia, o.text?.accent, wallFinish, carpetFinish]);

  // fascia board with the exhibitor's name in cut vinyl
  const fasciaMat = useMemo(() => {
    if (!fascia && !island) return null;
    const w = island ? Math.min(W, 3) : W, t = textTexture(name, '', '#FFFFFF', '#1A1A1A', '#FFFFFF', 2048, Math.max(128, Math.round(2048 * (0.3 / w))));
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: island ? '#ffffff' : '#000000', emissiveMap: island ? t : null, emissiveIntensity: island ? 0.9 : 0 });
  }, [fascia, island, name, W]);
  useEffect(() => () => { fasciaMat?.map?.dispose(); fasciaMat?.dispose(); }, [fasciaMat]);

  return (
    <group>
      <RenderParts list={list} />
      {o.content && walls.includes('back') && <BackGraphic o={o} floorY={floorY} />}
      {fascia && fasciaMat && <mesh position={[0, H - 0.17, D / 2 + 0.012]} material={fasciaMat} castShadow><boxGeometry args={[W + 0.03, 0.3, 0.016]} /></mesh>}
      {island && fasciaMat && (
        // backlit fabric lightbox wall, printed with the name
        <group position={[0, floorY, -D / 2 + 0.6]}>
          <mesh position={[0, H / 2, 0]} castShadow><boxGeometry args={[Math.min(W, 3), H, 0.1]} /><meshStandardMaterial color="#202226" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[0, H - 0.4, 0.052]} material={fasciaMat}><planeGeometry args={[Math.min(W, 3) - 0.04, 0.6]} /></mesh>
        </group>
      )}
      {/* the arm spots light the stand */}
      <Spot from={[0, H + 0.4, -D / 2 + 0.6]} to={[0, 0, D * 0.15]} angle={1.0} penumbra={0.7} intensity={14 * Math.max(1, W * D / 9)} distance={W + D + 3} decay={2} color="#FFF1DC" />
    </group>
  );
}
