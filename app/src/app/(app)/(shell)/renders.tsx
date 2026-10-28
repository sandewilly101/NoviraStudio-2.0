import { router, useFocusEffect } from 'expo-router';
import { createElement, useCallback, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, View } from 'react-native';
import PanoramaViewer from '@/components/three/PanoramaViewer';
import { Badge, Button, Card, Chip, Empty, Icon, PageHeader, T } from '@/components/ui';
import { api, fileUrl, timeAgo } from '@/lib/api';
import { C } from '@/lib/theme';
import type { Render } from '@/lib/types';

const KIND: Record<Render['kind'], [string, 'blue' | 'green' | 'amber' | 'gray' | 'dark']> = {
  enhanced: ['Photoreal (AI)', 'blue'], image: ['Snapshot', 'gray'], panorama: ['360°', 'green'], video: ['Video', 'dark'], floorplan: ['Floor plan', 'amber'],
};

export default function Renders() {
  const [rows, setRows] = useState<Render[] | null>(null);
  const [kind, setKind] = useState<'all' | Render['kind']>('all');
  const [open, setOpen] = useState<Render | null>(null);
  const load = useCallback(() => { api<Render[]>('/renders').then(setRows).catch(() => setRows([])); }, []);
  useFocusEffect(load);
  const list = (rows || []).filter((r) => kind === 'all' || r.kind === kind);

  const remove = async (r: Render) => { await api(`/renders/${r.id}`, { method: 'DELETE' }); setOpen(null); load(); };

  return (
    <View>
      <PageHeader title="Renders" subtitle="Snapshots, AI photoreal previews, 360° panoramas, walkthrough videos and floor plans." />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Chip label="All" active={kind === 'all'} onPress={() => setKind('all')} />
        {(Object.keys(KIND) as Render['kind'][]).map((k) => <Chip key={k} label={KIND[k][0]} active={kind === k} onPress={() => setKind(k)} />)}
      </View>
      {!rows ? <ActivityIndicator color={C.blue} /> : !list.length ? (
        <Card><Empty icon="image" title="No renders yet" text="Open a project and use Render in the editor to create images, 360° views and videos." action={<Button kind="secondary" label="Go to projects" onPress={() => router.push('/projects')} />} /></Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {list.map((r) => (
            <Pressable key={r.id} onPress={() => setOpen(r)} style={({ hovered }: any) => ({ width: 280, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: hovered ? C.blue : C.border, backgroundColor: C.surface })}>
              <View style={{ height: 170, backgroundColor: '#0E1525', alignItems: 'center', justifyContent: 'center' }}>
                {r.kind === 'video' ? <Icon name="play-circle" size={40} color="#fff" /> : <Image source={{ uri: fileUrl(r.file_url) }} style={{ width: '100%', height: '100%' }} resizeMode={r.kind === 'floorplan' ? 'contain' : 'cover'} />}
                <View style={{ position: 'absolute', top: 10, left: 10 }}><Badge label={KIND[r.kind][0]} kind={KIND[r.kind][1]} /></View>
              </View>
              <View style={{ padding: 12 }}><T size={13} weight="600" numberOfLines={1}>{r.project_name}</T><T size={11.5} color={C.muted}>{timeAgo(r.created_at)}</T></View>
            </Pressable>
          ))}
        </View>
      )}
      <Modal transparent visible={!!open} animationType="fade" onRequestClose={() => setOpen(null)}>
        {open && (
          <View style={{ flex: 1, backgroundColor: 'rgba(18,26,43,.6)', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
            <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 1100, gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><T size={17} weight="700">{open.project_name}</T><Badge label={KIND[open.kind][0]} kind={KIND[open.kind][1]} /></View>
                <Pressable onPress={() => setOpen(null)}><Icon name="x" size={20} /></Pressable>
              </View>
              <View style={{ height: 560, backgroundColor: '#0E1525', borderRadius: 10, overflow: 'hidden' }}>
                {open.kind === 'video' && Platform.OS === 'web'
                  ? createElement('video', { src: fileUrl(open.file_url), controls: true, autoPlay: true, style: { width: '100%', height: '100%', objectFit: 'contain' } })
                  : open.kind === 'panorama' ? <PanoramaViewer url={fileUrl(open.file_url)} />
                  : <Image source={{ uri: fileUrl(open.file_url) }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />}
              </View>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
                <Button kind="danger" icon="trash-2" label="Delete" onPress={() => remove(open)} />
                <Button kind="secondary" label="Open project" onPress={() => { setOpen(null); router.push(`/editor/${open.project_id}`); }} />
                <Button icon="download" label="Download" onPress={() => window.open(fileUrl(open.file_url), '_blank')} />
              </View>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}
