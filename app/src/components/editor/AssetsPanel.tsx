// Add objects: one search over Novira's own built-to-measure structures and
// real furniture, and over the BlenderKit / Poly Haven / Sketchfab libraries
// (a one-line switch with their logos). With no search, it suggests what fits
// this kind of event and isn't in the room yet. Library results show straight
// away, thumbnails load lazily and more load as you scroll.
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, TextInput, View } from 'react-native';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Button, ErrorNote, Icon, T, s as ui, type IconName } from '@/components/ui';
import { fileUrl } from '@/lib/api';
import { useCatalog } from '@/lib/catalog';
import { C } from '@/lib/theme';
import type { SceneObject, Vec3 } from '@/lib/types';
import { newProcedural, varietiesFor } from '@/nozila/adapter';
import { usePanelWidth } from './ResizablePanel';
import { cachedPage, endAssetDrag, importLibraryModel, libraryFirstPage, librarySearch, startAssetDrag, type DragPayload } from '@/lib/assetDrag';
import { ProceduralThumb, cachedThumbnail, thumbnailFor } from '@/nozila/thumbnails';
import type { EditorState } from './useEditor';

type Tab = 'furniture' | 'blenderkit' | 'polyhaven' | 'sketchfab';
type Result = { source: string; externalId: string; name: string; author?: string; license?: string; thumbnail?: string | null; needsKey?: boolean; viewerUrl?: string; downloadApiUrl?: string };

// Default sizes for catalogue furniture (metres), matching what the solver places.
const FURNITURE: Record<string, { label: string; size: Vec3; color: string; extra?: Partial<SceneObject> }> = {
  chair: { label: 'Banquet chair', size: [0.45, 0.92, 0.45], color: '#C9A227' },
  round_table: { label: 'Round table, 1.8 m', size: [1.8, 0.76, 1.8], color: '#F7F3E8' },
  long_table: { label: 'Banquet table, 2.4 m', size: [2.4, 0.76, 0.9], color: '#F7F3E8' },
  cocktail_table: { label: 'High cocktail table', size: [0.7, 1.1, 0.7], color: '#F7F3E8' },
  sofa: { label: 'Lounge sofa', size: [2.2, 0.85, 0.9], color: '#2F4470' },
  bar: { label: 'Bar counter', size: [0.7, 1.1, 3], color: '#3B2E25' },
  lectern: { label: 'Podium', size: [0.7, 1.2, 0.5], color: '#2B3A55' },
  centrepiece: { label: 'Candelabra', size: [0.32, 0.75, 0.32], color: '#C9A227' },
  speaker: { label: 'Speaker on stand', size: [0.6, 2.2, 0.6], color: '#20242C' },
};
// Event elements that are built to measure rather than sourced.
// Event structures built procedurally to real trade specs (Nozila builds);
// each has varieties behind its thumbnail.
const STRUCTURES: { label: string; note: string; type: string }[] = [
  { label: 'Stage', note: '4 ft decks, skirting, stairs', type: 'stage' },
  { label: 'Dance floor', note: 'Checker, gloss, oak, starlit', type: 'dance_floor' },
  { label: 'Posters, banners & screens', note: 'Easel, roll-up, backdrop, media wall, TV', type: 'sign' },
  { label: 'LED wall', note: '0.5 m cabinets, ground support', type: 'led_screen' },
  { label: 'Tent / marquee', note: 'Frame and clearspan, all sizes', type: 'tent' },
  { label: 'Truss', note: 'Goalpost, arch, circle, grid…', type: 'truss' },
  { label: 'Pipe & drape', note: 'Curtains, backdrops', type: 'curtain' },
  { label: 'Exhibition stand', note: 'Shell scheme to island', type: 'booth' },
  { label: 'Stage light', note: 'Moving heads, pars, profiles…', type: 'light' },
  { label: 'Chandelier', note: 'Crystal waterfall, candle, crystal ball', type: 'chandelier' },
  { label: 'Ceiling drapes', note: 'Fabric swags, parallel or a canopy', type: 'ceiling_drape' },
  { label: 'Wedding arch', note: 'Round, canopy or hexagon, draped, flowers', type: 'arch' },
];
const BUILT: { label: string; icon: IconName; make: () => Omit<SceneObject, 'id' | 'position'> }[] = [
];

