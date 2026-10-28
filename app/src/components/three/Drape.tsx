// Pipe and drape as hired: steel base plates (18" square) with a pin,
// telescopic uprights (lower tube, locking collar, upper tube) every ≤ 3 m,
// slip-on top brackets and adjustable crossbars, and the drape itself hung by
// its rod pocket — gathered at real fullness, so it falls in soft folds that
// deepen towards the hem. Velour has pile and sheen, satin shines, sheer
// voile lets light through.
// Object space: centred on x, the drape line on z = 0, floor at y = 0.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '@/lib/types';
import { finishFor } from '@/lib/finish';
import { BOX, CYL, FIN, PartList, RenderParts, place, tube, v3 } from './kit';

export const DRAPE_FABRICS: Record<string, { label: string; color: string; fabric: 'velour' | 'satin' | 'sheer' }> = {
  black: { label: 'Black velour', color: '#141414', fabric: 'velour' },
  ivory: { label: 'Ivory velour', color: '#EFE7D6', fabric: 'velour' },
  white: { label: 'White sheer voile', color: '#F7F7F4', fabric: 'sheer' },
  navy: { label: 'Navy velour', color: '#1B2538', fabric: 'velour' },
  burgundy: { label: 'Burgundy velour', color: '#6E1F2C', fabric: 'velour' },
  gold: { label: 'Champagne satin', color: '#D8C08A', fabric: 'satin' },
};

/** One span of gathered drape: folds every ~16 cm, a flat rod pocket at the top. */
function drapeGeometry(w: number, h: number, fullness: number) {
  const folds = Math.max(2, Math.round(w / 0.16)), segX = folds * 8, segY = 14;
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), t = 1 - (y + h / 2) / h; // 0 at the top, 1 at the hem
    const pocket = Math.min(1, Math.max(0, (t * h - 0.1) / 0.25)); // flat rod pocket, folds open below it
    const amp = 0.022 * fullness * pocket * (0.75 + 0.45 * t);
    p.setZ(i, amp * Math.sin((x / w) * folds * Math.PI * 2 + Math.sin(x * 3.1) * 0.6) + amp * 0.25 * Math.sin(x * 17.3 + t * 2));
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

export function Drape({ o }: { o: SceneObject }) {
  const [W, H] = o.size;
  const fab = DRAPE_FABRICS[o.variant || 'black'] || DRAPE_FABRICS.black;
  const tone = o.color || fab.color, fullness = Number(o.spec?.fullness ?? 1.5);
  const spans = Math.max(1, Math.ceil(W / 3.05)), span = W / spans;

  const hardware = useMemo(() => {
    const L = new PartList();
    const steel = FIN.powder('#26282C'), alu = FIN.aluminium('#D3D6DA'), barY = H - 0.03;
    for (let i = 0; i <= spans; i++) {
      const x = -W / 2 + i * span;
      L.add('base', BOX, steel, place(x, 0.005, 0, 0.457, 0.01, 0.457));
      L.add('pin', CYL, steel, place(x, 0.085, 0, 0.018, 0.15, 0.018));
      L.add('upright', CYL, alu, tube(v3(x, 0.01, 0), v3(x, H * 0.55, 0), 0.0225));
      L.add('upright', CYL, alu, tube(v3(x, H * 0.55, 0), v3(x, H, 0), 0.019));
      L.add('collar', CYL, steel, place(x, H * 0.55, 0, 0.027, 0.06, 0.027));
      L.add('bracket', BOX, steel, place(x, H - 0.015, 0.02, 0.06, 0.05, 0.07));
      if (i < spans) L.add('bar', CYL, alu, tube(v3(x + 0.03, barY, 0.045), v3(x + span - 0.03, barY, 0.045), 0.0125));
    }
    return L;
  }, [W, H, spans, span]);

  const cloth = useMemo(() => drapeGeometry(span + 0.06, H - 0.04, fullness), [span, H, fullness]);
  const material = finishFor(o, 'fabric', fab.fabric === 'sheer' ? FIN.sheer(tone) : fab.fabric === 'satin' ? FIN.satin(tone) : FIN.velour(tone), { side: THREE.DoubleSide });
  return (
    <group>
      <RenderParts list={hardware} />
      {Array.from({ length: spans }, (_, i) => (
        <mesh key={i} geometry={cloth} material={material} position={[-W / 2 + (i + 0.5) * span, 0.0, 0.07]} castShadow={fab.fabric !== 'sheer'} receiveShadow userData={{ part: 'cloth' }} />
      ))}
    </group>
  );
}
