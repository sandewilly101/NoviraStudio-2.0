// "Replace with…": similar real models for the selected object, with search,
// lazy thumbnails and infinite scroll, from BlenderKit, Poly Haven or Sketchfab.
// Picking one swaps the model in place, keeping position and rotation (and the
// size, except for imported models, which take the new model's real size).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, TextInput, View } from 'react-native';
import { Button, ErrorNote, Icon, T, Toggle, s as ui } from '@/components/ui';
import { importLibraryModel, librarySearch } from '@/lib/assetDrag';
import { measure, SOURCES } from './AssetsPanel';
import { C } from '@/lib/theme';
import type { ObjectAsset, SceneObject, Vec3 } from '@/lib/types';

// What "similar" means for each object type.
export const SIMILAR: Record<string, string> = {
  chair: 'dining chair', round_table: 'round table', long_table: 'dining table', cocktail_table: 'bar table',
  sofa: 'sofa', bar: 'bar counter', lectern: 'podium', centrepiece: 'candelabra', speaker: 'speaker',
};
// Results that are clearly not a like-for-like swap (sets, rooms, the wrong kind of furniture).
const NOT_SIMILAR: Record<string, RegExp> = {
  chair: /\b(set|sets|table|tables|office|gaming|desk|lounge|stool|bench|sofa|armchair|recliner|kitchen)\b/i,
  round_table: /\b(set|chairs?|lamp|coffee|side|night|bedside)\b/i,
  long_table: /\b(set|chairs?|lamp|coffee|side|night|bedside|round)\b/i,
  cocktail_table: /\b(set|chairs?|lamp|coffee|glass|bottle)\b/i,
  sofa: /\b(set|table|bed)\b/i,
  default: /\b(set|room|scene|interior)\b/i,
};
const TYPE_LABEL: Record<string, string> = {
  chair: 'chairs', round_table: 'round tables', long_table: 'long tables', cocktail_table: 'high tables',
  sofa: 'sofas', bar: 'bars', lectern: 'podiums', centrepiece: 'centrepieces', speaker: 'speakers',
};

