import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Badge, Button, Card, Icon, PageHeader, T, type IconName } from '@/components/ui';
import { API_URL, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';
import { UsagePanel } from '@/components/UsagePanel';

type Health = { ok: boolean; ai: string; images: string | null; sketchfabImport: boolean };

export default function Settings() {
  const { user, signOut } = useSession();
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api<Health>('/health').then(setH).catch(() => setErr(true)); }, []);

  const items: [IconName, string, string, boolean, string, string][] = h ? [
    ['zap', 'AI layout planner', 'Plans layouts from briefs and applies chat edits.', h.ai !== 'rules', h.ai !== 'rules' ? `Connected · ${h.ai}` : 'Using built-in rules', 'OPENAI_API_KEY'],
    ['image', 'AI images', 'Concepts rendered from the 3D, photoreal previews, and graphics for screens, banners and backdrops.', !!h.images, h.images ? `Connected · ${h.images}` : 'Not connected', 'OPENAI_API_KEY'],
    ['box', 'Sketchfab', 'Search works without a key; importing models needs an API token.', h.sketchfabImport, h.sketchfabImport ? 'Connected' : 'Search only', 'SKETCHFAB_API_TOKEN'],
    ['package', 'BlenderKit', 'Free royalty-free and CC0 models, downloaded as GLB. No key needed.', true, 'Connected', ''],
    ['package', 'Poly Haven', 'Free CC0 models, imported with their textures. No key needed.', true, 'Connected', ''],
    ['cpu', 'In-browser rendering', 'Snapshots, 360° panoramas, walkthrough videos and floor plans are rendered on this laptop.', true, 'Built in', ''],
  ] : [];

  return (
    <View>
      <PageHeader title="Settings" subtitle="Account and integrations." />
      <View style={{ gap: 16 }}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ flex: 1 }}><T size={16} weight="600">{user?.name}</T><T color={C.sub}>{user?.email}</T></View>
          <Button kind="secondary" icon="log-out" label="Sign out" onPress={signOut} />
        </Card>
        <UsagePanel />
        <T size={17} weight="600" style={{ marginTop: 8 }}>Integrations</T>
        <T color={C.sub}>Keys live in <T weight="600">server/.env</T> on the server and are never sent to the browser. Restart the server after changing them.</T>
        {err ? <Card><T color={C.red}>Can’t reach the server at {API_URL}.</T></Card> : !h ? <ActivityIndicator color={C.blue} /> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {items.map(([icon, title, text, on, status, env]) => (
              <Card key={title} style={{ flexGrow: 1, flexBasis: 420, flexDirection: 'row', gap: 16 }}>
                <View style={{ width: 46, height: 46, borderRadius: 10, backgroundColor: on ? C.blue : C.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={22} color={on ? '#fff' : C.sub} /></View>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><T size={15} weight="600">{title}</T><Badge label={status} kind={on ? 'green' : 'gray'} /></View>
                  <T size={13} color={C.sub}>{text}</T>
                  {!on && env ? <T size={12} color={C.muted}>Set <T size={12} weight="600" color={C.text}>{env}</T> in server/.env</T> : null}
                </View>
              </Card>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
