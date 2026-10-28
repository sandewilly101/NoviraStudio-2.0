// Changes to a scene as data: what was added, changed and removed between two
// versions of it. Used to name undo steps ("Moved Round table 3"), to keep the
// undo history compact on disk, and to send edits to collaborators, who merge
// them object by object.
import type { Scene, SceneObject } from './types';

export type SceneOps = {
  /** objects added or changed, whole */
  upsert: SceneObject[];
  /** ids of objects removed */
  remove: string[];
  /** other parts of the scene (environment, plan, …) that changed, whole */
  set?: Partial<Omit<Scene, 'objects'>>;
};

/** What changed from `a` to `b`. Scenes are updated immutably, so an unchanged object is the same object. */
export function diffScenes(a: Scene, b: Scene): SceneOps {
  const before = new Map(a.objects.map((o) => [o.id, o]));
  const after = new Set<string>();
  const upsert: SceneObject[] = [];
  for (const o of b.objects) {
    after.add(o.id);
    if (before.get(o.id) !== o) upsert.push(o);
  }
  const remove = a.objects.filter((o) => !after.has(o.id)).map((o) => o.id);
  const set: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k !== 'objects' && (a as any)[k] !== (b as any)[k]) set[k] = (b as any)[k];
  }
  return Object.keys(set).length ? { upsert, remove, set } : { upsert, remove };
}

export const isEmpty = (o: SceneOps) => !o.upsert.length && !o.remove.length && !o.set;

/** `scene` with the changes made: changed objects replaced in place, new ones added at the end. */
export function applyOps(scene: Scene, ops: SceneOps): Scene {
  if (isEmpty(ops)) return scene;
  const gone = new Set(ops.remove), byId = new Map(ops.upsert.map((o) => [o.id, o]));
  const objects = scene.objects.filter((o) => !gone.has(o.id)).map((o) => {
    const n = byId.get(o.id);
    if (n) byId.delete(o.id);
    return n || o;
  });
  return { ...scene, ...ops.set, objects: byId.size ? [...objects, ...byId.values()] : objects };
}

// ---------------------------------------------------------------------------
// Naming a change, for the history list

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? '' : 's'}`;
const kind = (o: SceneObject) => o.type.replace(/_/g, ' ');

function whatChanged(a: SceneObject, b: SceneObject) {
  const same = (k: keyof SceneObject) => JSON.stringify(a[k]) === JSON.stringify(b[k]);
  if (!same('position') && same('size') && same('rotation')) return 'Moved';
  if (!same('rotation') && same('position')) return 'Turned';
  if (!same('size')) return 'Resized';
  if (!same('finish')) return 'Changed the material of';
  if (!same('color') || !same('tint')) return 'Recoloured';
  if (!same('content')) return 'Changed the content of';
  if (!same('asset') || !same('modelUrl')) return 'Replaced';
  if (!same('name')) return 'Renamed';
  return 'Edited';
}

/** A short description of the change from `a` to `b`, e.g. "Moved Round table 3" or "Added 8 lights". */
export function describeChange(a: Scene, b: Scene): string {
  const ops = diffScenes(a, b), before = new Map(a.objects.map((o) => [o.id, o]));
  const added = ops.upsert.filter((o) => !before.has(o.id)), changed = ops.upsert.filter((o) => before.has(o.id));
  const removed = ops.remove.map((id) => before.get(id)!).filter(Boolean);
  const parts: string[] = [];
  if (added.length) parts.push(added.length === 1 ? `Added ${added[0].name}` : `Added ${plural(added.length, sameKind(added) || 'object')}`);
  if (removed.length) parts.push(removed.length === 1 ? `Removed ${removed[0].name}` : `Removed ${plural(removed.length, sameKind(removed) || 'object')}`);
  if (changed.length) {
    const verbs = new Set(changed.map((o) => whatChanged(before.get(o.id)!, o)));
    const verb = verbs.size === 1 ? [...verbs][0] : 'Edited';
    // a table moved with its chairs is "Moved Round table 3"
    const lead = changed.find((o) => !o.group) || changed[0];
    const one = changed.length === 1 || changed.every((o) => o.id === lead.id || o.group === lead.id);
    parts.push(one ? `${verb} ${lead.name}` : `${verb} ${plural(changed.length, sameKind(changed) || 'object')}`);
  }
  if (ops.set) {
    const env = ops.set.environment, envBefore = a.environment;
    if (env && env.mode !== envBefore?.mode) parts.push(env.mode === 'night' ? 'Evening light' : 'Daytime light');
    else if (env && env.hdri !== envBefore?.hdri) parts.push('Lighting environment');
    else if (env && env.venueFinishes !== envBefore?.venueFinishes) parts.push('Venue material');
    else if (Object.keys(ops.set).some((k) => k !== 'stats' && k !== 'checks')) parts.push('Scene settings');
  }
  return parts.join(' · ') || 'Edit';
}

function sameKind(list: SceneObject[]) {
  const k = kind(list[0]);
  return list.every((o) => kind(o) === k) ? k : null;
}
