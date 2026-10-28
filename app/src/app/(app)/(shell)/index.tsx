import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { ProjectCard } from '@/components/ProjectCard';
import { Button, Card, Empty, Icon, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';
import type { Project, Render, Venue } from '@/lib/types';

const IDEAS = ['Corporate gala for 120 guests, round tables of 8, gold and white, dance floor', 'Wedding reception for 180, long feast tables, blush and ivory', 'Tech conference for 300, theatre seating, big LED wall', 'Cocktail launch party for 150, lounge sofas and a long bar'];

export default function Home() {
  const { user } = useSession();
  const [brief, setBrief] = useState('');
  const [data, setData] = useState<{ projects: Project[]; venues: Venue[]; renders: Render[] } | null>(null);

  useFocusEffect(useCallback(() => {
    Promise.all([api<Project[]>('/projects'), api<Venue[]>('/venues'), api<Render[]>('/renders')])
      .then(([projects, venues, renders]) => setData({ projects, venues, renders })).catch(() => setData({ projects: [], venues: [], renders: [] }));
  }, []));

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const start = (b = brief) => router.push({ pathname: '/new', params: { brief: b } });
  const month = new Date().getMonth();

  return (
    <View style={{ gap: 22 }}>
      <View style={{ gap: 4 }}>
        <T size={26} weight="700">{greet}, {user?.name?.split(' ')[0]}</T>
        <T color={C.sub}>Here’s what’s happening across your events.</T>
      </View>

      <View style={{ backgroundColor: C.blue, borderRadius: 16, padding: 24, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Icon name="zap" size={20} color="#fff" /><T size={18} weight="600" color="#fff">Describe your next event</T></View>
        <T color="#DCEBF7">AI plans the layout, furniture and lighting in your venue. You get 3 designs to choose from.</T>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput value={brief} onChangeText={setBrief} onSubmitEditing={() => start()} placeholder="e.g. Corporate gala for 120 guests, round tables, gold and white, logo on the LED wall…" placeholderTextColor={C.muted}
            style={{ flex: 1, height: 48, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 16, fontSize: 14, color: C.text, outlineWidth: 0 } as any} />
          <Button kind="dark" icon="zap" label="Generate" onPress={() => start()} style={{ height: 48 }} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {IDEAS.map((i) => (
            <Pressable key={i} onPress={() => start(i)} style={{ borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,.35)', paddingHorizontal: 12, height: 28, justifyContent: 'center' }}>
              <T size={12} color="#fff" numberOfLines={1}>{i.split(',')[0]}</T>
            </Pressable>
          ))}
        </View>
      </View>

      {!data ? <ActivityIndicator color={C.blue} /> : (
        <>
          <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
            <Stat label="Active projects" value={data.projects.filter((p) => p.status !== 'approved').length} sub={`${data.projects.length} in total`} />
            <Stat label="Renders this month" value={data.renders.filter((r) => new Date(r.created_at).getMonth() === month).length} sub={`${data.renders.length} in total`} />
            <Stat label="Awaiting approval" value={data.projects.filter((p) => p.status === 'in_review').length} sub="Shared with clients" amber />
            <Stat label="Venues" value={data.venues.length} sub={`${data.venues.filter((v) => !v.analysis).length} need analysis`} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={16} weight="600">Recent projects</T>
            {data.projects.length > 4 && <Pressable onPress={() => router.push('/projects')}><T size={13} color={C.blue} weight="600">View all</T></Pressable>}
          </View>
          {data.projects.length ? (
            <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>{data.projects.slice(0, 4).map((p) => <ProjectCard key={p.id} p={p} />)}</View>
          ) : (
            <Card><Empty icon="box" title="No projects yet" text={data.venues.length ? 'Describe an event above to create your first 3D mockup.' : 'Start by uploading your venue model (.glb), then describe an event.'}
              action={!data.venues.length ? <Button label="Upload a venue" icon="upload" onPress={() => router.push('/venues')} /> : undefined} /></Card>
          )}
        </>
      )}
    </View>
  );
}

function Stat({ label, value, sub, amber }: { label: string; value: number; sub: string; amber?: boolean }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 220 }} pad={18}>
      <T size={12.5} color={C.sub}>{label}</T>
      <T size={28} weight="700" style={{ marginVertical: 2 }}>{value}</T>
      <T size={12} color={amber ? C.amber : C.green}>{sub}</T>
    </Card>
  );
}
