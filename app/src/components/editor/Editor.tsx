import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Empty } from '@/components/ui';

// The 3D editor runs in the browser (laptop). Phone and tablet builds show
// this until the native renderer (expo-gl) is added.
export default function Editor(_props: { projectId: string }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Empty icon="monitor" title="Open the editor on a laptop" text="The 3D editor runs in the web app. Open Novira Studio in a browser to edit this design."
        action={<Button kind="secondary" label="Back" onPress={() => router.back()} />} />
    </View>
  );
}
