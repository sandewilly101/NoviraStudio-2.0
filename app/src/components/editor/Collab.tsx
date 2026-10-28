// Working together in the editor: who else is here (top bar), what each of them
// has selected and where they are looking (in the 3D view), and the Share
// dialog — invite people to design with you live, or send the client a link to
// review, comment on and approve the design.
import { createElement, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as THREE from 'three';
import { Avatar, Badge, Button, ErrorNote, Icon, T } from '@/components/ui';
import { api } from '@/lib/api';
import type { LiveState, Peer } from '@/lib/live';
import { C } from '@/lib/theme';
import type { Scene } from '@/lib/types';
import type { CaptureCtx } from '@/components/three/capture';
import type { EditorState } from './useEditor';

const h = createElement;

/** The people in the session, as avatars; click one to see what they see. */
export function PeerAvatars({ live, scene, onFollow }: { live: LiveState; scene: Scene; onFollow: (p: Peer) => void }) {
  if (!live.peers.length) return null;
  const nameOf = (id?: string | null) => scene.objects.find((o) => o.id === id)?.name;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {live.peers.slice(0, 5).map((p, i) => {
        const busy = p.editing;
        const what = busy && p.lastEdit ? `${p.name} ${p.lastEdit}` : p.presence?.selectedId ? `${p.name} has ${nameOf(p.presence.selectedId) || 'an object'} selected` : `${p.name} is here`;
        return (
          <Pressable key={p.id} onPress={() => onFollow(p)} accessibilityLabel={`${what} — click to see their view`} {...({ title: `${what} — click to see their view` } as any)}
            style={{ marginLeft: i ? -8 : 0, borderRadius: 18, borderWidth: 2, borderColor: busy ? p.colour : C.surface, padding: busy ? 1 : 0 }}>
            <Avatar name={p.name} size={busy ? 26 : 28} color={p.colour} />
          </Pressable>
        );
      })}
      {live.peers.length > 5 && <T size={11.5} color={C.sub} style={{ marginLeft: 6 }}>+{live.peers.length - 5}</T>}
    </View>
  );
}

/**
 * In the 3D view: a name tag over each object someone else has selected, and a
 * marker where each of them is standing. Positions follow the camera every frame
 * without re-rendering React.
 */
