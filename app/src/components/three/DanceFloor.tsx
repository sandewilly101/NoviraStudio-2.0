// A portable dance floor as hired: interlocking 3 ft (0.914 m) panels about
// 22 mm thick with hairline seams, aluminium bevelled edge ramps all round
// with corner pieces, in the finishes people actually book — black & white
// checker, white or black gloss, oak parquet, or starlit black.
// Object space: centred on x/z, floor at y = 0.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { finishMaterial } from '@/lib/finish';
import { BOX, FIN, PartList, RenderParts, place } from './kit';

const PANEL = 0.914, T = 0.022, RAMP = 0.075;

export const DANCE_FINISHES = [
  ['checker', 'Black & white checker'], ['white-gloss', 'White gloss'], ['black-gloss', 'Black gloss'], ['oak', 'Oak parquet'], ['starlit', 'Starlit black'],
] as const;

export function DanceFloor({ o }: { o: SceneObject }) {
  const [W, , D] = o.size;
  const finish = o.variant || 'checker', floorFinish = o.finish?.floor;
  const list = useMemo(() => {
    const L = new PartList();
    const iw = Math.max(PANEL, W - 2 * RAMP), id = Math.max(PANEL, D - 2 * RAMP);
    const nx = Math.max(1, Math.round(iw / PANEL)), nz = Math.max(1, Math.round(id / PANEL)), px = iw / nx, pz = id / nz;
    const custom = floorFinish ? finishMaterial(floorFinish) : null;
    const surface = (i: number, k: number): [string, THREE.Material] => {
      if (custom) return ['w', custom];
      switch (finish) {
        case 'white-gloss': return ['w', FIN.gloss('#F4F3EF')];
        case 'black-gloss': return ['b', FIN.gloss('#0C0D0F')];
        case 'oak': return ['o', FIN.oak()];
        case 'starlit': return ['s', FIN.stars()];
        default: return (i + k) % 2 ? ['b', FIN.gloss('#111214')] : ['w', FIN.gloss('#F2F0EA')];
      }
    };
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const [key, m] = surface(i, k);
      L.add(key, BOX, m, place(-iw / 2 + (i + 0.5) * px, T / 2, -id / 2 + (k + 0.5) * pz, px - 0.003, T, pz - 0.003));
    }
    // the tongue-and-groove joints read as dark hairlines
    L.add('under', BOX, FIN.powder('#0A0A0B'), place(0, 0.004, 0, iw, 0.008, id));
    // bevelled aluminium edge ramps, sloping from panel height to the floor
    const alu = FIN.aluminium('#BFC3C8'), tilt = Math.atan2(T, RAMP), slope = Math.hypot(T, RAMP);
    const ramp = (x: number, z: number, len: number, alongX: boolean, sign: number) =>
      L.add('ramp', BOX, alu, place(x, T / 2, z, alongX ? len : slope, 0.004, alongX ? slope : len, alongX ? new THREE.Euler(sign * tilt, 0, 0) : new THREE.Euler(0, 0, -sign * tilt)));
    ramp(0, id / 2 + RAMP / 2, iw, true, 1);
    ramp(0, -id / 2 - RAMP / 2, iw, true, -1);
    ramp(iw / 2 + RAMP / 2, 0, id, false, 1);
    ramp(-iw / 2 - RAMP / 2, 0, id, false, -1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.add('corner', BOX, alu, place(sx * (iw / 2 + RAMP / 2), T / 4, sz * (id / 2 + RAMP / 2), RAMP, T / 2, RAMP));
    return L;
  }, [W, D, finish, floorFinish]);
  return <RenderParts list={list} />;
}
