// Screen arrangements as productions build them, laid out from the stage:
// the LED walls are sized in whole 0.5 m cabinets, stand on ground support
// behind or beside the stage, stay under the ceiling and face the guests.
// (Mirrored on the server in ai/geometry.js for the scene agent.)
import type { SceneObject } from './types';

export const SCREEN_LAYOUTS = [
  ['center', 'Centre', 'One 16:9 wall behind the stage'],
  ['center-sides', 'Centre + sides', 'Main wall and two side screens angled to the guests'],
  ['triptych', 'Triptych', 'Three walls side by side, the outer ones angled'],
  ['ultrawide', 'Ultrawide', 'One 32:9 panoramic wall'],
  ['columns', 'Columns', 'Five tall LED columns behind the stage'],
  ['curved', 'Curved', 'One wall curved 30°'],
] as const;
export type ScreenLayout = (typeof SCREEN_LAYOUTS)[number][0];

const cab = (v: number) => Math.max(0.5, Math.round(v / 0.5) * 0.5);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The LED walls of a layout for this stage (content taken from `content`). */
export function screenRig(stage: SceneObject, layout: ScreenLayout, ceiling = 6, content?: SceneObject['content']): Omit<SceneObject, 'id'>[] {
  const [W, h, D] = stage.size, yaw = stage.rotation?.[1] || 0;
  const f = [Math.sin(yaw), Math.cos(yaw)], r = [Math.cos(yaw), -Math.sin(yaw)]; // towards the guests; +x side at yaw 0 (a positive turn faces it towards the centre from the -x side)
  const [cx, , cz] = stage.position, back = (k: number, side = 0) => [r3(cx - f[0] * (D / 2 + k) + r[0] * side), r3(cz - f[1] * (D / 2 + k) + r[1] * side)];
  const bottom = h + 0.3, room = (b: number) => Math.max(1, ceiling - 0.5 - b);
  const wall = (name: string, w: number, ht: number, side: number, y: number, turn = 0, extra: Partial<SceneObject> = {}, depth = 0.25): Omit<SceneObject, 'id'> => {
    const [x, z] = back(depth, side);
    return { type: 'led_screen', name, position: [x, r3(y), z], rotation: [0, yaw + turn, 0], size: [w, ht, 0.1], color: '#0E2A4A', variant: 'p3-9-indoor', spec: { frame: 'ground-support', curveDeg: 0 }, group: 'screens', userAdded: true, ...(content ? { content } : {}), ...extra };
  };
  const main = () => { let w = cab(W * 0.8), ht = cab((w * 9) / 16); if (ht > room(bottom)) { ht = cab(room(bottom) - 0.25); w = cab((ht * 16) / 9); } return [w, ht] as const; };
  switch (layout) {
    case 'center-sides': {
      const [w, ht] = main(), ws = cab(Math.max(2, W * 0.3)), hs = cab((ws * 9) / 16), ys = Math.min(1.6, room(1.6) - hs > 0 ? 1.6 : 0.9), off = W / 2 + ws / 2 + 0.7;
      return [wall('LED wall', w, ht, 0, bottom), wall('Side screen left', ws, hs, -off, ys, 0.26, {}, -D * 0.35), wall('Side screen right', ws, hs, off, ys, -0.26, {}, -D * 0.35)];
    }
    case 'triptych': {
      const w3 = cab((W * 1.05) / 3), ht = Math.min(cab((w3 * 9) / 16), cab(room(bottom))), gap = 0.6;
      return [wall('LED wall left', w3, ht, -(w3 + gap), bottom, 0.21, {}, 0.1), wall('LED wall centre', w3, ht, 0, bottom), wall('LED wall right', w3, ht, w3 + gap, bottom, -0.21, {}, 0.1)];
    }
    case 'ultrawide': { const w = cab(W * 1.05), ht = Math.min(cab((w * 9) / 32), cab(room(bottom))); return [wall('Ultrawide LED wall', w, ht, 0, bottom)]; }
    case 'columns': {
      const n = 5, cw = 1, ht = cab(Math.min(4.5, room(h + 0.1))), span = W * 0.95;
      return Array.from({ length: n }, (_, i) => wall(`LED column ${i + 1}`, cw, ht, -span / 2 + (i * span) / (n - 1), h + 0.1));
    }
    case 'curved': { const w = cab(W * 0.95), ht = Math.min(cab((w * 9) / 21), cab(room(bottom))); return [wall('Curved LED wall', w, ht, 0, bottom, 0, { spec: { frame: 'ground-support', curveDeg: 30 } }, 0.6)]; }
    default: { const [w, ht] = main(); return [wall('LED wall', w, ht, 0, bottom)]; }
  }
}
