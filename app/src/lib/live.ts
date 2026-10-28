// Designing together, live. Everyone with the project open shares one session:
// each person's changes reach the others within a fraction of a second, merged
// object by object (two people working on different tables never undo each
// other; on the same object, the latest change wins), and each sees who else is
// there, what they have selected and where they are looking.
import { useEffect, useRef, useState } from 'react';
import { API_URL, api, authToken } from './api';
import { isEmpty, type SceneOps } from './sceneOps';
import type { Scene, SceneObject } from './types';
import type { EditorState } from '@/components/editor/useEditor';
import type { CaptureCtx } from '@/components/three/capture';

export type Presence = { selectedId: string | null; camera?: [number, number, number]; target?: [number, number, number] };
// editing: they changed something in the last few seconds (lastEdit says what)
export type Peer = { id: string; userId: number; name: string; colour: string; presence: Presence | null; editing?: boolean; editedAt?: number; lastEdit?: string };
export type LiveState = { status: 'connecting' | 'live' | 'offline'; me: { id: string; colour: string } | null; peers: Peer[] };

const FLUSH_MS = 80; // edits go out at most ~12 times a second, the latest state of each object
const r2 = (v: number) => Math.round(v * 100) / 100;

/** This tab's id in the session: kept across reloads of the tab, different in every tab. */
function clientId() {
  try {
    const k = 'novira.live.client', had = sessionStorage.getItem(k);
    if (had) return had;
    const id = crypto.randomUUID();
    sessionStorage.setItem(k, id);
    return id;
  } catch { return Math.random().toString(36).slice(2); }
}

/** The changes that turn `a` into `b`, comparing content (a snapshot from someone else shares no objects with ours). */
function diffByContent(a: Scene, b: Scene): SceneOps {
  const mine = new Map(a.objects.map((o) => [o.id, JSON.stringify(o)]));
  const upsert = b.objects.filter((o) => mine.get(o.id) !== JSON.stringify(o));
  const theirs = new Set(b.objects.map((o) => o.id));
  const remove = a.objects.filter((o) => !theirs.has(o.id)).map((o) => o.id);
  const set: Record<string, unknown> = {};
  for (const k of Object.keys(b)) if (k !== 'objects' && JSON.stringify((a as any)[k]) !== JSON.stringify((b as any)[k])) set[k] = (b as any)[k];
  return Object.keys(set).length ? { upsert, remove, set } : { upsert, remove };
}

/** A few words for what someone just did, from the changes they sent. */
function gist(ops: SceneOps, before: Scene | null) {
  const had = new Map((before?.objects || []).map((o) => [o.id, o]));
  const added = ops.upsert.filter((o) => !had.has(o.id)), changed = ops.upsert.length - added.length;
  const name = (o?: SceneObject) => o?.name || 'an object';
  if (added.length) return added.length === 1 ? `added ${name(added[0])}` : `added ${added.length} objects`;
  if (ops.remove.length) return ops.remove.length === 1 ? `removed ${name(had.get(ops.remove[0]))}` : `removed ${ops.remove.length} objects`;
  if (changed) return changed === 1 ? `is editing ${name(ops.upsert[0])}` : `is editing ${changed} objects`;
  return 'changed the scene settings';
}

export function useLive(projectId: string, ed: EditorState, view: CaptureCtx | null): LiveState {
  const [state, setState] = useState<LiveState>({ status: 'connecting', me: null, peers: [] });
  const edRef = useRef(ed);
  useEffect(() => { edRef.current = ed; });
  const loaded = !!ed.scene;

  useEffect(() => {
    if (!loaded || typeof EventSource === 'undefined') return;
    const client = clientId(), path = `/projects/${projectId}/live`;
    const post = (kind: string, data: unknown, to?: string) => api(path, { body: { client, kind, data, to } }).catch(() => { /* reconnecting: the next snapshot catches up */ });
    const setPeers = (fn: (p: Peer[]) => Peer[]) => setState((s) => ({ ...s, peers: fn(s.peers) }));

    const es = new EventSource(`${API_URL}/api${path}?token=${encodeURIComponent(authToken() || '')}&client=${client}`);
    const on = (ev: string, fn: (d: any) => void) => es.addEventListener(ev, (e) => fn(JSON.parse((e as MessageEvent).data)));
    on('welcome', (d) => setState({ status: 'live', me: d.you, peers: d.peers }));
    on('join', (d) => setPeers((ps) => [...ps.filter((p) => p.id !== d.id), { ...d, presence: null }]));
    on('leave', (d) => setPeers((ps) => ps.filter((p) => p.id !== d.id)));
    on('presence', (d) => setPeers((ps) => ps.map((p) => (p.id === d.id ? { ...p, presence: d.presence } : p))));
    on('ops', (d) => {
      const before = edRef.current.scene;
      edRef.current.applyRemote(d.ops);
      const at = Date.now();
      setPeers((ps) => ps.map((p) => (p.id === d.id ? { ...p, editing: true, editedAt: at, lastEdit: gist(d.ops, before) } : p)));
      setTimeout(() => setPeers((ps) => ps.map((p) => (p.id === d.id && p.editedAt === at ? { ...p, editing: false } : p))), 4000);
    });
    // a newcomer asks for the scene as it is now; they get it from whoever is already here
    on('need-snapshot', (d) => { const sc = edRef.current.scene; if (sc) post('snapshot', sc, d.for); });
    on('snapshot', (d) => { const sc = edRef.current.scene; if (sc) edRef.current.applyRemote(diffByContent(sc, d.scene)); });
    es.onerror = () => setState((s) => ({ ...s, status: es.readyState === EventSource.CLOSED ? 'offline' : 'connecting' }));

    // what you change goes out, batched: the latest state of each object, removals, scene settings
    const queue = { upsert: new Map<string, SceneObject>(), remove: new Set<string>(), set: {} as Record<string, unknown> };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const ops: SceneOps = { upsert: [...queue.upsert.values()], remove: [...queue.remove] };
      if (Object.keys(queue.set).length) ops.set = queue.set as SceneOps['set'];
      queue.upsert.clear(); queue.remove.clear(); queue.set = {};
      if (!isEmpty(ops)) post('ops', ops);
    };
    edRef.current.setLocalListener(edRef.current.role === 'viewer' ? null : (ops) => {
      for (const o of ops.upsert) { queue.upsert.set(o.id, o); queue.remove.delete(o.id); }
      for (const id of ops.remove) { queue.remove.add(id); queue.upsert.delete(id); }
      Object.assign(queue.set, ops.set);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    });
    return () => { edRef.current.setLocalListener(null); if (timer) { clearTimeout(timer); flush(); } es.close(); };
  }, [projectId, loaded]);

  // where you are: your selection at once, your camera when it settles somewhere new
  const selected = ed.selectedId;
  useEffect(() => {
    if (state.status !== 'live') return;
    const client = clientId(), path = `/projects/${projectId}/live`;
    let last = '';
    const send = () => {
      const cam = view?.camera.position, t = view?.controls?.target;
      const p: Presence = { selectedId: selected, ...(cam ? { camera: [r2(cam.x), r2(cam.y), r2(cam.z)] } : {}), ...(t ? { target: [r2(t.x), r2(t.y), r2(t.z)] } : {}) };
      const key = JSON.stringify(p);
      if (key === last) return;
      last = key;
      api(path, { body: { client, kind: 'presence', data: p } }).catch(() => {});
    };
    send();
    const t = setInterval(send, 700);
    return () => clearInterval(t);
  }, [projectId, state.status, selected, view]);

  return state;
}
