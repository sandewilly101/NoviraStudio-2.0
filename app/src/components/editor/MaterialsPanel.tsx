// Materials library: real PBR scans from Poly Haven, plus materials painted
// with AI for anything the library doesn't have (type it, then "Create with
// AI" — a Maasai shuka check, a kente weave, a branded print). Drag a swatch onto any
// surface in the 3D view (a chair, tablecloth, stage deck or skirting, drape,
// dance floor, stand carpet, or the venue's own floor and walls), or click it
// to put it on the selected object. Hold Shift while dropping to cover every
// object of that kind.
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, TextInput, View } from 'react-native';
import { Chip, ErrorNote, Icon, PanelTitle, T, s as ui } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { slotsOf } from '@/lib/finish';
import { C } from '@/lib/theme';
import type { Finish } from '@/lib/types';
import { usePanelWidth } from './ResizablePanel';
import { endAssetDrag, startAssetDrag } from '@/lib/assetDrag';
import type { EditorState } from './useEditor';

export const MATERIAL_MIME = 'application/x-novira-material';
type Item = { slug: string; name: string; thumb: string; categories?: string[]; sizeM: number; ai?: boolean };
const thumbOf = (it: Item) => (it.thumb.startsWith('/') ? fileUrl(it.thumb) : it.thumb);
const GROUPS = [['', 'All'], ['fabric', 'Fabric'], ['wood', 'Wood'], ['floor', 'Floors'], ['stone', 'Tiles & stone'], ['metal', 'Metal'], ['wall', 'Walls & plaster'], ['leather', 'Leather']] as const;

/** Downloads a material's maps (once, server side) and returns it ready to apply; shared, so picking a swatch up starts it. */
const finishes = new Map<string, Promise<Finish>>();
export function fetchFinish(slug: string) {
  let p = finishes.get(slug);
  if (!p) { p = api<Finish>(`/materials/${slug}`, { method: 'POST' }); finishes.set(slug, p); p.catch(() => finishes.delete(slug)); }
  return p;
}

