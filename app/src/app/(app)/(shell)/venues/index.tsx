import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Badge, Button, Card, ErrorNote, Icon, PageHeader, T, type IconName } from '@/components/ui';
import { api, formatBytes, upload } from '@/lib/api';
import { pickFile } from '@/lib/pickFile';
import { C } from '@/lib/theme';
import type { Venue } from '@/lib/types';

export default function Venues() {
  const [rows, setRows] = useState<Venue[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api<Venue[]>('/venues').then(setRows).catch((e) => setError(e.message)); }, []);
  useFocusEffect(load);

  const add = async () => {
    const file = await pickFile('.glb,.gltf');
    if (!file) return;
    setError(null); setProgress(0);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', file.name.replace(/\.[^.]+$/, ''));
      const v = await upload<Venue>('/venues', form, setProgress);
      router.push(`/venues/${v.id}`); // opens it, which runs the 3D analysis
    } catch (e: any) { setError(e.message); } finally { setProgress(null); }
  };

  return (
    <View>
      <PageHeader title="Venues" subtitle="Reusable 3D spaces. Upload once, design many events." right={<Button icon="upload" label="Upload venue" onPress={add} loading={progress != null} />} />
      <ErrorNote text={error} />
      {progress != null && (
        <Card style={{ marginBottom: 16, gap: 8 }}>
          <T weight="600">Uploading venue… {progress}%</T>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: C.border }}><View style={{ width: `${progress}%`, height: 6, borderRadius: 3, backgroundColor: C.blue }} /></View>
        </Card>
      )}
      {!rows ? <ActivityIndicator color={C.blue} /> : (
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          {rows.map((v) => {
            const a = v.analysis;
            return (
              <Pressable key={v.id} onPress={() => router.push(`/venues/${v.id}`)} style={({ hovered }: any) => ({ width: 276, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: hovered ? C.blue : C.border, overflow: 'hidden' })}>
                <View style={{ height: 150, backgroundColor: '#E9EEF4', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="map-pin" size={30} color="#9CB6CF" />
                  <View style={{ position: 'absolute', top: 10, left: 10 }}>{a ? <Badge label="Ready" kind="green" /> : <Badge label="Needs analysis" kind="amber" />}</View>
                </View>
                <View style={{ padding: 14, gap: 6 }}>
                  <T size={14} weight="600" numberOfLines={1}>{v.name}</T>
                  <T size={11.5} color={C.sub} numberOfLines={1}>{v.file_name} · {formatBytes(v.file_size)}</T>
                  <Line icon="maximize" text={a ? `${a.size[0]} × ${a.size[2]} m · ${a.size[1]} m high` : 'Open to measure the room'} />
                  <Line icon="folder" text={`${v.project_count || 0} projects`} />
                  <T size={12.5} color={C.blue} weight="600" style={{ marginTop: 4 }}>{a ? 'Use in new mockup →' : 'Analyse venue →'}</T>
                </View>
              </Pressable>
            );
          })}
          <Pressable onPress={add} style={{ width: 276, minHeight: 300, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#A9C7E2', backgroundColor: '#F9FBFD', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.blueTint, alignItems: 'center', justifyContent: 'center' }}><Icon name="upload" size={22} color={C.blue} /></View>
            <T weight="600">Upload a venue file</T>
            <T size={12} color={C.sub} style={{ textAlign: 'center' }}>.glb or .gltf, up to 600 MB</T>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Line({ icon, text }: { icon: IconName; text: string }) {
  return <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name={icon} size={13} color={C.muted} /><T size={12.5}>{text}</T></View>;
}
