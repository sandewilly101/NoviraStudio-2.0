// Native placeholder until the expo-gl renderer is added; 3D runs on web.
import { View } from 'react-native';
import { Icon, T } from '@/components/ui';
import { C } from '@/lib/theme';
import type { SceneViewProps } from './SceneView';

export type { SceneViewProps };
export default function ScenePreview(_props: SceneViewProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 8 }}>
      <Icon name="monitor" size={22} color={C.muted} />
      <T size={12.5} color={C.sub}>3D preview available on the web app</T>
    </View>
  );
}
