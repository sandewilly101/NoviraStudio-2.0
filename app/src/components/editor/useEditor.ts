import { carryRig } from '@/lib/rigCarry';
import { aimAt, autoFocus, programLights } from '@/lib/autoLight';
import { isPlaying } from '@/lib/lightFx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Project, Scene, SceneObject, Venue } from '@/lib/types';
import { snapToRig } from '@/components/three/rig';
import { placeFree } from '@/lib/placement';
import { applyOps, describeChange, diffScenes, isEmpty, type SceneOps } from '@/lib/sceneOps';
import { fingerprint, idbGet, idbSet } from '@/lib/idb';

type Floor = { minX: number; maxX: number; minZ: number; maxZ: number };

// Move an object so its rotated footprint lies inside the room rectangle.
export function keepInside<T extends { position: [number, number, number]; rotation?: [number, number, number]; size: [number, number, number] }>(o: T, f: Floor): T {
  const a = o.rotation?.[1] || 0, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hx = (o.size[0] * c + o.size[2] * s) / 2, hz = (o.size[0] * s + o.size[2] * c) / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const x = clamp(o.position[0], f.minX + hx, f.maxX - hx), z = clamp(o.position[2], f.minZ + hz, f.maxZ - hz);
  if (x === o.position[0] && z === o.position[2]) return o;
  return { ...o, position: [Math.round(x * 100) / 100, o.position[1], Math.round(z * 100) / 100] };
}

type Loaded ={ project: Project & { my_role?: 'owner' | 'editor' | 'viewer' }; venue: Venue | null; version: number; scene: Scene | null };

/** One step of the undo history: the scene after a change, and what the change was. */
export type Step = { scene: Scene; label: string; by: 'you' | 'ai' | 'open'; at: number };
export type StepInfo = Omit<Step, 'scene'>;
type ChangeMeta = { label?: string; by?: 'you' | 'ai' };
const MAX_STEPS = 100;
// the history on disk: the first scene whole, every later step as the changes it made
type StoredHistory = { sig: string; index: number; base: Scene; chain: (StepInfo & { ops: SceneOps })[] };
const historyKey = (projectId: string) => `history:${projectId}`;

