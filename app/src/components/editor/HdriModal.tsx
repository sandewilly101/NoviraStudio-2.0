// Lighting environment picker: Poly Haven HDRIs (Nozila's presets first), with
// search, lazy thumbnails and infinite scroll. The chosen HDRI lights the scene
// and its reflections; "Studio light" goes back to the built-in environment.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, TextInput, View } from 'react-native';
import { Button, Chip, ErrorNote, Icon, T, Toggle, s as ui } from '@/components/ui';
import { api } from '@/lib/api';
import { C } from '@/lib/theme';
import type { Hdri } from '@/lib/types';

type Item = { slug: string; name: string; thumb: string; categories: string[]; preset: boolean };

export function HdriModal({ value, onClose, onChange }: { value: Hdri | null; onClose: () => void; onChange: (h: Hdri | null) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (query: string, cursor: string | null) => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ q: query });
      if (cursor) params.set('cursor', cursor);
      const r = await api<{ results: Item[]; next: string | null }>(`/hdris?${params}`);
      if (id !== reqId.current) return;
      setItems((prev) => [...(cursor ? prev : []), ...r.results]);
      setNext(r.next);
    } catch (e: any) { if (id === reqId.current) setError(e.message); } finally { if (id === reqId.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setItems([]); setNext(null); load(q.trim(), null); }, 300);
    return () => clearTimeout(t);
  }, [q, load]);

  const pick = async (it: Item) => {
    setBusy(it.slug); setError(null);
    try {
      const r = await api<{ url: string; thumb: string }>(`/hdris/${it.slug}`, { method: 'POST' });
      onChange({ slug: it.slug, name: it.name, thumb: r.thumb, url: r.url, background: value?.background ?? false, intensity: value?.intensity ?? 0.8, rotationDeg: value?.rotationDeg ?? 0 });
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const tweak = (p: Partial<Hdri>) => value && onChange({ ...value, ...p });

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(18,26,43,.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 980, height: '88%', backgroundColor: C.surface, borderRadius: 16, padding: 20, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 84, height: 42, borderRadius: 8, overflow: 'hidden', backgroundColor: C.blueTint, alignItems: 'center', justifyContent: 'center' }}>
              {value ? <Image source={{ uri: value.thumb }} style={{ width: '100%', height: '100%' }} /> : <Icon name="sun" size={20} color={C.blue} />}
            </View>
            <View style={{ flex: 1 }}>
              <T size={18} weight="700">Lighting environment</T>
              <T size={12.5} color={C.sub}>{value ? `Using ${value.name}` : 'Using studio light'} · HDRIs from Poly Haven (CC0). They light the scene and every reflection.</T>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close"><Icon name="x" size={20} /></Pressable>
          </View>

          {value && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
              <T size={12.5} color={C.sub}>Brightness</T>
              {([['Soft', 0.5], ['Normal', 0.8], ['Bright', 1.2]] as const).map(([l, v]) => <Chip key={l} label={l} active={(value.intensity ?? 0.8) === v} onPress={() => tweak({ intensity: v })} />)}
              <T size={12.5} color={C.sub} style={{ marginLeft: 10 }}>Turn</T>
              {[0, 90, 180, 270].map((d) => <Chip key={d} label={`${d}°`} active={(value.rotationDeg ?? 0) === d} onPress={() => tweak({ rotationDeg: d })} />)}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 10 }}>
                <Toggle value={!!value.background} onChange={(v) => tweak({ background: v })} /><T size={12.5}>Show behind the room</T>
              </View>
            </View>
          )}

          <View style={[ui.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <Icon name="search" size={16} color={C.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search HDRIs: indoor, sunset, studio, night…" placeholderTextColor={C.muted} style={{ flex: 1, outlineStyle: 'none', fontSize: 14, color: C.text } as any} />
          </View>
          {error && <ErrorNote text={error} />}

          <FlatList
            data={[null, ...items]}
            numColumns={4}
            keyExtractor={(it) => it?.slug || 'studio'}
            columnWrapperStyle={{ gap: 12 }}
            contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
            initialNumToRender={16}
            windowSize={5}
            onEndReachedThreshold={0.6}
            onEndReached={() => { if (next && !loading) load(q.trim(), next); }}
            ListFooterComponent={loading ? <ActivityIndicator color={C.blue} style={{ margin: 16 }} /> : undefined}
            renderItem={({ item: it }) => {
              const active = it ? value?.slug === it.slug : !value;
              return (
                <Pressable onPress={() => (it ? pick(it) : onChange(null))} disabled={!!busy}
                  style={({ hovered }: any) => ({ flex: 1, maxWidth: '25%', borderRadius: 12, borderWidth: active ? 2 : 1, borderColor: active || hovered ? C.blue : C.border, overflow: 'hidden', backgroundColor: C.surface })}>
                  <View style={{ aspectRatio: 2, backgroundColor: C.blueTint, alignItems: 'center', justifyContent: 'center' }}>
                    {it ? <Image source={{ uri: it.thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name="sun" size={30} color={C.blue} />}
                    {busy === it?.slug && <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,.6)', alignItems: 'center', justifyContent: 'center' } as any}><ActivityIndicator color={C.blue} /></View>}
                  </View>
                  <View style={{ padding: 10, gap: 2 }}>
                    <T size={12.5} weight="600" numberOfLines={1}>{it ? it.name : 'Studio light'}</T>
                    <T size={11} color={C.muted} numberOfLines={1}>{it ? (it.preset ? 'Recommended · ' : '') + it.categories.slice(0, 3).join(', ') : 'Built-in, no download'}</T>
                  </View>
                </Pressable>
              );
            }}
          />
          <View style={{ alignItems: 'flex-end' }}><Button kind="secondary" label="Done" onPress={onClose} /></View>
        </View>
      </View>
    </Modal>
  );
}