// Measure an imported model so it is placed at its real size, not a guess.
let loader: GLTFLoader | null = null;
export async function measure(url: string): Promise<Vec3> {
  if (!loader) {
    loader = new GLTFLoader();
    const draco = new DRACOLoader(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
    loader.setDRACOLoader(draco);
  }
  const g = await loader.loadAsync(fileUrl(url));
  const s = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
  let k = 1; const max = Math.max(s.x, s.y, s.z);
  if (max > 300) k = 0.01; else if (max > 30) k = 0.1; // files authored in cm / mm-ish units
  return [s.x, s.y, s.z].map((v) => Math.max(0.05, Math.round(v * k * 100) / 100)) as Vec3;
}

export const SOURCES: { key: Tab; label: string; logo?: number; bg?: string }[] = [
  { key: 'furniture', label: 'Built-in: stages, LED, truss, lights, furniture…' },
  { key: 'blenderkit', label: 'BlenderKit', logo: require('../../../assets/sources/blenderkit.png'), bg: '#000000' },
  { key: 'polyhaven', label: 'Poly Haven', logo: require('../../../assets/sources/polyhaven.png'), bg: '#000000' },
  { key: 'sketchfab', label: 'Sketchfab', logo: require('../../../assets/sources/sketchfab.png'), bg: '#1CA9DA' },
];

/** One line: our own objects, then each library as its logo. The chosen one is lit with a blue ring; the rest stay visible, dimmed. */
function SourceSwitch({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
      {SOURCES.map((src) => {
        const on = value === src.key;
        return (
          <Pressable key={src.key} onPress={() => onChange(src.key)} accessibilityLabel={src.label} {...({ title: src.label } as any)}
            style={({ hovered }: any) => ({
              // our own objects: a square cube button; libraries share the rest of the line as logo badges
              ...(src.logo ? { flex: 1, paddingHorizontal: 5 } : { width: 34 }), height: 32, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
              backgroundColor: src.logo ? src.bg : on ? C.blue : C.surface, borderWidth: src.logo ? 0 : 1, borderColor: on ? C.blue : C.border,
              opacity: on || hovered ? 1 : 0.55, boxShadow: on ? `0 0 0 2px ${C.surface}, 0 0 0 4px ${C.blue}` : 'none', transform: [{ scale: on ? 1 : 0.97 }],
            } as any)}>
            {src.logo
              ? <Image source={src.logo} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
              : <Icon name="box" size={16} color={on ? '#fff' : C.blue} />}
          </Pressable>
        );
      })}
    </View>
  );
}

// What usually goes into each kind of event, most useful first.
const SUGGEST: Record<string, string[]> = {
  wedding: ['dance_floor', 'curtain', 'light', 'sign', 'centrepiece', 'led_screen'],
  conference: ['led_screen', 'lectern', 'stage', 'sign', 'booth', 'light'],
  exhibition: ['booth', 'sign', 'truss', 'light', 'led_screen', 'cocktail_table'],
  launch: ['led_screen', 'truss', 'light', 'stage', 'sign', 'cocktail_table'],
  party: ['dance_floor', 'light', 'truss', 'bar', 'cocktail_table', 'led_screen'],
  gala: ['led_screen', 'dance_floor', 'light', 'truss', 'curtain', 'sign'],
  dinner: ['centrepiece', 'curtain', 'light', 'sign', 'bar', 'dance_floor'],
};

export function AssetsPanel({ ed, focus }: { ed: EditorState; focus: () => [number, number] }) {
  const [tab, setTab] = useState<Tab>('furniture');
  const [q, setQ] = useState('');
  const y = ed.data?.venue?.analysis?.floor?.floorY ?? 0;
  const add = (o: Omit<SceneObject, 'id' | 'position'>) => { const [x, z] = focus(); ed.addObject({ ...o, position: [x, y, z] } as any); };
  const addAt = (o: Omit<SceneObject, 'id'>) => { const [x, z] = focus(); ed.addObject({ ...o, position: [x, y + o.position[1], z] }); };

  return (
    <View style={{ flex: 1 }}>
      {/* the source switch sits where the panel title was */}
      <SourceSwitch value={tab} onChange={setTab} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, height: 36 }}>
        <Icon name="search" size={15} color={C.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={tab === 'furniture' ? 'Search stages, lights, chairs, drapes…' : `Search ${SOURCES.find((x) => x.key === tab)?.label}…`} placeholderTextColor={C.muted} style={[ui.input, { flex: 1, height: 34, borderWidth: 0, paddingHorizontal: 0, outlineStyle: 'none' } as any]} />
        {q ? <Pressable onPress={() => setQ('')} accessibilityLabel="Clear search"><Icon name="x" size={15} color={C.muted} /></Pressable> : null}
      </View>
      {tab === 'furniture'
        ? <FurnitureTab q={q} ed={ed} add={add} addAt={addAt} searchLibrary={setTab} />
        : <LibraryTab key={tab} source={tab} q={q} add={add} />}
    </View>
  );
}