// Words in model names that say nothing about what the thing is.
const GENERIC = new Set(['kit', 'set', 'pack', 'model', 'models', 'asset', 'assets', 'collection', 'low', 'poly', 'lowpoly', 'high', 'hd', 'hq', 'pbr', 'game', 'ready', 'free', 'version', 'final', 'new', 'old', 'mesh', 'object', 'scene', 'blend', 'blender', 'fbx', 'obj', 'glb', 'gltf', 'textured', 'realistic', 'detailed', 'simple', 'modern', 'the', 'a', 'an', 'of', 'with', 'and', 'for', 'by']);
// What things are, most specific first: the word to search for when one of them is in the name.
const KINDS = ['indoor plant', 'potted plant', 'plant', 'tree', 'palm', 'fern', 'flower', 'bouquet', 'vase', 'candelabra', 'candle', 'lantern', 'lamp', 'chandelier', 'chair', 'stool', 'bench', 'sofa', 'armchair', 'table', 'desk', 'bar', 'counter', 'podium', 'lectern', 'speaker', 'screen', 'tv', 'rug', 'carpet', 'curtain', 'arch', 'basket', 'pot', 'shelf', 'cabinet', 'mirror', 'sculpture', 'statue', 'bottle', 'glass', 'plate', 'cup'];
/** "Indoor Plant Kit.022" → "indoor plant"; "Modern Laurence Dining Chair Yellow" → "dining chair". */
export function kindOf(name: string): string {
  const words = name.toLowerCase().replace(/\.\d+$/, '').replace(/[_\-.()[\]#]+/g, ' ').replace(/\b(v?\d+[a-z]?|\d+k)\b/g, ' ').split(/\s+/).filter((w) => w && !GENERIC.has(w));
  const text = words.join(' ');
  const kind = KINDS.find((k) => new RegExp(`\\b${k}s?\\b`).test(text));
  if (kind) {
    // keep the word right before it when it says what kind (dining chair, coffee table, floor lamp)
    const i = words.findIndex((w) => w.startsWith(kind.split(' ').pop()!)), before = kind.includes(' ') ? '' : words[i - 1];
    return before && /^(dining|coffee|side|bar|floor|table|wall|pendant|arm|accent|lounge|high|round|potted|indoor|outdoor|wedding|flower|crystal|banquet|cocktail)$/.test(before) ? `${before} ${kind}` : kind;
  }
  return words.slice(-2).join(' ') || name;
}

type Result = { source: string; externalId: string; name: string; author?: string; license?: string; thumbnail?: string | null; downloadApiUrl?: string };

export function ReplaceModal({ obj, current, sameType, onClose, onReplace }: {
  obj: SceneObject;
  current: { name: string; thumbnail?: string | null };
  sameType: number;
  onClose: () => void;
  onReplace: (asset: ObjectAsset, all: boolean, size?: Vec3) => void;
}) {
  const imported = obj.type === 'model' || !!obj.modelUrl;
  const [source, setSource] = useState(obj.asset?.source && SOURCES.some((x) => x.key === obj.asset!.source) ? obj.asset.source : 'blenderkit');
  // an imported model searches for its kind: "Sofa 03" → "sofa", "Banquet Chair" → "chair"
  // what to search for: what this was found as last time, the catalogue's own word for the type, or the object word in its name
  const [q, setQ] = useState(obj.asset?.kind || SIMILAR[obj.type] || kindOf(obj.name));
  const [items, setItems] = useState<Result[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [all, setAll] = useState(sameType > 1);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (query: string, cursor: string | null) => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const r = { ...(await librarySearch(source, query, cursor)) } as { results: Result[]; next: string | null };
      if (id !== reqId.current) return;
      const bad = NOT_SIMILAR[obj.type] || NOT_SIMILAR.default;
      r.results = r.results.filter((x) => !bad.test(x.name));
      setItems((prev) => {
        const seen = new Set<string>();
        return [...(cursor ? prev : []), ...r.results].filter((x) => (seen.has(x.externalId) ? false : (seen.add(x.externalId), true)));
      });
      setNext(r.next);
    } catch (e: any) { if (id === reqId.current) setError(e.message); } finally { if (id === reqId.current) setLoading(false); }
  }, [obj.type, source]);

  useEffect(() => {
    const t = setTimeout(() => { setItems([]); setNext(null); load(q.trim() || SIMILAR[obj.type] || 'furniture', null); }, 350);
    return () => clearTimeout(t);
  }, [q, load, obj.type]);

  const pick = async (m: Result) => {
    setBusyId(m.externalId); setError(null);
    try {
      const a = await importLibraryModel(m as any);
      const size = imported ? a.size || await measure(a.file_url).catch(() => undefined) : undefined;
      onReplace({ url: a.file_url, name: m.name, thumbnail: m.thumbnail, author: m.author, license: m.license, source: m.source, externalId: m.externalId, kind: q.trim() || obj.asset?.kind }, all, size);
      onClose();
    } catch (e: any) { setError(e.message); setBusyId(null); }
  };

  const label = SOURCES.find((x) => x.key === source)?.label || 'BlenderKit';
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(18,26,43,.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 920, height: '88%', backgroundColor: C.surface, borderRadius: 16, padding: 20, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Image source={{ uri: current.thumbnail || undefined }} style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: C.bg }} />
            <View style={{ flex: 1 }}>
              <T size={18} weight="700">Replace {obj.name.toLowerCase()}</T>
              <T size={12.5} color={C.sub}>Current: {current.name}. {imported ? 'Pick any model: it takes this one’s place and turn, at its own real size.' : 'Pick a similar real model; position, rotation and size stay the same.'}</T>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close"><Icon name="x" size={20} /></Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {SOURCES.filter((x) => x.logo).map((x) => {
                const on = x.key === source;
                return (
                  <Pressable key={x.key} onPress={() => setSource(x.key)} accessibilityLabel={x.label} {...({ title: x.label } as any)}
                    style={({ hovered }: any) => ({ width: 64, height: 38, borderRadius: 8, overflow: 'hidden', backgroundColor: x.bg, borderWidth: 2, borderColor: on ? C.blue : 'transparent', opacity: on ? 1 : hovered ? 0.85 : 0.5, boxShadow: on ? '0 0 0 3px rgba(0,106,177,.15)' : 'none' } as any)}>
                    <Image source={x.logo!} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flex: 1, minWidth: 260, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, height: 38 }}>
              <Icon name="search" size={15} color={C.muted} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search similar models…" placeholderTextColor={C.muted} style={[ui.input, { flex: 1, height: 36, borderWidth: 0, paddingHorizontal: 0 }]} />
            </View>
            {sameType > 1 && (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Toggle value={all} onChange={setAll} />
                <T size={13}>Replace all {sameType} {imported ? 'copies' : TYPE_LABEL[obj.type] || 'of this type'}</T>
              </View>
            )}
          </View>
          <ErrorNote text={error} />

          <FlatList
            data={items}
            numColumns={4}
            keyExtractor={(m) => m.externalId}
            columnWrapperStyle={{ gap: 12 }}
            contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
            onEndReached={() => { if (next && !loading) load(q.trim() || SIMILAR[obj.type] || 'furniture', next); }}
            onEndReachedThreshold={0.6}
            initialNumToRender={12}
            windowSize={5}
            removeClippedSubviews
            ListEmptyComponent={loading ? undefined : <T color={C.muted}>No models found.</T>}
            ListFooterComponent={loading ? <ActivityIndicator color={C.blue} style={{ marginVertical: 16 }} /> : undefined}
            renderItem={({ item: m }) => {
              const isCurrent = obj.asset?.externalId === m.externalId;
              return (
                <Pressable onPress={() => !busyId && pick(m)} disabled={!!busyId}
                  style={({ hovered }: any) => ({ flex: 1, maxWidth: '25%', borderRadius: 12, borderWidth: isCurrent ? 2 : 1, borderColor: isCurrent || hovered ? C.blue : C.border, overflow: 'hidden', backgroundColor: C.surface, opacity: busyId && busyId !== m.externalId ? 0.5 : 1 })}>
                  <View style={{ aspectRatio: 1, backgroundColor: C.bg }}>
                    {m.thumbnail ? <Image source={{ uri: m.thumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
                    {busyId === m.externalId && (
                      <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,.75)', alignItems: 'center', justifyContent: 'center', gap: 6 } as any}>
                        <ActivityIndicator color={C.blue} /><T size={12} weight="600">Preparing model…</T>
                      </View>
                    )}
                  </View>
                  <View style={{ padding: 10, gap: 2 }}>
                    <T size={12.5} weight="600" numberOfLines={1}>{m.name}</T>
                    <T size={11} color={C.muted} numberOfLines={1}>{m.license || label}{m.author ? ` · ${m.author}` : ''}</T>
                  </View>
                </Pressable>
              );
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={11.5} color={C.muted}>{source === 'sketchfab' ? 'Downloadable Sketchfab models (check each licence).' : `Free ${label} models (royalty-free / CC0).`} Models are optimised for the browser on first use.</T>
            <Button kind="secondary" label="Cancel" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
