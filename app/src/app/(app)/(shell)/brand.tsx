import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, TextInput, View } from 'react-native';
import { Button, Card, Empty, ErrorNote, Field, Icon, PageHeader, T, s as ui } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { pickFile } from '@/lib/pickFile';
import { C } from '@/lib/theme';
import type { BrandKit } from '@/lib/types';

type Draft = { id?: number; name: string; colors: { name: string; hex: string }[]; heading: string; body: string; logo?: File | null; logoUrl?: string | null };
const blank: Draft = { name: '', colors: [{ name: 'Accent', hex: '#C9A227' }, { name: 'Linen', hex: '#F7F3E8' }, { name: 'Stage', hex: '#1B2538' }], heading: 'Playfair Display', body: 'Inter' };

export default function Brand() {
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api<BrandKit[]>('/brand-kits').then(setKits).catch(() => setKits([])); }, []);
  useFocusEffect(load);

  const edit = (k?: BrandKit) => setDraft(k ? { id: k.id, name: k.name, colors: k.colors, heading: k.fonts.heading || '', body: k.fonts.body || '', logoUrl: k.logo_url } : { ...blank, colors: [...blank.colors] });

  const save = async () => {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('name', draft.name || 'Brand kit');
      form.append('colors', JSON.stringify(draft.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex))));
      form.append('fonts', JSON.stringify({ heading: draft.heading, body: draft.body }));
      if (draft.logo) form.append('logo', draft.logo);
      await api(`/brand-kits${draft.id ? `/${draft.id}` : ''}`, { method: draft.id ? 'PUT' : 'POST', form });
      setDraft(null); load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (id: number) => { await api(`/brand-kits/${id}`, { method: 'DELETE' }); setDraft(null); load(); };

  if (draft) return (
    <View>
      <PageHeader title={draft.id ? draft.name : 'New brand kit'} subtitle="Colours, fonts and logo the AI applies to screens, linens and signage."
        right={<><Button kind="secondary" label="Cancel" onPress={() => setDraft(null)} />{draft.id && <Button kind="danger" icon="trash-2" label="Delete" onPress={() => remove(draft.id!)} />}<Button label="Save kit" onPress={save} loading={busy} /></>} />
      <ErrorNote text={error} />
      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
        <Card style={{ flexGrow: 1, flexBasis: 360, gap: 14 }}>
          <Field label="Kit name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="e.g. Apoli Gala 2026" />
          <T size={12.5} weight="600" color={C.sub}>Logo</T>
          <Pressable onPress={async () => { const f = await pickFile('image/png,image/jpeg,image/svg+xml,image/webp'); if (f) setDraft({ ...draft, logo: f, logoUrl: URL.createObjectURL(f) }); }}
            style={{ height: 180, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#A9C7E2', backgroundColor: '#F9FBFD', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {draft.logoUrl ? <Image source={{ uri: fileUrl(draft.logoUrl) }} style={{ width: '80%', height: '80%' }} resizeMode="contain" /> : <><Icon name="upload" size={22} color={C.blue} /><T color={C.blue} weight="600">Upload SVG or PNG</T></>}
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Field label="Heading font" value={draft.heading} onChangeText={(heading) => setDraft({ ...draft, heading })} style={{ flex: 1 }} />
            <Field label="Body font" value={draft.body} onChangeText={(body) => setDraft({ ...draft, body })} style={{ flex: 1 }} />
          </View>
        </Card>
        <Card style={{ flexGrow: 1, flexBasis: 360, gap: 10 }}>
          <T size={15} weight="600">Colours</T>
          <T size={12.5} color={C.sub}>The first colour is used for accents (chairs, centrepieces), the second for linens, the third for the stage.</T>
          {draft.colors.map((c, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#fff', borderWidth: 1, borderColor: C.border }} />
              <TextInput value={c.name} onChangeText={(name) => setDraft({ ...draft, colors: draft.colors.map((x, j) => (j === i ? { ...x, name } : x)) })} style={[ui.input, { flex: 1 }]} />
              <TextInput value={c.hex} onChangeText={(hex) => setDraft({ ...draft, colors: draft.colors.map((x, j) => (j === i ? { ...x, hex } : x)) })} style={[ui.input, { width: 110 }]} />
              <Pressable onPress={() => setDraft({ ...draft, colors: draft.colors.filter((_, j) => j !== i) })}><Icon name="x" size={16} color={C.muted} /></Pressable>
            </View>
          ))}
          <Button kind="soft" icon="plus" label="Add colour" onPress={() => setDraft({ ...draft, colors: [...draft.colors, { name: 'Colour', hex: '#006AB1' }] })} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </View>
    </View>
  );

  return (
    <View>
      <PageHeader title="Brand kits" subtitle="Logos, colours and fonts per client." right={<Button icon="plus" label="New brand kit" onPress={() => edit()} />} />
      {!kits ? <ActivityIndicator color={C.blue} /> : !kits.length ? (
        <Card><Empty icon="droplet" title="No brand kits yet" text="Add a client’s logo and colours once; Novira applies them to every design." action={<Button label="New brand kit" icon="plus" onPress={() => edit()} />} /></Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
          {kits.map((k) => (
            <Pressable key={k.id} onPress={() => edit(k)} style={({ hovered }: any) => ({ width: 280, borderRadius: 12, borderWidth: 1, borderColor: hovered ? C.blue : C.border, backgroundColor: C.surface, overflow: 'hidden' })}>
              <View style={{ height: 130, backgroundColor: k.colors[2]?.hex || C.dark, alignItems: 'center', justifyContent: 'center' }}>
                {k.logo_url ? <Image source={{ uri: fileUrl(k.logo_url) }} style={{ width: '70%', height: '70%' }} resizeMode="contain" /> : <T size={22} weight="700" color={k.colors[0]?.hex || '#fff'}>{k.name}</T>}
              </View>
              <View style={{ padding: 14, gap: 8 }}>
                <T weight="600">{k.name}</T>
                <View style={{ flexDirection: 'row', gap: 6 }}>{k.colors.map((c) => <View key={c.hex + c.name} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.hex, borderWidth: 1, borderColor: C.border }} />)}</View>
                <T size={12} color={C.sub}>{[k.fonts.heading, k.fonts.body].filter(Boolean).join(' · ')}</T>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