export function PeerMarkers({ live, view, scene }: { live: LiveState; view: CaptureCtx | null; scene: Scene }) {
  // the tag elements, by key ("sel:<peer>" / "cam:<peer>"), moved directly each frame
  const [tags] = useState(() => new Map<string, HTMLDivElement>());
  const latest = useRef({ live, scene });
  useEffect(() => { latest.current = { live, scene }; });
  useEffect(() => {
    if (!view) return;
    let frame = 0;
    const v = new THREE.Vector3();
    const place = (el: HTMLDivElement | undefined, at: THREE.Vector3 | null) => {
      if (!el) return;
      const r = view.gl.domElement.getBoundingClientRect();
      if (!at) { el.style.display = 'none'; return; }
      v.copy(at).project(view.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { el.style.display = 'none'; return; }
      el.style.display = 'flex';
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * r.width}px, ${(-v.y * 0.5 + 0.5) * r.height}px) translate(-50%, -100%)`;
    };
    const tick = () => {
      const { live: l, scene: sc } = latest.current;
      for (const p of l.peers) {
        const o = sc.objects.find((x) => x.id === p.presence?.selectedId);
        place(tags.get(`sel:${p.id}`), o ? new THREE.Vector3(o.position[0], o.position[1] + o.size[1] + 0.15, o.position[2]) : null);
        const cam = p.presence?.camera;
        place(tags.get(`cam:${p.id}`), cam ? new THREE.Vector3(...cam) : null);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [view, tags]);
  const pill = (p: Peer, key: string, text: string, icon: string) => h('div', {
    key, ref: (el: HTMLDivElement | null) => { if (el) tags.set(key, el); else tags.delete(key); },
    style: { position: 'absolute', left: 0, top: 0, display: 'none', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: p.colour, color: '#fff', font: '600 11.5px system-ui, sans-serif', whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.25)' },
  }, h('span', { style: { opacity: 0.9 } }, icon), text);
  return h('div', { style: { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' } },
    live.peers.flatMap((p) => [pill(p, `sel:${p.id}`, p.name, '▾'), pill(p, `cam:${p.id}`, `${p.name}'s view`, '◉')]));
}

/** Glide the camera to where a collaborator is looking. */
export function followPeer(view: CaptureCtx | null, p: Peer) {
  const cam = p.presence?.camera, target = p.presence?.target;
  if (!view || !cam) return false;
  const from = view.camera.position.clone(), to = new THREE.Vector3(...cam);
  const t0 = view.controls?.target?.clone() as THREE.Vector3 | undefined, t1 = target ? new THREE.Vector3(...target) : undefined;
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / 700), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    view.camera.position.lerpVectors(from, to, e);
    if (t0 && t1) { view.controls.target.lerpVectors(t0, t1, e); view.controls.update(); }
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
}

type Member = { id: number; name: string; email: string; role: 'editor' | 'viewer' };

/** Share: people who design with you (live), and the client review link. */
export function ShareModal({ projectId, ed, live, onClose, flash }: { projectId: string; ed: EditorState; live: LiveState; onClose: () => void; flash: (t: string) => void }) {
  const [data, setData] = useState<{ owner: { id: number; name: string; email: string }; members: Member[]; myRole: string } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const load = () => api(`/projects/${projectId}/members`).then(setData).catch((e) => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per project
  useEffect(() => { load(); }, [projectId]);
  const owner = data?.myRole === 'owner';
  const online = new Set(live.peers.map((p) => p.userId));

  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true); setError(null);
    try { const m = await api(`/projects/${projectId}/members`, { body: { email, role } }); setEmail(''); flash(`${m.name} can now ${m.role === 'viewer' ? 'view' : 'edit'} this project`); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (m: Member) => {
    try { await api(`/projects/${projectId}/members/${m.id}`, { method: 'DELETE' }); await load(); } catch (e: any) { setError(e.message); }
  };
  const reviewLink = async () => {
    setBusy(true); setError(null);
    try {
      if (ed.dirty) await ed.save('Before sharing');
      const { token } = await api(`/projects/${projectId}/share`, { method: 'POST' });
      const url = `${window.location.origin}/share/${token}`;
      setLink(url);
      await navigator.clipboard?.writeText(url).catch(() => {});
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(18,26,43,.55)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 520, maxHeight: '100%', gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={18} weight="700">Share</T>
            <Pressable onPress={onClose} accessibilityLabel="Close"><Icon name="x" size={20} /></Pressable>
          </View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14 }}>
            <View style={{ gap: 8 }}>
              <T size={14} weight="600">Design together</T>
              <T size={12.5} color={C.sub}>People you invite open this project from their own list and edit it with you, live: you see each other’s changes and selections as they happen.</T>
              {owner && (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TextInput value={email} onChangeText={setEmail} onSubmitEditing={invite} placeholder="their@email.com" placeholderTextColor={C.muted} autoCapitalize="none" keyboardType="email-address" accessibilityLabel="Email to invite"
                    style={{ flex: 1, minWidth: 180, height: 38, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, fontSize: 13, color: C.text } as any} />
                  <View style={{ flexDirection: 'row', backgroundColor: C.bg, borderRadius: 8, padding: 3 }}>
                    {(['editor', 'viewer'] as const).map((r) => (
                      <Pressable key={r} onPress={() => setRole(r)} style={{ paddingHorizontal: 10, height: 30, justifyContent: 'center', borderRadius: 6, backgroundColor: role === r ? C.surface : 'transparent' }}>
                        <T size={12} weight="600" color={role === r ? C.blue : C.sub}>{r === 'editor' ? 'Can edit' : 'Can view'}</T>
                      </Pressable>
                    ))}
                  </View>
                  <Button icon="user-plus" label="Invite" onPress={invite} loading={busy} disabled={!email.trim()} />
                </View>
              )}
              {!data ? <ActivityIndicator color={C.blue} /> : (
                <View style={{ gap: 6 }}>
                  {[{ ...data.owner, role: 'owner' as const }, ...data.members].map((m) => (
                    <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                      <Avatar name={m.name} size={30} color={live.peers.find((p) => p.userId === m.id)?.colour || '#8A94A6'} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T size={13} weight="600" numberOfLines={1}>{m.name}{online.has(m.id) ? <T size={11.5} color={C.green} weight="600">  ● here now</T> : null}</T>
                        <T size={11.5} color={C.muted} numberOfLines={1}>{m.email}</T>
                      </View>
                      <Badge label={m.role === 'owner' ? 'Owner' : m.role === 'viewer' ? 'Can view' : 'Can edit'} kind={m.role === 'owner' ? 'blue' : 'gray'} />
                      {owner && m.role !== 'owner' && <Pressable onPress={() => remove(m as Member)} accessibilityLabel={`Remove ${m.name}`} style={{ padding: 4 }}><Icon name="x" size={15} color={C.sub} /></Pressable>}
                    </View>
                  ))}
                </View>
              )}
            </View>
            <View style={{ height: 1, backgroundColor: C.border }} />
            <View style={{ gap: 8 }}>
              <T size={14} weight="600">Client review link</T>
              <T size={12.5} color={C.sub}>Anyone with the link can walk around the design in 3D, pin comments and approve it — no account needed.</T>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Button kind="secondary" icon="link" label={link ? 'Copied — copy again' : 'Create and copy link'} onPress={reviewLink} loading={busy && !email} />
                {link && <Pressable onPress={() => window.open(link, '_blank')}><T size={12.5} color={C.blue} weight="600">Open it</T></Pressable>}
              </View>
              {link && <T size={11.5} color={C.muted} numberOfLines={1}>{link}</T>}
            </View>
            <ErrorNote text={error} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