export function MaterialsPanel({ ed, flash }: { ed: EditorState; flash: (t: string) => void }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // folded away by default; remembered per browser
  const [filters, setFiltersState] = useState(() => { try { return localStorage.getItem('novira.materials.filters') === '1'; } catch { return false; } });
  const setFilters = (v: boolean) => { setFiltersState(v); try { localStorage.setItem('novira.materials.filters', v ? '1' : '0'); } catch { /* not remembered */ } };
  const [tips, setTips] = useState(false);
  // materials painted with AI (kept on the server), and one being painted now
  const [mine, setMine] = useState<Item[]>([]);
  const [making, setMaking] = useState<string | null>(null);
  useEffect(() => { api<{ results: Item[] }>('/materials/mine').then((r) => setMine(r.results)).catch(() => undefined); }, []);
  const create = async () => {
    const words = q.trim();
    if (!words || making) return;
    setMaking(words); setError(null);
    try {
      const f = await api<Item>('/materials/generate', { body: { prompt: words } });
      setMine((m) => [f, ...m]);
      flash(`${f.name} is ready — drag it onto a surface${sel ? ', or click it for the selected object' : ''}.`);
    } catch (e: any) { setError(e.message); } finally { setMaking(null); }
  };
  const req = useRef(0);
  const width = usePanelWidth(), cols = width < 340 ? 3 : width < 460 ? 4 : 5;

  const load = useCallback(async (cursor: string | null) => {
    const id = ++req.current;
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ q: q.trim(), group });
      if (cursor) p.set('cursor', cursor);
      const r = await api<{ results: Item[]; next: string | null }>(`/materials?${p}`);
      if (id !== req.current) return;
      setItems((prev) => [...(cursor ? prev : []), ...r.results]); setNext(r.next);
    } catch (e: any) { if (id === req.current) setError(e.message); } finally { if (id === req.current) setLoading(false); }
  }, [q, group]);
  useEffect(() => { const t = setTimeout(() => load(null), 300); return () => clearTimeout(t); }, [load]);

  // click: the selected object's main surface
  const sel = ed.scene?.objects.find((o) => o.id === ed.selectedId);
  const apply = async (it: Item) => {
    const slot = sel && slotsOf(sel)[0];
    if (!sel || !slot) { flash('Drag the material onto a surface in the 3D view, or select an object first.'); return; }
    setBusy(it.slug);
    try { const f = await fetchFinish(it.slug); ed.updateObject(sel.id, { finish: { ...sel.finish, [slot.key]: f } }); flash(`${f.name} on ${sel.name} (${slot.label.toLowerCase()})`); }
    catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1 }}>
      <PanelTitle title="Materials" right={
        <Pressable onPress={() => setTips(!tips)} accessibilityLabel="How to use materials" {...({ title: 'How to use materials' } as any)} style={{ padding: 4 }}>
          <Icon name="help-circle" size={16} color={tips ? C.blue : C.muted} />
        </Pressable>
      } />
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <View style={[ui.input, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 36 }]}>
          <Icon name="search" size={15} color={C.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="velvet, oak, marble, carpet…" placeholderTextColor={C.muted} style={{ flex: 1, outlineStyle: 'none', fontSize: 13, color: C.text } as any} />
        </View>
        {/* the category chips stay folded away until asked for */}
        <Pressable onPress={() => setFilters(!filters)} accessibilityLabel="Filter by kind" {...({ title: 'Filter by kind' } as any)}
          style={({ hovered }: any) => ({ width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: filters || group ? C.blue : hovered ? C.blue : C.border, backgroundColor: filters ? C.blueTint : C.surface })}>
          <Icon name="sliders" size={15} color={filters || group ? C.blue : C.sub} />
          {group && !filters ? <View style={{ position: 'absolute', top: 5, right: 5, width: 7, height: 7, borderRadius: 4, backgroundColor: C.blue }} /> : null}
        </Pressable>
      </View>
      {filters ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {GROUPS.map(([k, l]) => <Chip key={k} label={l} active={group === k} onPress={() => setGroup(k)} />)}
        </View>
      ) : group ? (
        // the chosen kind stays visible as one chip that clears it
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <Pressable onPress={() => setGroup('')} accessibilityLabel="Clear filter" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: C.blueTint }}>
            <T size={11.5} weight="600" color={C.blue}>{GROUPS.find(([k]) => k === group)?.[1]}</T><Icon name="x" size={12} color={C.blue} />
          </Pressable>
        </View>
      ) : null}
      {tips && <T size={11} color={C.muted} style={{ marginTop: 8 }}>Drag onto any surface · click to use on the selected object · hold Shift while dropping to cover all of that kind</T>}
      <View style={{ height: 10 }} />
      <ErrorNote text={error} />
      <FlatList
        key={cols}
        data={[
          // your AI materials first: all of them with no search, the matching ones with one
          ...(making ? [{ slug: '__making', name: making, thumb: '', sizeM: 1 } as Item] : []),
          ...mine.filter((m) => !q.trim() || q.toLowerCase().split(/\s+/).every((w) => m.name.toLowerCase().includes(w))),
          ...items,
        ]}
        ListHeaderComponent={q.trim() && !making ? (
          // anything the library doesn't have can be painted
          <Pressable onPress={create} accessibilityLabel="Create this material with AI"
            style={({ hovered }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderStyle: items.length ? 'dashed' : 'solid', borderColor: hovered || !items.length ? C.blue : C.border, backgroundColor: !items.length ? C.blueTint : C.surface })}>
            <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }}><Icon name="zap" size={16} color="#fff" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T size={12.5} weight="600" color={C.blue} numberOfLines={1}>Create “{q.trim()}” with AI</T>
              <T size={11} color={C.sub} numberOfLines={2}>{items.length ? 'Not quite it? Nano Banana paints a seamless material from your words.' : 'Not in the library — Nano Banana paints a seamless material from your words (about 30 s).'}</T>
            </View>
          </Pressable>
        ) : undefined}
        numColumns={cols}
        keyExtractor={(m) => m.slug}
        columnWrapperStyle={{ gap: 8 }}
        contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
        onEndReached={() => { if (next && !loading) load(next); }}
        onEndReachedThreshold={0.6}
        initialNumToRender={24}
        ListFooterComponent={loading ? <ActivityIndicator color={C.blue} style={{ margin: 12 }} /> : undefined}
        renderItem={({ item: it }) => it.slug === '__making' ? (
          <View style={{ flex: 1, maxWidth: `${100 / cols}%` }}>
            <View style={{ borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.blue, backgroundColor: C.blueTint }}>
              <View style={{ width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}><ActivityIndicator color={C.blue} /><T size={9.5} color={C.blue}>Painting…</T></View>
              <View style={{ padding: 5 }}><T size={10.5} numberOfLines={1} color={C.blue}>{it.name}</T></View>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, maxWidth: `${100 / cols}%` }}>
            {createElement('div', {
              draggable: true, title: `${it.name} · drag onto a surface`,
              // the same drag as objects: a chip that says what it will paint, and the surface lit up in blue
              onDragStart: (e: DragEvent) => { startAssetDrag(e, { label: it.name, thumb: thumbOf(it), material: { slug: it.slug, name: it.name } }); fetchFinish(it.slug).catch(() => undefined); },
              onDragEnd: () => endAssetDrag(),
              onClick: () => apply(it),
              style: { cursor: 'grab', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.surface, position: 'relative' },
            },
              <Image source={{ uri: thumbOf(it) }} style={{ width: '100%', aspectRatio: 1, backgroundColor: C.bg }} resizeMode="cover" />,
              it.ai ? <View style={{ position: 'absolute', top: 4, left: 4, paddingHorizontal: 5, height: 16, borderRadius: 8, backgroundColor: C.blue, justifyContent: 'center' }}><T size={9} weight="700" color="#fff">AI</T></View> : null,
              <View style={{ padding: 5 }}><T size={10.5} numberOfLines={1}>{it.name}</T></View>,
              busy === it.slug ? <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,.6)', alignItems: 'center', justifyContent: 'center' } as any}><ActivityIndicator color={C.blue} /></View> : null,
            )}
          </View>
        )}
      />
    </View>
  );
}
