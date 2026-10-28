import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, TextInput, View } from 'react-native';
import { ProjectCard } from '@/components/ProjectCard';
import { Button, Card, Chip, Empty, Icon, PageHeader, T, s as ui, statusBadge } from '@/components/ui';
import { api, fileUrl, timeAgo } from '@/lib/api';
import { C } from '@/lib/theme';
import type { Project } from '@/lib/types';

export default function Projects() {
  const [rows, setRows] = useState<Project[] | null>(null);
  const [filter, setFilter] = useState<'all' | Project['status']>('all');
  const [q, setQ] = useState('');
  const [grid, setGrid] = useState(false);

  const load = useCallback(() => { api<Project[]>('/projects').then(setRows).catch(() => setRows([])); }, []);
  useFocusEffect(load);

  const list = useMemo(() => (rows || []).filter((p) => (filter === 'all' || p.status === filter) && (!q || `${p.name} ${p.venue_name}`.toLowerCase().includes(q.toLowerCase()))), [rows, filter, q]);
  const count = (st: Project['status']) => (rows || []).filter((p) => p.status === st).length;

  const remove = async (p: Project) => {
    if (!window.confirm?.(`Delete “${p.name}”? This removes all its versions and renders.`)) return;
    await api(`/projects/${p.id}`, { method: 'DELETE' }); load();
  };

  return (
    <View>
      <PageHeader title="Projects" subtitle="Every event mockup, with its venue, status and versions." right={<Button icon="plus" label="New mockup" onPress={() => router.push('/new')} />} />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <Chip label={`All ${rows?.length ?? ''}`} active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label={`Drafts ${count('draft')}`} active={filter === 'draft'} onPress={() => setFilter('draft')} />
        <Chip label={`In review ${count('in_review')}`} active={filter === 'in_review'} onPress={() => setFilter('in_review')} />
        <Chip label={`Approved ${count('approved')}`} active={filter === 'approved'} onPress={() => setFilter('approved')} />
        <View style={{ flex: 1 }} />
        <TextInput value={q} onChangeText={setQ} placeholder="Filter by name or venue" placeholderTextColor={C.muted} style={[ui.input, { width: 260, height: 36 }]} />
        <Button kind={grid ? 'soft' : 'secondary'} icon="grid" onPress={() => setGrid(true)} />
        <Button kind={!grid ? 'soft' : 'secondary'} icon="list" onPress={() => setGrid(false)} />
      </View>
      {!rows ? <ActivityIndicator color={C.blue} /> : !list.length ? (
        <Card><Empty icon="folder" title={rows.length ? 'No projects match' : 'No projects yet'} text={rows.length ? 'Try another filter.' : 'Create your first mockup from a short event brief.'} action={!rows.length ? <Button label="New mockup" icon="plus" onPress={() => router.push('/new')} /> : undefined} /></Card>
      ) : grid ? (
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>{list.map((p) => <ProjectCard key={p.id} p={p} />)}</View>
      ) : (
        <Card pad={0}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, height: 42, alignItems: 'center', backgroundColor: C.panel, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
            {[['Project', 3], ['Venue', 2], ['Last edited', 1.2], ['Status', 1.2], ['Renders', 0.8], ['', 0.5]].map(([h, f]) => <T key={String(h)} size={12} weight="600" color={C.sub} style={{ flex: Number(f) }}>{h}</T>)}
          </View>
          {list.map((p, i) => (
            <Pressable key={p.id} onPress={() => router.push(`/editor/${p.id}`)} style={({ hovered }: any) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.border, backgroundColor: hovered ? '#F7FAFD' : 'transparent' })}>
              <View style={{ flex: 3, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <View style={{ width: 88, height: 56, borderRadius: 6, backgroundColor: '#E9EEF4', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                  {p.thumbnail_url ? <Image source={{ uri: fileUrl(p.thumbnail_url) }} style={{ width: '100%', height: '100%' }} /> : <Icon name="box" color="#B5C3D3" />}
                </View>
                <View style={{ flexShrink: 1 }}><T weight="600" numberOfLines={1}>{p.name}</T><T size={12} color={C.sub}>{p.event_type} · {p.guests} guests{p.version ? ` · v${p.version}` : ''}</T></View>
              </View>
              <T size={13} style={{ flex: 2 }} numberOfLines={1}>{p.venue_name || '—'}</T>
              <T size={13} color={C.sub} style={{ flex: 1.2 }}>{timeAgo(p.updated_at)}</T>
              <View style={{ flex: 1.2 }}>{statusBadge(p.status)}</View>
              <T size={13} style={{ flex: 0.8 }}>{p.render_count ?? 0}</T>
              <Pressable onPress={(e) => { e.stopPropagation?.(); remove(p); }} style={{ flex: 0.5, alignItems: 'flex-end' }} accessibilityLabel="Delete project"><Icon name="trash-2" size={15} color={C.muted} /></Pressable>
            </Pressable>
          ))}
        </Card>
      )}
    </View>
  );
}
