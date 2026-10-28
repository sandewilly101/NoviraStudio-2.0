import { Link } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, ErrorNote, Field, T } from '@/components/ui';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';

export default function Register() {
  const { register } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await register(name, email, password); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <View style={{ gap: 6 }}>
        <T size={28} weight="700">Create your account</T>
        <T color={C.sub}>Start designing event venues with AI.</T>
      </View>
      <ErrorNote text={error} />
      <Field label="Full name" value={name} onChangeText={setName} placeholder="Your name" />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@company.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 8 characters" onSubmitEditing={submit} />
      <Button label="Create account" onPress={submit} loading={busy} style={{ height: 44 }} />
      <T color={C.sub} style={{ textAlign: 'center' }}>
        Already have an account? <Link href="/sign-in" style={{ color: C.blue, fontWeight: '600' }}>Sign in</Link>
      </T>
    </AuthLayout>
  );
}
