// Place settings, so a dressed table reads as set for dinner: at every chair, on
// the table edge in front of it, a real place setting (plate, fork, knife and
// spoon) and a wine and a water glass — BlenderKit models from the catalogue,
// each kind instanced across all tables. A table opts out with spec.settings === false.
import { useMemo } from 'react';
import type { SceneObject } from '@/lib/types';
import { useCatalog } from '@/lib/catalog';
import { RealModels } from './RealModels';

type Spot = { id: string; x: number; y: number; z: number; yaw: number };

/** Where each setting goes: on the table edge in front of every chair that belongs to a dining table. */
function settingsOf(objects: SceneObject[]): Spot[] {
  const tables = new Map(objects.filter((o) => (o.type === 'round_table' || o.type === 'long_table') && o.spec?.settings !== false).map((t) => [t.id, t]));
  const out: Spot[] = [];
  for (const c of objects) {
    if (c.type !== 'chair' || !c.group) continue;
    const t = tables.get(c.group);
    if (!t) continue;
    const top = t.position[1] + t.size[1];
    let dx: number, dz: number;
    if (t.type === 'round_table') { dx = t.position[0] - c.position[0]; dz = t.position[2] - c.position[2]; }
    else { const yaw = t.rotation?.[1] || 0, nx = Math.sin(yaw), nz = Math.cos(yaw), side = Math.sign((t.position[0] - c.position[0]) * nx + (t.position[2] - c.position[2]) * nz) || 1; dx = nx * side; dz = nz * side; }
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    // the table edge in front of the chair, then 22 cm in
    const edge = t.type === 'round_table' ? t.size[0] / 2 : t.size[2] / 2;
    const fromCentre = t.type === 'round_table' ? Math.hypot(c.position[0] - t.position[0], c.position[2] - t.position[2]) - edge : 0.35;
    const k = Math.max(0, fromCentre) + 0.22;
    out.push({ id: c.id, x: c.position[0] + dx * k, y: top + 0.002, z: c.position[2] + dz * k, yaw: Math.atan2(-dx, -dz) });
  }
  return out;
}

/** A model placed in a setting's own frame: x to the guest's right, z towards the guest. */
const at = (s: Spot, x: number, z: number) => [s.x + x * Math.cos(s.yaw) + z * Math.sin(s.yaw), s.y, s.z - x * Math.sin(s.yaw) + z * Math.cos(s.yaw)] as [number, number, number];
const piece = (s: Spot, kind: string, x: number, z: number, size: [number, number, number], turn = 0): SceneObject =>
  ({ id: `${kind}-${s.id}`, type: 'model', name: kind, position: at(s, x, z), rotation: [0, s.yaw + turn, 0], size, color: '#ffffff' }) as SceneObject;

export function TableSettings({ objects }: { objects: SceneObject[] }) {
  const catalog = useCatalog();
  const spots = useMemo(() => settingsOf(objects), [objects]);
  const sets = useMemo(() => ({
    // the model lays its cutlery along x with the fork on +z: turned so the fork is on the guest's left
    place: spots.map((s) => piece(s, 'place', 0, 0, [0.37, 0.05, 0.53], -Math.PI / 2)), // checked from above: fork on the guest's left, handles towards them
    wine: spots.map((s) => piece(s, 'wine', 0.2, -0.2, [0.1, 0.21, 0.1])),
    water: spots.map((s) => piece(s, 'water', 0.29, -0.12, [0.1, 0.18, 0.1])),
  }), [spots]);
  if (!catalog || !spots.length || spots.length > 600) return null; // a very large room stays fast
  return (
    <group>
      {catalog.place_setting && <RealModels item={catalog.place_setting} objects={sets.place} fallback={null} />}
      {catalog.wine_glass && <RealModels item={catalog.wine_glass} objects={sets.wine} fallback={null} />}
      {catalog.water_glass && <RealModels item={catalog.water_glass} objects={sets.water} fallback={null} />}
    </group>
  );
}
