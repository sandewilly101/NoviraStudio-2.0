import '@/lib/quietConsole'; // before anything 3D loads
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator() {
  const { user, loading } = useSession();
  useEffect(() => { if (!loading) SplashScreen.hideAsync(); }, [loading]);
  if (loading) return null;
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="register" />
      </Stack.Protected>
      <Stack.Screen name="share/[token]" />
    </Stack>
  );
}
