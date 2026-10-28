import { Slot, router, usePathname } from 'expo-router';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Logo } from '@/components/AuthLayout';
import { Avatar, Button, Icon, T, type IconName } from '@/components/ui';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';

const NAV: [IconName, string, string][] = [
  ['home', 'Home', '/'],
  ['folder', 'Projects', '/projects'],
  ['map-pin', 'Venues', '/venues'],
  ['image', 'Renders', '/renders'],
  ['droplet', 'Brand kits', '/brand'],
];

export default function ShellLayout() {
  const path = usePathname();
  const { user, signOut } = useSession();
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
      <View style={{ width: compact ? 68 : 232, backgroundColor: C.surface, borderRightWidth: 1, borderRightColor: C.border, paddingVertical: 18, paddingHorizontal: 12 }}>
        <View style={{ paddingHorizontal: 6, marginBottom: 20 }}><Logo iconOnly={compact} /></View>
        <Button label={compact ? undefined : 'New mockup'} icon="plus" onPress={() => router.push('/new')} />
        {!compact && <T size={10.5} weight="600" color={C.muted} style={{ marginTop: 22, marginBottom: 8, marginLeft: 12, letterSpacing: 1 }}>WORKSPACE</T>}
        <View style={{ gap: 4, marginTop: compact ? 18 : 0 }}>
          {NAV.map(([icon, label, href]) => <NavItem key={href} icon={icon} label={label} on={active(href)} compact={compact} onPress={() => router.push(href as any)} />)}
        </View>
        <View style={{ height: 1, backgroundColor: C.border, marginVertical: 14, marginHorizontal: 8 }} />
        <NavItem icon="settings" label="Settings" on={active('/settings')} compact={compact} onPress={() => router.push('/settings')} />
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }}>
          <Avatar name={user?.name || '?'} />
          {!compact && <View style={{ flex: 1 }}><T size={13} weight="600" numberOfLines={1}>{user?.name}</T><T size={11.5} color={C.sub} numberOfLines={1}>{user?.email}</T></View>}
          {!compact && <Pressable onPress={signOut} accessibilityLabel="Sign out"><Icon name="log-out" size={16} color={C.muted} /></Pressable>}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 28, paddingBottom: 60 }}>
        <View style={{ width: '100%', maxWidth: 1240, alignSelf: 'center' }}><Slot /></View>
      </ScrollView>
    </View>
  );
}

function NavItem({ icon, label, on, compact, onPress }: { icon: IconName; label: string; on: boolean; compact: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ hovered }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 38, paddingHorizontal: compact ? 0 : 14, justifyContent: compact ? 'center' : 'flex-start', borderRadius: 8, backgroundColor: on ? C.blueTint : hovered ? C.bg : 'transparent' })}>
      <Icon name={icon} size={18} color={on ? C.blue : C.sub} />
      {!compact && <T size={13.5} weight={on ? '600' : '400'} color={on ? C.blue : C.text}>{label}</T>}
    </Pressable>
  );
}
