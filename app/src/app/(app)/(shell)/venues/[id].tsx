import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
import ScenePreview from '@/components/three/ScenePreview';
import { needsAnalysis } from '@/components/three/venue';
import { Badge, Button, Card, ErrorNote, Icon, PageHeader, T, s as ui } from '@/components/ui';
import { api, formatBytes } from '@/lib/api';
import { C } from '@/lib/theme';
import type { Venue, VenueAnalysis } from '@/lib/types';

export default function VenueDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [v, setV] = useState<Venue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [floor, setFloor] = useState<VenueAnalysis['floor'] | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [seed, setSeed] = useState<{ x: number; z: number } | null>(null);

  useEffect(() => { api<Venue>(`/venues/${id}`).then((x) => { setV(x); setFloor(x.analysis?.floor || null); }).catch((e) => setError(e.message)); }, [id]);

  const saveAnalysis = async (a: VenueAnalysis) => {
    const x = await api<Venue>(`/venues/${id}/analysis`, { method: 'PUT', body: a });
    setV(x); setFloor(x.analysis?.floor || null);
  };
  const saveFloor = async () => {
    if (!v?.analysis || !floor) return;
    setSaving(true);
    try { await saveAnalysis({ ...v.analysis, floor }); } finally { setSaving(false); }
  };

  if (error) return <ErrorNote text={error} />;
  if (!v) return <ActivityIndicator color={C.blue} />;
  const a = v.analysis;
  const area = a ? Math.round((a.floor.maxX - a.floor.minX) * (a.floor.maxZ - a.floor.minZ)) : 0;

  return (
    <View>
      <PageHeader title={v.name} subtitle={`${v.file_name} · ${formatBytes(v.file_size)}`}
        right={<>
          <Button kind="secondary" icon="chevron-left" label="Venues" onPress={() => router.push('/venues')} />
          <Button icon="plus" label="New mockup here" disabled={!a} onPress={() => router.push({ pathname: '/new', params: { venueId: String(v.id) } })} />
        </>} />
      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
        <Card pad={0} style={{ flexGrow: 2, flexBasis: 560, height: 560, overflow: 'hidden' }}>
          <ScenePreview scene={null} venue={v} cutaway showRoom={!!a} roomSeed={seed}
            onPick={picking ? (p) => { setPicking(false); setSeed({ x: p[0], z: p[2] }); } : undefined}
            onVenueAnalysed={saveAnalysis} />
          {!needsAnalysis(a) && (
            <View style={{ position: 'absolute', top: 14, left: 14, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Button small kind={picking ? 'primary' : 'secondary'} icon="crosshair" label={picking ? 'Now click inside the event room…' : 'Pick the event room'} onPress={() => setPicking((x) => !x)} />
              <View style={{ backgroundColor: 'rgba(255,255,255,.92)', paddingHorizontal: 10, height: 30, borderRadius: 8, justifyContent: 'center' }}>
                <T size={12} color={C.sub}>Blue = the room the AI fills{a?.roomDetected ? '' : ' (whole building)'}</T>
              </View>
            </View>
          )}
          {needsAnalysis(a) && <View style={{ position: 'absolute', top: 14, left: 14, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 12, height: 34, borderRadius: 8 }}><ActivityIndicator size="small" color={C.blue} /><T size={12.5}>Loading and measuring the venue…</T></View>}
        </Card>
        <Card style={{ flexGrow: 1, flexBasis: 300, gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <T size={16} weight="600">Auto-analysis</T>
            {a ? <Badge label="Complete" kind="green" /> : <Badge label="Running" kind="amber" />}
          </View>
          {a ? (
            <>
              {[
                ['Room size', `${a.size[0]} × ${a.size[2]} m`], ['Floor area', `${area} m²`], ['Height', `${a.size[1]} m`],
                ['Units', a.scale === 1 ? 'metres' : a.scale === 0.01 ? 'centimetres → metres' : a.scale === 0.001 ? 'millimetres → metres' : `scaled ×${a.scale}`],
                ['Meshes', a.meshes.toLocaleString()], ['Triangles', a.triangles.toLocaleString()],
              ].map(([k, val]) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border }}>
                  <Icon name="check-circle" size={15} color={C.green} /><T size={13} style={{ flex: 1 }}>{k}</T><T size={13} weight="600">{val}</T>
                </View>
              ))}
              {a.triangles > 2_000_000 && <View style={{ flexDirection: 'row', gap: 8, backgroundColor: C.amberTint, padding: 10, borderRadius: 8, marginTop: 10 }}><Icon name="alert-triangle" size={15} color={C.amber} /><T size={12} color="#6B4300" style={{ flex: 1 }}>This model is very detailed. It may feel slow on older laptops; a simplified version (e.g. gltf-transform) will help.</T></View>}
              <T size={13} weight="600" style={{ marginTop: 16 }}>Usable floor (metres)</T>
              <T size={12} color={C.sub}>The AI places furniture inside this rectangle. Narrow it if the model includes outdoor areas or thick walls.</T>
              {floor && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {(['minX', 'maxX', 'minZ', 'maxZ'] as const).map((k) => (
                    <View key={k} style={{ width: '47%', gap: 4 }}>
                      <T size={11.5} color={C.muted}>{{ minX: 'Left', maxX: 'Right', minZ: 'Stage wall', maxZ: 'Back wall' }[k]}</T>
                      <TextInput value={String(floor[k])} onChangeText={(t) => setFloor({ ...floor, [k]: Number(t) || 0 })} keyboardType="numeric" style={[ui.input, { height: 34 }]} />
                    </View>
                  ))}
                </View>
              )}
              <Button kind="secondary" label="Save floor area" onPress={saveFloor} loading={saving} style={{ marginTop: 10 }} />
            </>
          ) : <T color={C.sub}>The venue is loading in the 3D view. Large files can take a minute; measurements appear here automatically.</T>}
        </Card>
      </View>
    </View>
  );
}
