// Public client review page: no login. View the design in 3D, pin comments, approve.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { Logo } from '@/components/AuthLayout';
import ScenePreview from '@/components/three/ScenePreview';
import { Avatar, Badge, Button, ErrorNote, Field, Icon, T, s as ui } from '@/components/ui';
import { api, timeAgo } from '@/lib/api';
import { C } from '@/lib/theme';
import type { Comment, Scene, Venue } from '@/lib/types';

type Data = { project: { id: number; name: string; status: string; guests: number }; owner: string; venue: Venue | null; version: number; scene: Scene | null; comments: Comment[]; approval: { approver_name: string; created_at: string } | null };

export default function SharePage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [pin, setPin] = useState<[number, number, number] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Data>(`/share/${token}`).then((x) => setD(x)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [token]);

  const comment = async () => {
    if (!name.trim() || !body.trim()) { setError('Add your name and a comment.'); return; }
    setBusy(true); setError(null);
    try { await api(`/share/${token}/comments`, { body: { name, body, position: pin } }); setBody(''); setPin(null); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!name.trim()) { setError('Add your name before approving.'); return; }
    setBusy(true); setError(null);
    try { await api(`/share/${token}/approve`, { body: { name } }); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (error && !d) return <View style={{ flex: 1, padding: 40, gap: 16 }}><Logo /><ErrorNote text={error} /></View>;
  if (!d) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.blue} /></View>;
  const pins = d.comments.filter((c) => c.position).map((c, i) => ({ id: i + 1, position: c.position!, label: c.body }));
  if (pin) pins.push({ id: pins.length + 1, position: pin, label: 'New comment' });
  const approved = d.project.status === 'approved' && d.approval;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Logo iconOnly />
        <View style={{ flex: 1 }}>
          <T size={15} weight="600">{d.project.name} · Design v{d.version}</T>
          <T size={12} color={C.muted}>Shared by {d.owner} for review</T>
        </View>
        {approved ? <Badge label={`Approved by ${d.approval!.approver_name}`} kind="green" /> : <Badge label="Awaiting your approval" kind="amber" />}
        {!approved && <Button icon="check" label="Approve design" onPress={approve} loading={busy} />}
      </View>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: 1 }}>
          <ScenePreview scene={d.scene} venue={d.venue} pins={pins} onPick={(p) => setPin(p)} />
          <View style={{ position: 'absolute', top: 16, left: 16, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.surface, borderRadius: 8, paddingHorizontal: 12, height: 36 }}>
            <Icon name="message-square" size={15} color={C.blue} />
            <T size={12.5}>{pin ? 'Pin placed — write your comment on the right' : 'Click anywhere in the room to pin a comment'}</T>
          </View>
        </View>
        <View style={{ width: 380, backgroundColor: C.surface, borderLeftWidth: 1, borderLeftColor: C.border, padding: 18, gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={16} weight="600">Comments</T>
            <Badge label={`${d.comments.filter((c) => !c.resolved).length} open`} kind="amber" />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14 }}>
            {!d.comments.length && <T color={C.muted}>No comments yet.</T>}
            {d.comments.map((c, i) => (
              <View key={c.id} style={{ flexDirection: 'row', gap: 10, opacity: c.resolved ? 0.5 : 1 }}>
                {c.position ? <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' }}><T size={11} weight="700" color="#fff">{pins.findIndex((p) => p.label === c.body) + 1 || i + 1}</T></View> : <Avatar name={c.author_name} size={26} color="#C2527A" />}
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={13} weight="600">{c.author_name} <T size={11.5} color={C.muted} weight="400">· {c.author_role} · {timeAgo(c.created_at)}</T></T>
                  <T size={13}>{c.body}</T>
                  {c.resolved ? <T size={11.5} color={C.green}>Resolved</T> : null}
                </View>
              </View>
            ))}
          </ScrollView>
          <ErrorNote text={error} />
          <Field placeholder="Your name" value={name} onChangeText={setName} />
          <TextInput value={body} onChangeText={setBody} placeholder={pin ? 'Comment on the pinned spot…' : 'Add a comment…'} placeholderTextColor={C.muted} multiline style={[ui.input, { height: 80, paddingTop: 10 }]} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {pin && <Button kind="secondary" label="Remove pin" onPress={() => setPin(null)} />}
            <Button icon="send" label="Post comment" onPress={comment} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </View>
  );
}