export function useEditor(projectId: string) {
  const [data, setData] = useState<Loaded | null>(null);
  const [scene, setSceneState] = useState<Scene | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The undo history: every state of the scene this session, each with the change that made it,
  // and where we are in it. Undo and redo move along it; a new change cuts off what was ahead.
  const steps = useRef<Step[]>([]);
  const index = useRef(0);
  const [hist, setHist] = useState<{ index: number; steps: StepInfo[] }>({ index: 0, steps: [] });
  const showHistory = () => setHist({ index: index.current, steps: steps.current.map(({ scene: _s, ...info }) => info) });
  // The ref always holds the latest scene so quick successive edits compose
  // correctly and undo history is recorded exactly once per change.
  const current = useRef<Scene | null>(null);
  // told about every change made here (not ones merged in from collaborators), to send them on
  const localListener = useRef<((ops: SceneOps) => void) | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<Loaded>(`/projects/${projectId}`);
      let start: Step[] = [{ scene: d.scene!, label: 'Opened the project', by: 'open', at: Date.now() }], at = 0;
      // the history from before a reload carries on, if the project is still where it left off
      const kept = d.scene ? await idbGet<StoredHistory>(historyKey(projectId)) : undefined;
      if (kept && kept.sig === fingerprint(d.scene)) {
        const rebuilt: Step[] = [{ scene: kept.base, label: 'Opened the project', by: 'open', at: kept.chain[0]?.at || Date.now() }];
        for (const { ops, ...info } of kept.chain) rebuilt.push({ ...info, scene: applyOps(rebuilt[rebuilt.length - 1].scene, ops) });
        if (kept.index < rebuilt.length) { start = rebuilt; at = kept.index; }
      }
      steps.current = start; index.current = at;
      const scene = d.scene ? start[at].scene : null;
      current.current = scene;
      setData(d); setSceneState(scene); setDirty(false); showHistory();
    } catch (e: any) { setError(e.message); }
  }, [projectId]);

  // the history is written to disk a moment after it changes
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const all = steps.current, cur = current.current;
      if (!all.length || !cur) return;
      const chain = all.slice(1).map((s, i) => ({ label: s.label, by: s.by, at: s.at, ops: diffScenes(all[i].scene, s.scene) }));
      idbSet(historyKey(projectId), { sig: fingerprint(cur), index: index.current, base: all[0].scene, chain } satisfies StoredHistory);
    }, 1500);
  }, [projectId]);
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load]);

  const commit = useCallback((value: Scene, local = true) => {
    const before = current.current;
    current.current = value;
    setSceneState(value);
    if (local) {
      setDirty(true);
      if (before && localListener.current) { const ops = diffScenes(before, value); if (!isEmpty(ops)) localListener.current(ops); }
    }
    showHistory(); persist();
  }, [persist]);

  // Every change goes through here so it can be undone. During a gesture (e.g. scrubbing a
  // number) the many live changes share one undo step: only the state before it is kept.
  const gesture = useRef<'off' | 'armed' | 'recorded'>('off');
  /** Change the scene; returns the history step the change is (to undo exactly that, later). */
  const setScene = useCallback((next: Scene | ((s: Scene) => Scene), meta?: ChangeMeta): number | undefined => {
    const cur = current.current;
    if (!cur) return;
    const raw = typeof next === 'function' ? next(cur) : next;
    if (raw === cur) return;
    // whatever hangs on a truss goes with it when the truss is moved, turned, resized or reshaped
    const value = raw.objects !== cur.objects ? { ...raw, objects: carryRig(cur.objects, raw.objects) } : raw;
    if (gesture.current === 'recorded') {
      // the rest of a drag: still the same step, now ending here
      steps.current[index.current] = { ...steps.current[index.current], scene: value };
    } else {
      const before = steps.current[index.current]?.scene || cur;
      steps.current = steps.current.slice(0, index.current + 1);
      steps.current.push({ scene: value, label: meta?.label || describeChange(before, value), by: meta?.by || 'you', at: Date.now() });
      if (steps.current.length > MAX_STEPS) steps.current.shift();
      index.current = steps.current.length - 1;
      if (gesture.current === 'armed') gesture.current = 'recorded';
    }
    commit(value);
    return index.current;
  }, [commit]);

  /**
   * Changes a collaborator made, merged in object by object. They are not steps of
   * your history: they go into every step of it, so undoing your own change never
   * takes back theirs.
   */
  const applyRemote = useCallback((ops: SceneOps) => {
    if (!current.current || isEmpty(ops)) return;
    steps.current = steps.current.map((s) => ({ ...s, scene: applyOps(s.scene, ops) }));
    commit(applyOps(current.current, ops), false);
  }, [commit]);
  const setLocalListener = useCallback((fn: ((ops: SceneOps) => void) | null) => { localListener.current = fn; }, []);
  const beginGesture = useCallback(() => { gesture.current = 'armed'; }, []);
  const endGesture = useCallback(() => { gesture.current = 'off'; }, []);

  // Like real furniture, objects cannot pass through the room's walls.
  const floorRef = useRef<Floor | null>(null);
  useEffect(() => { floorRef.current = data?.venue?.analysis?.floor || null; }, [data?.venue?.analysis?.floor]);
  const fit = (o: SceneObject) => (floorRef.current ? keepInside(o, floorRef.current) : o);

  // truss-mounted lights moved near a truss clamp onto it
  const updateObject = useCallback((id: string, patch: Partial<SceneObject>) =>
    setScene((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? fit(snapToRig({ ...o, ...patch }, s.objects)) : o)) })), [setScene]);

  const updateWhere = useCallback((pred: (o: SceneObject) => boolean, patch: Partial<SceneObject>) =>
    setScene((s) => ({ ...s, objects: s.objects.map((o) => (pred(o) ? { ...o, ...patch } : o)) })), [setScene]);

  const removeObject = useCallback((id: string) => {
    setScene((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== id && o.group !== id) }));
    setSelectedId(null);
  }, [setScene]);

  const addObject = useCallback((o: Omit<SceneObject, 'id'> & { id?: string }) => {
    const id = o.id || `${o.type}_${Date.now().toString(36)}`;
    // a new truss light goes straight onto the nearest truss, wherever that is, and is focused where a
    // lighting designer would point it (the stage at performer height, the dance floor, a table) unless aimed already
    setScene((s) => {
      let n = fit(snapToRig({ ...o, id, userAdded: true } as SceneObject, s.objects, Infinity));
      // on the nearest spot where it can really stand: not inside a table, a chair or the stage edge, not on the dance floor
      const free = placeFree(n, s.objects, floorRef.current, { floorY: (floorRef.current as any)?.floorY ?? 0 });
      if (free) n = free;
      const focus = n.spec?.pan == null && n.spec?.tilt == null ? autoFocus(n, s.objects) : null;
      if (focus) n = { ...n, spec: { ...n.spec, ...aimAt(n, focus) } };
      const next = { ...s, objects: [...s.objects, n] };
      return n.type === 'light' && isPlaying() ? programLights(next) : next; // added mid-show: it joins the show
    });
    setSelectedId(id);
    return id;
  }, [setScene]);

  const duplicate = useCallback((id: string) => {
    const o = scene?.objects.find((x) => x.id === id);
    if (!o) return;
    addObject({ ...o, id: undefined, name: `${o.name} copy`, position: [o.position[0] + 1, o.position[1], o.position[2] + 1] } as any);
  }, [scene, addObject]);

  /** Go to any step of the history: back (undo) or forward again (redo). */
  const jumpTo = useCallback((i: number) => {
    if (i < 0 || i >= steps.current.length || i === index.current || !current.current) return;
    index.current = i;
    commit(steps.current[i].scene);
  }, [commit]);
  const undo = useCallback(() => jumpTo(index.current - 1), [jumpTo]);
  const redo = useCallback(() => jumpTo(index.current + 1), [jumpTo]);

  // Autosave: two seconds after the last change, and straight away if the page is hidden or closed.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosave = useCallback(async (keepalive = false) => {
    const sc = current.current;
    if (!sc) return;
    try {
      const r = await api<{ version: number }>(`/projects/${projectId}/versions`, { body: { scene: sc, autosave: true }, keepalive });
      if (current.current === sc) setDirty(false); // nothing changed while it saved
      setData((d) => (d ? { ...d, version: r.version } : d));
      setSavedAt(Date.now());
      persist();
    } catch { /* offline: try again on the next change */ }
  }, [projectId, persist]);
  useEffect(() => {
    if (!dirty) return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => autosave(), 2000);
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current); };
  }, [scene, dirty, autosave]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flush = () => { if (dirty) autosave(true); };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden); };
  }, [dirty, autosave]);

  const save = useCallback(async (label = 'Edited') => {
    if (!scene) return;
    setSaving(true);
    try {
      const r = await api<{ version: number }>(`/projects/${projectId}/versions`, { body: { scene, label } });
      setData((d) => (d ? { ...d, version: r.version } : d));
      setDirty(false); setSavedAt(Date.now());
      return r.version;
    } finally { setSaving(false); }
  }, [scene, projectId]);

  return {
    data, setData, scene, setScene, selectedId, setSelectedId, dirty, saving, savedAt, error, reload: load,
    updateObject, updateWhere, removeObject, addObject, duplicate, undo, redo, jumpTo, save, beginGesture, endGesture,
    canUndo: hist.index > 0, canRedo: hist.index < hist.steps.length - 1, history: hist,
    applyRemote, setLocalListener, role: data?.project.my_role || 'owner',
  };
}

export type EditorState = ReturnType<typeof useEditor>;
