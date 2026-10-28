import { router } from 'expo-router';
import { Image, Pressable, View } from 'react-native';
import { fileUrl, timeAgo } from '@/lib/api';
import { C } from '@/lib/theme';
import type { Project } from '@/lib/types';
import { Icon, T, statusBadge } from './ui';

export function ProjectCard({ p, width = 276 }: { p: Project; width?: number | `${number}%` }) {
  return (
    <Pressable onPress={() => router.push(`/editor/${p.id}`)} style={({ hovered }: any) => ({ width, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: hovered ? C.blue : C.border, overflow: 'hidden' })}>
      <View style={{ height: 160, backgroundColor: '#E9EEF4' }}>
        {p.thumbnail_url ? <Image source={{ uri: fileUrl(p.thumbnail_url) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Icon name="box" size={28} color="#B5C3D3" /></View>}
        <View style={{ position: 'absolute', top: 10, left: 10 }}>{statusBadge(p.status)}</View>
      </View>
      <View style={{ padding: 14, gap: 3 }}>
        <T size={14} weight="600" numberOfLines={1}>{p.name}</T>
        <T size={12} color={C.sub} numberOfLines={1}>{p.venue_name || 'No venue'} · {p.guests} guests</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <Icon name="clock" size={12} color={C.muted} />
          <T size={11.5} color={C.muted}>{timeAgo(p.updated_at)}</T>
          <View style={{ flex: 1 }} />
          {p.version ? <T size={11.5} color={C.muted}>v{p.version}</T> : null}
        </View>
      </View>
    </Pressable>
  );
}