/** Makes an Add objects row or card draggable into the 3D view (a click still adds it). */
function Drag({ payload, children }: { payload: () => DragPayload; children: React.ReactNode }) {
  return createElement('div', {
    draggable: true, style: { cursor: 'grab' },
    onDragStart: (e: DragEvent) => startAssetDrag(e, payload()),
    onDragEnd: () => endAssetDrag(),
  }, children);
}

/** Draw the built-in pictures ahead of time, so the panel never waits on them. */
export function warmAddObjects() {
  STRUCTURES.forEach((st, i) => setTimeout(() => {
    const p = newProcedural(st.type);
    thumbnailFor({ ...p, id: `thumb-${st.type}`, position: p.position || [0, 0, 0] } as SceneObject).catch(() => undefined);
  }, 400 + i * 250));
}

type Row = { kind: 'real'; type: string } | { kind: 'built'; i: number } | { kind: 'proc'; i: number } | { kind: 'head'; label: string } | { kind: 'libraries' };

function FurnitureTab({ q, ed, add, addAt, searchLibrary }: {
  q: string; ed: EditorState; add: (o: Omit<SceneObject, 'id' | 'position'>) => void; addAt: (o: Omit<SceneObject, 'id'>) => void; searchLibrary: (t: Tab) => void;
}) {
  const catalog = useCatalog();
  // lights and LED walls carry their own height off the floor
  const addProc = (p: ReturnType<typeof newProcedural>) => (p.position ? addAt(p as Omit<SceneObject, 'id'>) : add(p));
  if (!catalog) return <ActivityIndicator color={C.blue} />;
  const items = Object.entries(FURNITURE).filter(([type]) => catalog[type]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (...text: string[]) => words.every((w) => text.join(' ').toLowerCase().includes(w));
  const structs = STRUCTURES.map((st, i) => ({ st, i })).filter(({ st }) => !words.length || matches(st.label, st.note, st.type.replace('_', ' ')));
  const furniture = items.filter(([type, f]) => !words.length || matches(f.label, type.replace('_', ' '), catalog[type].name));
  // with no search: what this kind of event usually needs and the room doesn't have yet
  const have = new Set<string>(ed.scene?.objects.map((o) => o.type));
  const kind = ed.scene?.plan?.eventType || 'gala';
  const suggested = words.length ? [] : (SUGGEST[kind] || SUGGEST.gala).filter((t) => !have.has(t) || t === 'light' || t === 'sign').slice(0, 4);
  const sugRows: Row[] = suggested.flatMap((t): Row[] => {
    const i = STRUCTURES.findIndex((st) => st.type === t);
    return i >= 0 ? [{ kind: 'proc', i }] : catalog[t] && FURNITURE[t] ? [{ kind: 'real', type: t }] : [];
  });
  const rows: Row[] = [
    ...(sugRows.length ? [{ kind: 'head' as const, label: `Suggested for this ${kind}` }, ...sugRows] : []),
    ...(structs.length ? [{ kind: 'head' as const, label: 'Event structures' }, ...structs.map(({ i }) => ({ kind: 'proc' as const, i }))] : []),
    ...(furniture.length ? [{ kind: 'head' as const, label: 'Real event furniture' }, ...furniture.map(([type]) => ({ kind: 'real' as const, type }))] : []),
    ...(BUILT.length && !words.length ? [{ kind: 'head' as const, label: 'More' }, ...BUILT.map((_, i) => ({ kind: 'built' as const, i }))] : []),
    ...(words.length ? [{ kind: 'head' as const, label: structs.length + furniture.length ? 'From the libraries' : `Nothing built-in for “${q}” — from the libraries` }, { kind: 'libraries' as const }] : []),
  ];
  return (
    <FlatList
      data={rows}
      keyExtractor={(r, i) => `${r.kind}-${i}`}
      renderItem={({ item: r }) => {
        if (r.kind === 'head') return <T size={12} weight="600" color={C.sub} style={{ marginTop: 6, marginBottom: 8 }}>{r.label}</T>;
        if (r.kind === 'libraries') return (
          // the same words searched in every library at once, top results right here
          <View style={{ marginTop: 4, gap: 14 }}>
            {SOURCES.filter((x) => x.logo).map((x) => <LibraryStrip key={x.key} source={x.key as Exclude<Tab, 'furniture'>} q={q} add={add} seeAll={() => searchLibrary(x.key)} />)}
          </View>
        );
        if (r.kind === 'proc') {
          const st = STRUCTURES[r.i], proto = newProcedural(st.type);
          const thumbOf = { ...proto, id: `thumb-${st.type}`, position: proto.position || [0, 0, 0] } as SceneObject;
          return (
            <Drag payload={() => ({ label: st.label, note: st.note, thumb: cachedThumbnail(thumbOf), make: () => newProcedural(st.type) })}>
            <Pressable onPress={() => addProc(proto)}
              style={({ hovered }: any) => ({ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 8, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderColor: hovered ? C.blue : C.border })}>
              <View style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden' }}><ProceduralThumb o={{ ...proto, id: `thumb-${st.type}`, position: proto.position || [0, 0, 0] } as SceneObject} size={64} /></View>
              <View style={{ flex: 1 }}>
                <T size={12.5} weight="600" numberOfLines={1}>{st.label}</T>
                <T size={11} color={C.muted} numberOfLines={1}>{st.note}</T>
                <T size={11} color={C.blue} numberOfLines={1}>{varietiesFor(st.type).length} varieties</T>
              </View>
              <Icon name="plus" size={16} color={C.blue} />
            </Pressable>
            </Drag>
          );
        }
        if (r.kind === 'real') {
          const f = FURNITURE[r.type], c = catalog[r.type];
          const make = () => ({ type: r.type as any, name: f.label, rotation: [0, 0, 0] as Vec3, size: f.size, color: f.color });
          return (
            <Drag payload={() => ({ label: f.label, note: c.name, thumb: c.thumbnail, make })}>
            <Pressable onPress={() => add(make())}
              style={({ hovered }: any) => ({ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 8, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderColor: hovered ? C.blue : C.border })}>
              <Image source={{ uri: c.thumbnail || undefined }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: C.bg }} resizeMode="cover" />
              <View style={{ flex: 1 }}>
                <T size={12.5} weight="600" numberOfLines={1}>{f.label}</T>
                <T size={11} color={C.muted} numberOfLines={1}>{c.name}</T>
                <T size={11} color={C.muted} numberOfLines={1}>{f.size.join(' × ')} m · {c.license || 'Royalty free'}</T>
              </View>
              <Icon name="plus" size={16} color={C.blue} />
            </Pressable>
            </Drag>
          );
        }
        const b = BUILT[r.i];
        return (
          <Pressable onPress={() => add(b.make())} style={({ hovered }: any) => ({ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 8, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderColor: hovered ? C.blue : C.border })}>
            <View style={{ width: 64, height: 44, borderRadius: 8, backgroundColor: C.blueTint, alignItems: 'center', justifyContent: 'center' }}><Icon name={b.icon} size={18} color={C.blue} /></View>
            <T size={12.5} weight="600" style={{ flex: 1 }}>{b.label}</T>
            <Icon name="plus" size={16} color={C.blue} />
          </Pressable>
        );
      }}
    />
  );
}

