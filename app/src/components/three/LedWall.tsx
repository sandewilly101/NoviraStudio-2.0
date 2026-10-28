// An LED video wall built the way a rental wall is assembled on site:
// 500 mm die-cast cabinets (four 250 mm modules each) with real pixel pitch,
// module and cabinet seams, ribbed backs with a receiving/PSU box, handles,
// powerCON/etherCON connectors and a status LED, latches between cabinets,
// daisy-chained power and data looms, and the support it stands on —
// a ground-stack frame with rear kickers and ballast, a flying bar on chain
// hoists, or wall brackets. Curved walls turn every column on the arc.
//
// Object space: x across the image, y up from the image's bottom edge
// (the object's position is that edge), z towards the audience.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { ledPanel } from '@/nozila/shared';
import { useSurfaceTexture } from '@/lib/content';

type M = THREE.Matrix4;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);

// ---------- shared geometry and finishes ----------
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
// a slack loop between two connectors: 1 unit long along +y (stretched to
// length), bowing 75 mm to +z, at the cable's real thickness
const cableGeo = (radius: number) => {
  const c = new THREE.CatmullRomCurve3([v3(0, 0, 0), v3(0, 0.2, 0.05), v3(0, 0.5, 0.075), v3(0, 0.8, 0.05), v3(0, 1, 0)]);
  return new THREE.TubeGeometry(c, 16, radius, 6, false);
};
const POWER_LOOM = cableGeo(0.008), DATA_LOOM = cableGeo(0.005);
const mat = (color: string, metalness: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
const FINISH = {
  cabinet: mat('#2A2D32', 0.55, 0.45),
  rib: mat('#30343A', 0.55, 0.4),
  box: mat('#16181B', 0.3, 0.6),
  handle: mat('#9AA1AA', 0.85, 0.3),
  latch: mat('#5C636C', 0.8, 0.35),
  powerIn: mat('#2D6FD8', 0.1, 0.5),
  powerOut: mat('#B9BEC5', 0.1, 0.5),
  data: mat('#C9CED6', 0.9, 0.25),
  status: new THREE.MeshBasicMaterial({ color: '#39FF7A', toneMapped: false }),
  cable: mat('#111214', 0.05, 0.75),
  alu: mat('#B3B8BF', 0.75, 0.42),
  plate: mat('#4A4E55', 0.7, 0.45),
  ballast: mat('#3A3D42', 0.6, 0.6),
  hoist: mat('#1F2125', 0.4, 0.55),
  chain: mat('#5E646C', 0.9, 0.35),
};

function Parts({ geo, material, items }: { geo: THREE.BufferGeometry; material: THREE.Material; items: M[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((x, i) => m.setMatrixAt(i, x));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return <instancedMesh key={items.length} ref={ref} args={[geo, material, items.length]} castShadow receiveShadow />;
}

// ---------- the LED face: content x pixel structure x seams ----------
function faceMaterial(map: THREE.Texture, pixels: THREE.Vector2, modules: THREE.Vector2, cabinets: THREE.Vector2, brightness: number) {
  const m = new THREE.MeshBasicMaterial({ map, toneMapped: false });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uPixels: { value: pixels }, uModules: { value: modules }, uCabinets: { value: cabinets }, uBright: { value: brightness } });
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uPixels; uniform vec2 uModules; uniform vec2 uCabinets; uniform float uBright;\n' +
        'float seamAt(vec2 p, float w) { vec2 f = fract(p); vec2 e = min(f, 1.0 - f); vec2 fw = fwidth(p) * 0.75 + 1e-4; vec2 l = 1.0 - smoothstep(vec2(0.0), fw + w, e); return max(l.x, l.y); }')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // each pixel is an RGB LED package on a black mask; far away they merge
        vec2 px = vMapUv * uPixels;
        vec2 cell = fract(px) - 0.5;
        float fw = max(fwidth(px.x), fwidth(px.y));
        float led = 1.0 - smoothstep(0.30, 0.30 + max(fw, 0.06), length(cell));
        float merge = clamp((fw - 0.35) / 0.65, 0.0, 1.0);
        float mask = mix(led * 1.7, 0.86, merge);
        // hairline gaps between modules, a little wider between cabinets
        float seam = max(seamAt(vMapUv * uModules, 0.002) * 0.45, seamAt(vMapUv * uCabinets, 0.004) * 0.8);
        diffuseColor.rgb = (diffuseColor.rgb * uBright + 0.015) * mask * (1.0 - seam);`);
  };
  m.customProgramCacheKey = () => 'novira-led-face';
  return m;
}

/** Where each column of cabinets sits: flat, or turned along the arc of a curved wall. */
function columnFrames(cols: number, cw: number, curveDeg: number): M[] {
  const W = cols * cw, theta = (curveDeg * Math.PI) / 180;
  return Array.from({ length: cols }, (_, i) => {
    if (theta < 1e-3) return new THREE.Matrix4().makeTranslation(-W / 2 + (i + 0.5) * cw, 0, 0);
    // concave towards the audience: the ends come forward
    const R = W / theta, a = ((i + 0.5) / cols) * theta - theta / 2;
    return new THREE.Matrix4().makeRotationY(-a).setPosition(R * Math.sin(a), 0, R * (1 - Math.cos(a)));
  });
}

const at = (frame: M, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot?: THREE.Euler) =>
  frame.clone().multiply(new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(rot || new THREE.Euler()), v3(sx, sy, sz)));

/** A round tube from a to b (object space). */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number): M {
  const d = b.clone().sub(a), len = d.length();
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), v3(r, len, r));
}
/** A slack cable from a to b, bowing towards `back`. */
function cable(a: THREE.Vector3, b: THREE.Vector3, back: THREE.Vector3): M {
  const y = b.clone().sub(a), len = y.length();
  y.normalize();
  const z = back.clone().sub(y.clone().multiplyScalar(back.dot(y))).normalize();
  const x = y.clone().cross(z);
  const basis = new THREE.Matrix4().makeBasis(x, y.multiplyScalar(len), z);
  return basis.setPosition(a);
}

export function LedWall({ o, ground = 0 }: { o: SceneObject; ground?: number }) {
  const panel = ledPanel(o.variant);
  const cw = panel.widthMm / 1000, ch = panel.heightMm / 1000, D = Math.max(0.06, panel.depthMm / 1000);
  const cols = Math.max(1, Math.round(o.size[0] / cw)), rows = Math.max(1, Math.round(o.size[1] / ch));
  const W = cols * cw, H = rows * ch;
  const curve = Number(o.spec?.curveDeg) || 0;
  const frame: 'ground-support' | 'flown' | 'wall-mount' = o.spec?.frame || 'ground-support';
  const floor = ground - o.position[1]; // what the feet stand on (floor or stage deck), from the image's bottom edge

  // content: a design, an image or a looping video, at the wall's native resolution
  const map = useSurfaceTexture(o);
  const face = useMemo(() => map && faceMaterial(map, new THREE.Vector2(Math.round(W * 1000 / panel.pitchMm), Math.round(H * 1000 / panel.pitchMm)),
    new THREE.Vector2(cols * 2, rows * 2), new THREE.Vector2(cols, rows), Number(o.spec?.brightness ?? 0.95)), [map, W, H, panel.pitchMm, cols, rows, o.spec?.brightness]);
  useEffect(() => () => face?.dispose(), [face]);

  const built = useMemo(() => {
    const frames = columnFrames(cols, cw, curve);
    const P: Record<string, M[]> = {};
    const add = (k: string, m: M) => (P[k] ||= []).push(m);
    const backOf = (f: M) => v3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(f));

    // face strip: one quad per column, UVs spanning the whole image
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    frames.forEach((f, i) => {
      const base = pos.length / 3;
      for (const [x, y, u, w] of [[-cw / 2, 0, i / cols, 0], [cw / 2, 0, (i + 1) / cols, 0], [cw / 2, H, (i + 1) / cols, 1], [-cw / 2, H, i / cols, 1]]) {
        const p = v3(x, y, 0.0015).applyMatrix4(f);
        pos.push(p.x, p.y, p.z); uv.push(u, w);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const faceGeo = new THREE.BufferGeometry();
    faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    faceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    faceGeo.setIndex(idx);

    frames.forEach((f, c) => {
      for (let r = 0; r < rows; r++) {
        const yc = (r + 0.5) * ch, zb = -D; // back face of the cabinet
        add('cabinet', at(f, 0, yc, -D / 2, cw - 0.002, ch - 0.002, D));
        // die-cast back: perimeter rim plus an X of ribs
        for (const s of [-1, 1]) {
          add('rib', at(f, 0, yc + s * (ch / 2 - 0.012), zb - 0.008, cw - 0.01, 0.022, 0.016));
          add('rib', at(f, s * (cw / 2 - 0.012), yc, zb - 0.008, 0.022, ch - 0.01, 0.016));
          add('rib', at(f, 0, yc, zb - 0.006, Math.hypot(cw, ch) * 0.9, 0.014, 0.012, new THREE.Euler(0, 0, s * Math.atan2(ch, cw))));
        }
        // receiving card + PSU box, with its connectors and status light
        add('box', at(f, 0, yc, zb - 0.03, cw * 0.56, ch * 0.4, 0.045));
        const cz = zb - 0.053, cy = yc - ch * 0.1, turn = new THREE.Euler(Math.PI / 2, 0, 0);
        add('powerIn', at(f, -cw * 0.19, cy, cz, 0.013, 0.02, 0.013, turn));
        add('powerOut', at(f, -cw * 0.08, cy, cz, 0.013, 0.02, 0.013, turn));
        add('data', at(f, cw * 0.08, cy, cz, 0.011, 0.02, 0.011, turn));
        add('data', at(f, cw * 0.19, cy, cz, 0.011, 0.02, 0.011, turn));
        add('status', at(f, cw * 0.22, yc + ch * 0.12, cz + 0.002, 0.004, 0.004, 0.004, turn));
        // two carry handles, top and bottom of the back
        for (const s of [-1, 1]) {
          const hy = yc + s * ch * 0.34;
          add('handle', at(f, 0, hy, zb - 0.045, 0.008, cw * 0.26, 0.008, new THREE.Euler(0, 0, Math.PI / 2)));
          for (const hx of [-1, 1]) add('handle', at(f, hx * cw * 0.13, hy, zb - 0.025, 0.007, 0.04, 0.007, turn));
        }
        // quick-lock latches on the side frames
        for (const s of [-1, 1]) add('latch', at(f, s * (cw / 2 - 0.02), yc + ch * 0.18, zb - 0.02, 0.022, 0.07, 0.03));
        // power and data looped up the column to the next cabinet
        if (r < rows - 1) {
          const back = backOf(f);
          add('power', cable(v3(-cw * 0.19, cy, cz - 0.01).applyMatrix4(f), v3(-cw * 0.08, cy + ch, cz - 0.01).applyMatrix4(f), back));
          add('dataLoom', cable(v3(cw * 0.19, cy, cz - 0.01).applyMatrix4(f), v3(cw * 0.08, cy + ch, cz - 0.01).applyMatrix4(f), back));
        }
      }
      // serpentine: the data run hops to the next column at alternate ends
      if (c < cols - 1) {
        const r = c % 2 ? 0 : rows - 1, cy = (r + 0.4) * ch, cz = -D - 0.063;
        add('dataLoom', cable(v3(cw * 0.19, cy, cz).applyMatrix4(f), v3(cw * 0.08, cy, cz).applyMatrix4(frames[c + 1]), backOf(f)));
      }
    });

    // ---------- support ----------
    const posts: number[] = []; // column-edge indices that carry a post / kicker
    for (let e = 0; e <= cols; e += 2) posts.push(e);
    if (posts[posts.length - 1] !== cols) posts.push(cols);
    const edge = (e: number, x: number, y: number, z: number) => {
      // a point on the shared edge between column e-1 and e (or an outer edge)
      const f = frames[Math.min(cols - 1, Math.max(0, e === cols ? cols - 1 : e))], dx = e === cols ? cw / 2 : -cw / 2;
      return v3(dx + x, y, z).applyMatrix4(f);
    };

    if (frame === 'ground-support') {
      const lift = -floor; // height of the image's bottom edge above the floor
      const beam = Math.min(0.1, Math.max(0.02, lift));
      frames.forEach((f) => add('alu', at(f, 0, -beam / 2, -D / 2, cw, beam, Math.max(D, 0.12)))); // ground-stack beam
      const kTop = Math.min(H * 0.75, H - 0.25), reach = Math.min(1.2, 0.35 + (H + lift) * 0.22);
      posts.forEach((e) => {
        const inset = e === 0 ? 0.04 : e === cols ? -0.04 : 0;
        // post down to a screw jack and base plate
        if (lift > 0.18) {
          const top = edge(e, inset, -0.1, -D / 2), bottom = edge(e, inset, floor + 0.12, -D / 2);
          add('aluBar', at(new THREE.Matrix4(), (top.x + bottom.x) / 2, (top.y + bottom.y) / 2, top.z, 0.05, top.y - bottom.y, 0.05));
        }
        const foot = edge(e, inset, floor, -D / 2);
        add('rod', tube(v3(foot.x, floor + 0.012, foot.z), v3(foot.x, floor + 0.12, foot.z), 0.012));
        add('plate', at(new THREE.Matrix4(), foot.x, floor + 0.006, foot.z, 0.18, 0.012, 0.18));
        // rear bar up the back of the cabinets, a kicker to the floor, ballast on its foot
        const barBottom = edge(e, inset, 0.02, -D - 0.09), barTop = edge(e, inset, kTop + 0.15, -D - 0.09);
        add('aluBar', at(new THREE.Matrix4(), barBottom.x, (barBottom.y + barTop.y) / 2, barBottom.z, 0.04, barTop.y - barBottom.y, 0.04));
        const back = backOf(frames[Math.min(cols - 1, e)]);
        const kFrom = edge(e, inset, kTop, -D - 0.09);
        const kFoot = kFrom.clone().addScaledVector(back, reach).setY(floor + 0.05);
        add('rod', tube(kFrom, kFoot, 0.022));
        add('rod', tube(edge(e, inset, floor + 0.06, -D / 2), kFoot.clone().setY(floor + 0.06), 0.018)); // floor stringer
        add('rod', tube(kFrom.clone().lerp(kFoot, 0.5), edge(e, inset, Math.max(floor + 0.15, -0.15), -D - 0.09), 0.015)); // mid brace
        add('plate', at(new THREE.Matrix4(), kFoot.x, floor + 0.008, kFoot.z, 0.3, 0.016, 0.3));
        for (let k = 0; k < 2; k++) add('ballast', at(new THREE.Matrix4(), kFoot.x, floor + 0.03 + k * 0.026, kFoot.z, 0.4, 0.024, 0.32));
      });
      // horizontal braces between the posts near the floor
      if (lift > 0.4) frames.forEach((f) => add('aluBar', at(f, 0, floor + 0.3, -D / 2, cw, 0.035, 0.035)));
    } else if (frame === 'flown') {
      frames.forEach((f) => add('alu', at(f, 0, H + 0.045, -D / 2, cw, 0.09, 0.1))); // flying bar
      posts.forEach((e) => {
        const p = edge(e, e === 0 ? 0.08 : e === cols ? -0.08 : 0, H + 0.09, -D / 2);
        add('chain', tube(p, p.clone().setY(H + 0.9), 0.008));
        add('hoist', at(new THREE.Matrix4(), p.x, H + 1.12, p.z, 0.28, 0.44, 0.26));
        add('chain', tube(p.clone().setY(H + 1.34), p.clone().setY(H + 2.6), 0.008));
      });
    } else {
      // wall brackets: two rails across the back, standoffs to the wall
      frames.forEach((f) => { for (const y of [H * 0.25, H * 0.75]) add('aluBar', at(f, 0, y, -D - 0.11, cw, 0.06, 0.04)); });
      posts.forEach((e) => { for (const y of [H * 0.25, H * 0.75]) { const p = edge(e, 0, y, -D - 0.2); add('aluBar', at(new THREE.Matrix4(), p.x, p.y, p.z, 0.05, 0.05, 0.14)); add('plate', at(new THREE.Matrix4(), p.x, p.y, p.z - 0.075, 0.16, 0.2, 0.012)); } });
    }
    return { faceGeo, P };
  }, [cols, rows, cw, ch, D, curve, frame, floor, H]);
  useEffect(() => () => built.faceGeo.dispose(), [built]);

  const G: Record<string, [THREE.BufferGeometry, THREE.Material]> = {
    cabinet: [BOX, FINISH.cabinet], rib: [BOX, FINISH.rib], box: [BOX, FINISH.box], handle: [CYL, FINISH.handle], latch: [BOX, FINISH.latch],
    powerIn: [CYL, FINISH.powerIn], powerOut: [CYL, FINISH.powerOut], data: [CYL, FINISH.data], status: [CYL, FINISH.status],
    power: [POWER_LOOM, FINISH.cable], dataLoom: [DATA_LOOM, FINISH.cable], alu: [BOX, FINISH.alu], aluBar: [BOX, FINISH.alu], rod: [CYL, FINISH.alu],
    plate: [BOX, FINISH.plate], ballast: [BOX, FINISH.ballast], hoist: [BOX, FINISH.hoist], chain: [CYL, FINISH.chain],
  };
  return (
    <group position={[0, 0, o.size[2] / 2]}>
      {face && <mesh geometry={built.faceGeo} material={face} />}
      {Object.entries(built.P).map(([k, items]) => <Parts key={k} geo={G[k][0]} material={G[k][1]} items={items} />)}
    </group>
  );
}
