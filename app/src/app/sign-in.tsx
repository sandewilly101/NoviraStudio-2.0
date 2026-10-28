import { Link } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, ErrorNote, Field, T } from '@/components/ui';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await signIn(email, password); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <View style={{ gap: 6 }}>
        <T size={28} weight="700">Welcome back</T>
        <T color={C.sub}>Sign in to continue to your projects.</T>
      </View>
      <ErrorNote text={error} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@company.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Your password" onSubmitEditing={submit} />
      <Button label="Sign in" onPress={submit} loading={busy} style={{ height: 44 }} />
      <T color={C.sub} style={{ textAlign: 'center' }}>
        New to Novira Studio? <Link href="/register" style={{ color: C.blue, fontWeight: '600' }}>Create an account</Link>
      </T>
    </AuthLayout>
  );
}