/** Place an imported library model at its real size. */
async function addLibraryModel(m: Result, add: (o: Omit<SceneObject, 'id' | 'position'>) => void) {
  const a = await importLibraryModel(m);
  const size = a.size || await measure(a.file_url).catch(() => [1, 1, 1] as Vec3);
  add({ type: 'model', name: m.name.slice(0, 60), rotation: [0, 0, 0], size, color: '#CBD3DD', modelUrl: a.file_url,
    asset: { url: a.file_url, name: m.name, thumbnail: m.thumbnail, author: m.author, license: m.license, source: m.source, externalId: m.externalId } });
}

/** One library's best matches for the search, inline under the built-in results (drag or click to add). */
function LibraryStrip({ source, q, add, seeAll }: { source: Exclude<Tab, 'furniture'>; q: string; add: (o: Omit<SceneObject, 'id' | 'position'>) => void; seeAll: () => void }) {
  const query = q.trim();
  const [found, setFound] = useState<{ q: string; items: Result[]; more: boolean } | null>(() => {
    const c = cachedPage(source, query);
    return c ? { q: query, items: c.results, more: !!c.next } : null;
  });
  const [failed, setFailed] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      libraryFirstPage(source, query).then((r) => { if (live) { setFound({ q: query, items: r.results, more: !!r.next }); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    }, cachedPage(source, query) ? 0 : 300);
    return () => { live = false; clearTimeout(t); };
  }, [source, query]);
  const panel = usePanelWidth(), cols = panel < 380 ? 2 : panel < 500 ? 3 : 4, show = found?.q === query ? found.items.filter((m) => !m.needsKey || source === 'sketchfab').slice(0, cols * 2) : null;
  const src = SOURCES.find((x) => x.key === source)!;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 74, height: 22, borderRadius: 5, overflow: 'hidden', backgroundColor: src.bg, paddingHorizontal: 4 }}><Image source={src.logo!} style={{ width: '100%', height: '100%' }} resizeMode="contain" /></View>
        <T size={11.5} color={C.sub} style={{ flex: 1 }} numberOfLines={1}>{!show ? (failed ? 'Couldn’t reach it right now' : 'Searching…') : show.length ? `“${query}”` : `Nothing for “${query}”`}</T>
        {show?.length ? <Pressable onPress={seeAll}><T size={11.5} weight="600" color={C.blue}>See all ›</T></Pressable> : null}
      </View>
      {!show && !failed ? <ActivityIndicator size="small" color={C.blue} style={{ alignSelf: 'flex-start' }} /> : null}
      {show?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {show.map((m) => (
            <View key={m.externalId} style={{ width: `calc(${100 / cols}% - ${(8 * (cols - 1)) / cols}px)` } as any}>
              <Drag payload={() => ({ label: m.name, note: m.license || src.label, thumb: m.thumbnail, library: m.needsKey ? undefined : m })}>
                <Pressable onPress={() => { if (m.needsKey) { window.open(m.viewerUrl || `https://sketchfab.com/3d-models/${m.externalId}`, '_blank'); return; } setImporting(m.externalId); addLibraryModel(m, add).catch(() => undefined).finally(() => setImporting(null)); }}
                  {...({ title: m.needsKey ? `${m.name} · view on Sketchfab` : `${m.name} · click or drag into the room` } as any)}
                  style={({ hovered }: any) => ({ borderRadius: 9, borderWidth: 1, borderColor: hovered ? C.blue : C.border, overflow: 'hidden', backgroundColor: C.surface })}>
                  {m.thumbnail ? <Image source={{ uri: m.thumbnail }} style={{ width: '100%', aspectRatio: 1.25, backgroundColor: C.bg }} resizeMode="cover" /> : <View style={{ aspectRatio: 1.25, backgroundColor: C.bg }} />}
                  <View style={{ padding: 6 }}><T size={10.5} numberOfLines={1}>{m.name}</T></View>
                  {importing === m.externalId ? <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,.7)', alignItems: 'center', justifyContent: 'center' } as any}><ActivityIndicator color={C.blue} /></View> : null}
                </Pressable>
              </Drag>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LibraryTab({ source, q, add }: { source: Exclude<Tab, 'furniture'>; q: string; add: (o: Omit<SceneObject, 'id' | 'position'>) => void }) {
  // the opening page is usually fetched already (the editor warms every library), so it shows at once
  const warm = cachedPage(source, q.trim());
  const [items, setItems] = useState<Result[]>(() => warm?.results || []);
  // more columns as the panel is widened
  const panel = usePanelWidth(), cols = panel < 380 ? 2 : panel < 500 ? 3 : 4, thumbH = Math.round(((panel - 32 - (cols - 1) * 8) / cols) * 0.72);
  const [next, setNext] = useState<string | null>(() => warm?.next || null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (query: string, cursor: string | null) => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const r = cursor ? await librarySearch(source, query, cursor) : await libraryFirstPage(source, query);
      if (id !== reqId.current) return; // a newer search replaced this one
      setItems((prev) => {
        const all = cursor ? [...prev, ...r.results] : r.results;
        const seen = new Set<string>();
        return all.filter((x) => (seen.has(x.externalId) ? false : (seen.add(x.externalId), true)));
      });
      setNext(r.next);
    } catch (e: any) { if (id === reqId.current) setError(e.message); } finally { if (id === reqId.current) setLoading(false); }
  }, [source]);

  // browse immediately, and re-search as the user types (debounced)
  useEffect(() => {
    const ready = cachedPage(source, q.trim());
    const t = setTimeout(() => {
      if (ready) { setItems(ready.results); setNext(ready.next); return; } // fetched ahead: no wait
      setItems([]); setNext(null); load(q.trim(), null);
    }, ready || !q ? 0 : 350);
    return () => clearTimeout(t);
  }, [q, load, source]);

  const more = () => { if (next && !loading) load(q.trim(), next); };

  const importModel = async (m: Result) => {
    setImporting(m.externalId); setError(null);
    try {
      const a = await importLibraryModel(m);
      const size = a.size || await measure(a.file_url).catch(() => [1, 1, 1] as Vec3);
      add({ type: 'model', name: m.name.slice(0, 60), rotation: [0, 0, 0], size, color: '#CBD3DD', modelUrl: a.file_url,
        asset: { url: a.file_url, name: m.name, thumbnail: m.thumbnail, author: m.author, license: m.license, source: m.source, externalId: m.externalId } });
    } catch (e: any) { setError(e.message); } finally { setImporting(null); }
  };

  const label = { blenderkit: 'BlenderKit', polyhaven: 'Poly Haven', sketchfab: 'Sketchfab' }[source];
  return (
    <View style={{ flex: 1 }}>
      <T size={11} color={C.muted} style={{ marginBottom: 6 }}>{q ? `Results for “${q}”` : source === 'polyhaven' ? 'Most downloaded · CC0, free for commercial use' : source === 'blenderkit' ? 'Popular free furniture · royalty-free / CC0' : 'Popular downloadable models'}</T>
      <ErrorNote text={error} />
      {source === 'sketchfab' && items.some((r) => r.needsKey) && (
        <View style={{ flexDirection: 'row', gap: 8, padding: 8, borderRadius: 8, backgroundColor: C.amberTint, marginBottom: 6 }}>
          <Icon name="info" size={14} color={C.amber} />
          <T size={11} color="#6B4300" style={{ flex: 1 }}>Import needs SKETCHFAB_API_TOKEN in server/.env. BlenderKit and Poly Haven import without a key.</T>
        </View>
      )}
      <FlatList
        key={cols}
        data={items}
        numColumns={cols}
        keyExtractor={(m) => m.externalId}
        columnWrapperStyle={{ gap: 8 }}
        contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
        onEndReached={more}
        onEndReachedThreshold={0.6}
        initialNumToRender={8}
        windowSize={5}
        removeClippedSubviews
        ListEmptyComponent={loading ? undefined : <T size={12} color={C.muted} style={{ marginTop: 10 }}>No models found{q ? ` for “${q}”` : ''}.</T>}
        ListFooterComponent={loading ? <ActivityIndicator color={C.blue} style={{ marginVertical: 12 }} /> : !next && items.length ? <T size={11} color={C.muted} style={{ textAlign: 'center', marginVertical: 10 }}>That’s everything.</T> : undefined}
        renderItem={({ item: m }) => (
          <View style={{ flex: 1, maxWidth: `${100 / cols}%` }}>
          <Drag payload={() => ({ label: m.name, note: m.license || label, thumb: m.thumbnail, library: m.needsKey ? undefined : m })}>
          <View {...({ onPointerDown: () => { if (!m.needsKey) importLibraryModel(m).catch(() => undefined); } } as any)} style={{ borderRadius: 10, borderWidth: 1, borderColor: C.border, overflow: 'hidden', backgroundColor: C.surface }}>
            {m.thumbnail ? <Image source={{ uri: m.thumbnail }} style={{ width: '100%', height: thumbH, backgroundColor: C.bg }} resizeMode="cover" /> : <View style={{ height: thumbH, backgroundColor: C.bg }} />}
            <View style={{ padding: 8, gap: 2 }}>
              <T size={11.5} weight="600" numberOfLines={1}>{m.name}</T>
              <T size={10.5} color={C.muted} numberOfLines={1}>{m.license || label}{m.author ? ` · ${m.author}` : ''}</T>
              {m.needsKey
                ? <Button small kind="secondary" label="View" icon="external-link" onPress={() => window.open(m.viewerUrl || `https://sketchfab.com/3d-models/${m.externalId}`, '_blank')} style={{ marginTop: 6 }} />
                : <Button small kind="soft" label="Add" icon="plus" loading={importing === m.externalId} onPress={() => importModel(m)} style={{ marginTop: 6 }} />}
            </View>
          </View>
          </Drag>
          </View>
        )}
      />
    </View>
  );
}
