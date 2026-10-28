import type { ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { C } from '@/lib/theme';
import { Icon, T } from './ui';

// Split layout for sign-in / register: brand panel left, form right.
export function AuthLayout({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.surface }}>
      {wide && (
        <View style={{ width: '46%', backgroundColor: C.blue, padding: 48, justifyContent: 'space-between' }}>
          <Logo light />
          <View style={{ gap: 14 }}>
            <T size={34} weight="700" color="#fff" style={{ lineHeight: 42 }}>Design any event venue in minutes, with AI.</T>
            <T size={16} color="#DCEBF7" style={{ lineHeight: 24 }}>Upload your venue, describe the event, and get 3D mockups your clients can review and approve.</T>
          </View>
          <View style={{ flexDirection: 'row', gap: 22 }}>
            {[['zap', 'AI layouts'], ['box', '3D editor'], ['camera', 'Photoreal previews']].map(([i, t]) => (
              <View key={t} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name={i as any} size={16} color="#fff" /><T color="#fff" size={13}>{t}</T></View>
            ))}
          </View>
        </View>
      )}
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <View style={{ width: '100%', maxWidth: 420, gap: 18 }}>
          {!wide && <Logo />}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

export function Logo({ light, size = 18, iconOnly }: { light?: boolean; size?: number; iconOnly?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: light ? '#fff' : C.blue, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="box" size={17} color={light ? C.blue : '#fff'} />
      </View>
      {!iconOnly && <T size={size} weight="700" color={light ? '#fff' : C.text}>Novira Studio</T>}
    </View>
  );
}
