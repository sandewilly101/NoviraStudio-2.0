import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Badge, Button, Chip, Icon, PanelTitle, Swatch, T, Toggle, s as ui, type IconName } from '@/components/ui';
import { api, fileUrl, timeAgo } from '@/lib/api';
import { C, SWATCHES } from '@/lib/theme';
import type { Finish, Plan, Scene, SceneObject } from '@/lib/types';
import { useCatalog } from '@/lib/catalog';
import { ReplaceModal } from './ReplaceModal';
import { VarietyModal } from './VarietyModal';
import { isProcedural } from '@/nozila/adapter';
import { ProceduralThumb } from '@/nozila/thumbnails';
import { TRUSS_SYSTEM_CHOICES } from '@/components/three/Truss';
import { contentOf, hasSurface, surfaceFace } from '@/lib/content';
import { slotsOf } from '@/lib/finish';
import { ContentStudio, SurfacePreview } from './ContentStudio';
import { fixtureOf } from '@/components/three/StageLight';
import type { EditorState } from './useEditor';
import { NumBox, ScrubGesture } from './NumBox';
import { SCREEN_LAYOUTS, screenRig, type ScreenLayout } from '@/lib/screens';
import { isPlaying, onClock } from '@/lib/lightFx';
import { startShow } from '@/lib/autoLight';
import { useImportedAsset } from '@/lib/assetDrag';

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}><T size={12.5}>{label}</T>{children}</View>;
}

// Real-world settings of procedural builds.
function ProceduralSettings({ obj, up, ed }: { obj: SceneObject; up: (p: Partial<SceneObject>) => void; ed?: EditorState }) {
  const s = obj.spec || {};
  const set = (k: string, v: unknown) => up({ spec: { ...s, [k]: v } });
  const Row = SettingRow;
  if (obj.type === 'led_screen') return (
    <View>
      <Label>LED wall</Label>
      <T size={12} color={C.sub}>Curve</T>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {[0, 12, 24, 40].map((d) => <Chip key={d} label={d ? `${d}°` : 'Flat'} active={(s.curveDeg || 0) === d} onPress={() => set('curveDeg', d)} />)}
      </View>
      <T size={12} color={C.sub} style={{ marginTop: 10 }}>Mounting</T>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {[['ground-support', 'Ground support'], ['flown', 'Flown'], ['wall-mount', 'Wall']].map(([k, l]) => <Chip key={k} label={l} active={(s.frame || 'ground-support') === k} onPress={() => set('frame', k)} />)}
      </View>
      <Row label="Height off the floor (m)"><NumBox label="↕" min={0} step={0.05} value={Math.round(obj.position[1] * 100) / 100} onChange={(v) => up({ position: [obj.position[0], v, obj.position[2]] })} /></Row>
    </View>
  );
  const chips = (items: readonly (readonly [string | number, string])[], value: unknown, pick: (v: any) => void) => (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      {items.map(([k, l]) => <Chip key={String(k)} label={l} active={value === k} onPress={() => pick(k)} />)}
    </View>
  );
  if (obj.type === 'stage') return (
    <View>
      <Label>Stage</Label>
      <T size={11.5} color={C.muted}>{Math.round(obj.size[0] / 1.219)} × {Math.round(obj.size[2] / 1.219)} decks (4 ft each), {Math.round(obj.size[1] * 100)} cm high</T>
      {/* sized as stages are hired: whole 4 ft decks, standard leg heights */}
      <T size={12} color={C.sub} style={{ marginTop: 10 }}>Height</T>
      {chips([['0.41', '16″'], ['0.61', '24″'], ['0.81', '32″'], ['1.02', '40″'], ['1.22', '48″']], String(([0.41, 0.61, 0.81, 1.02, 1.22].find((h) => Math.abs(h - obj.size[1]) < 0.05) ?? '')), (v) => up({ size: [obj.size[0], Number(v), obj.size[2]] }))}
      {([['Decks across', 0], ['Decks deep', 2]] as const).map(([label, axis]) => {
        const n = Math.max(1, Math.round(obj.size[axis] / 1.219));
        const to = (k: number) => { const size = [...obj.size] as [number, number, number]; size[axis] = Math.round(Math.max(1, k) * 1.219 * 1000) / 1000; up({ size }); };
        return (
          <Row key={label} label={`${label} (${(n * 1.219).toFixed(2)} m)`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable onPress={() => to(n - 1)} accessibilityLabel={`Fewer ${label.toLowerCase()}`} style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}><Icon name="minus" size={12} /></Pressable>
              <T size={13} weight="600">{n}</T>
              <Pressable onPress={() => to(n + 1)} accessibilityLabel={`More ${label.toLowerCase()}`} style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={12} /></Pressable>
            </View>
          </Row>
        );
      })}
      {ed && <ScreenLayouts stage={obj} ed={ed} />}
      <T size={12} color={C.sub} style={{ marginTop: 10 }}>Front branding</T>
      {chips([['none', 'None'], ['printed', 'Printed skirt'], ['led', 'LED fascia']], s.fascia || 'none', (v) => set('fascia', v))}
      {s.fascia && s.fascia !== 'none' ? <Row label="Brand the sides too"><Toggle value={!!s.fasciaSides} onChange={(v) => set('fasciaSides', v)} /></Row> : null}
      <T size={12} color={C.sub} style={{ marginTop: 10 }}>Deck top</T>
      {chips([['deck', 'Non-slip black'], ['carpet', 'Carpet'], ['gloss', 'Gloss']], s.top || 'deck', (v) => set('top', v))}
      <T size={12} color={C.sub} style={{ marginTop: 10 }}>Skirting</T>
      <View style={{ flexDirection: 'row', gap: 2, marginTop: 6, flexWrap: 'wrap' }}>
        {['#121212', '#F2EFE8', '#1B2538', '#6E1F2C', '#C9A227', '#4A4F57'].map((c) => <Swatch key={c} color={c} selected={(s.skirt || '#121212') === c} onPress={() => set('skirt', c)} />)}
      </View>
      <Row label="Stairs at the front"><Toggle value={s.stairs !== false} onChange={(v) => set('stairs', v)} /></Row>
      <Row label="Guardrails (back & sides)"><Toggle value={s.rails ?? obj.size[1] >= 0.76} onChange={(v) => set('rails', v)} /></Row>
      <Row label="Skirt the back too"><Toggle value={!!s.skirtBack} onChange={(v) => set('skirtBack', v)} /></Row>
      <Row label="LED edge strip"><Toggle value={obj.ledStrip !== false} onChange={(v) => up({ ledStrip: v })} /></Row>
    </View>
  );
  if (obj.type === 'truss') return (
    <View>
      <Label>Truss</Label>
      <T size={12} color={C.sub}>Section</T>
      {chips(TRUSS_SYSTEM_CHOICES, s.system || 'f34-square', (v) => set('system', v))}
      <T size={12} color={C.sub} style={{ marginTop: 10 }}>Finish</T>
      {chips([['silver', 'Brushed aluminium'], ['black', 'Black (stage)']], s.finish || 'silver', (v) => set('finish', v))}
    </View>
  );
  if (obj.type === 'light') {
    const fx = fixtureOf(obj), mount = s.mount || fx.mount, level = Math.round(Number(s.intensity ?? 0.8) * 100);
    const zooms = [...new Set([fx.zoom[0], Math.round((fx.zoom[0] + fx.zoom[1]) / 2), fx.zoom[1]])];
    return (
      <View>
        <Label>{fx.label}</Label>
        <Row label="On"><Toggle value={s.on !== false} onChange={(v) => set('on', v)} /></Row>
        <T size={12} color={C.sub} style={{ marginTop: 10 }}>Intensity (dimmer) · {level}%</T>
        {chips([[0.1, '10%'], [0.25, '25%'], [0.5, '50%'], [0.8, '80%'], [1, '100%']], Number(s.intensity ?? 0.8), (v) => set('intensity', v))}
        <T size={12} color={C.sub} style={{ marginTop: 10 }}>Beam angle (zoom)</T>
        {chips(zooms.map((z) => [z, `${z}°`] as const), Number(s.beamDeg ?? fx.beam), (v) => set('beamDeg', v))}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
          <NumBox label="Pan°" step={5} min={-270} max={270} value={Number(s.pan ?? 0)} onChange={(v) => set('pan', v)} />
          <NumBox label="Tilt°" step={5} min={-135} max={135} value={Number(s.tilt ?? (mount === 'floor' ? -65 : mount === 'stand' ? 15 : 50))} onChange={(v) => set('tilt', Math.max(-135, Math.min(135, v)))} />
        </View>
        <T size={12} color={C.sub} style={{ marginTop: 10 }}>Mounting</T>
        {chips([['truss', 'On truss'], ['stand', 'On a stand'], ['floor', 'On the floor']], mount, (v) => set('mount', v))}
        <Row label="Show beam in haze"><Toggle value={s.haze !== false} onChange={(v) => set('haze', v)} /></Row>
      </View>
    );
  }
  if (obj.type === 'curtain') return (
    <View>
      <Label>Drape</Label>
      <T size={12} color={C.sub}>Fullness</T>
      {chips([[1, 'Flat 100%'], [1.5, 'Standard 150%'], [2, 'Full 200%'], [2.5, 'Theatre 250%']], Number(s.fullness ?? 1.5), (v) => set('fullness', v))}
    </View>
  );
  if (obj.type === 'booth') return (
    <View>
      <Label>Stand</Label>
      <T size={12} color={C.sub}>Carpet</T>
      <View style={{ flexDirection: 'row', gap: 2, marginTop: 6, flexWrap: 'wrap' }}>
        {['#2E3D5C', '#3A3D42', '#8C1D24', '#1F5E3B', '#7A7F87', '#C9B79C'].map((c) => <Swatch key={c} color={c} selected={(s.carpet || '#2E3D5C') === c} onPress={() => set('carpet', c)} />)}
      </View>
    </View>
  );
  if (obj.type === 'tent') return (
    <View><Label>Tent</Label><Row label="Hide canopy (plan inside)"><Toggle value={!!s.canopyHidden} onChange={(v) => set('canopyHidden', v)} /></Row></View>
  );
  return null;
}

const TYPE_ICON: Record<string, IconName> = {
  stage: 'square', led_screen: 'monitor', lectern: 'mic', speaker: 'speaker', bar: 'coffee', dance_floor: 'grid', round_table: 'circle',
  long_table: 'minus-square', cocktail_table: 'circle', chair: 'user', centrepiece: 'star', sofa: 'archive', sign: 'type', model: 'box', chandelier: 'sun', ceiling_drape: 'wind', arch: 'heart',
};
const TYPE_NAME: Record<string, string> = {
  stage: 'Stage', led_screen: 'LED screen', lectern: 'Lectern', speaker: 'Speakers', bar: 'Bar', dance_floor: 'Dance floor', round_table: 'Round tables',
  long_table: 'Long tables', cocktail_table: 'High tables', chair: 'Chairs', centrepiece: 'Centrepieces', sofa: 'Sofas', sign: 'Signs', model: 'Imported models', chandelier: 'Chandeliers', ceiling_drape: 'Ceiling drapes', arch: 'Arches',
};

/** Covers and sashes for the event's chairs (all of them: banquet chairs are dressed alike). */
function ChairDress({ ed, obj, palette }: { ed: EditorState; obj: SceneObject; palette: string[] }) {
  const colours = [...new Set(palette.map((c) => c.toUpperCase()))].slice(0, 11);
  const set = (key: 'cover' | 'sash', v: string | null) => ed.setScene((sc) => ({ ...sc, objects: sc.objects.map((o) => {
    if (o.type !== 'chair') return o;
    const spec = { ...(o.spec || {}) };
    if (v) spec[key] = v; else delete spec[key];
    return { ...o, spec };
  }) }));
  const row = (key: 'cover' | 'sash', label: string) => (
    <View style={{ gap: 6, marginBottom: 8 }}>
      <T size={11.5} color={C.sub}>{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pressable onPress={() => set(key, null)} accessibilityLabel={`No ${key}`} style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: !obj.spec?.[key] ? C.blue : C.border, alignItems: 'center', justifyContent: 'center' }}><Icon name="slash" size={12} color={C.muted} /></Pressable>
        {colours.map((c) => <Swatch key={c} color={c} selected={String(obj.spec?.[key] || '').toUpperCase() === c} onPress={() => set(key, c)} />)}
      </View>
    </View>
  );
  return (
    <>
      <Label>Chair dressing · all chairs</Label>
      {row('cover', 'Fitted cover')}
      {row('sash', 'Sash with a bow')}
    </>
  );
}

/** One click: the stage's LED walls rebuilt as a production layout (they keep their content). */
function ScreenLayouts({ stage, ed }: { stage: SceneObject; ed: EditorState }) {
  const apply = (layout: ScreenLayout) => ed.setScene((sc) => {
    const current = sc.objects.filter((o) => o.type === 'led_screen');
    const content = current[0]?.content;
    const ceiling = ed.data?.venue?.analysis?.size?.[1] || 6;
    const rig = screenRig(stage, layout, ceiling, content).map((o, i) => ({ ...o, id: `led_${Date.now().toString(36)}${i}` }) as SceneObject);
    return { ...sc, objects: [...sc.objects.filter((o) => o.type !== 'led_screen'), ...rig] };
  });
  return (
    <>
      <T size={12} color={C.sub} style={{ marginTop: 10 }}>Screens</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {SCREEN_LAYOUTS.map(([k, label, note]) => <Chip key={k} label={label} onPress={() => apply(k)} {...({ title: note } as any)} />)}
      </View>
    </>
  );
}

/** The moment the lighting plays — Novira programs and focuses every fixture itself; this only picks the mood. */
const MOMENTS: [string, string][] = [['auto', 'Auto'], ['dinner', 'Dinner'], ['walk-in', 'Walk-in'], ['first-dance', 'First dance'], ['party', 'Party']];
function LightingShow({ ed }: { ed: EditorState }) {
  const lights = ed.scene?.objects.filter((o) => o.type === 'light') || [];
  const playing = usePlaying();
  const [moment, setMoment] = useState('auto');
  if (!lights.length) return null;
  // Auto runs Novira's timeline for the event; a moment holds that look
  const run = (k: string) => { setMoment(k); const sc = ed.scene!, next = startShow(sc, k); if (next !== sc) ed.setScene(next); };
  return (
    <>
      <Label>Lighting</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {MOMENTS.map(([k, label]) => <Chip key={k} label={label} active={playing && moment === k} onPress={() => run(k)} />)}
      </View>
      <T size={11} color={C.muted} style={{ marginTop: 6 }}>Novira programs, focuses and hazes every fixture for this event. Pick a moment to change the mood.</T>
    </>
  );
}

/** Whether the lighting is playing (re-renders when it starts or stops). */
function usePlaying() {
  const [p, setP] = useState(isPlaying());
  useEffect(() => { const off = onClock(() => setP(isPlaying())); return () => { off(); }; }, []);
  return p;
}

function Label({ children }: { children: React.ReactNode }) { return <T size={12} weight="600" color={C.sub} style={{ marginTop: 14, marginBottom: 8 }}>{children}</T>; }
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}><T size={12.5} color={C.sub}>{k}</T>{typeof v === 'string' || typeof v === 'number' ? <T size={12.5} weight="600">{v}</T> : v}</View>;
}

// ---------- Scene outline ----------
export function ScenePanel({ ed }: { ed: EditorState }) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const g: Record<string, SceneObject[]> = {};
    for (const o of ed.scene?.objects || []) if (!filter || o.name.toLowerCase().includes(filter.toLowerCase())) (g[o.type] ||= []).push(o);
    return Object.entries(g);
  }, [ed.scene, filter]);
  return (
    <View style={{ flex: 1 }}>
      <PanelTitle title="Scene" />
      <TextInput value={filter} onChangeText={setFilter} placeholder="Filter objects" placeholderTextColor={C.muted} style={[ui.input, { height: 34, backgroundColor: C.bg, marginBottom: 10 }]} />
      <ScrollView style={{ flex: 1 }}>
        {groups.map(([type, list]) => {
          const single = list.length === 1;
          const anySel = list.some((o) => o.id === ed.selectedId);
          return (
            <View key={type}>
              <Pressable onPress={() => (single ? ed.setSelectedId(list[0].id) : setOpen((x) => ({ ...x, [type]: !x[type] })))}
                style={({ hovered }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: 9, height: 32, paddingHorizontal: 8, borderRadius: 6, backgroundColor: anySel ? C.blueTint : hovered ? C.bg : 'transparent' })}>
                <Icon name={single ? 'chevron-right' : open[type] ? 'chevron-down' : 'chevron-right'} size={13} color={single ? 'transparent' : C.muted} />
                <Icon name={TYPE_ICON[type] || 'box'} size={15} color={anySel ? C.blue : C.sub} />
                <T size={12.5} weight={anySel ? '600' : '400'} color={anySel ? C.blue : C.text} style={{ flex: 1 }} numberOfLines={1}>{single ? list[0].name : `${TYPE_NAME[type] || type} ×${list.length}`}</T>
              </Pressable>
              {!single && open[type] && list.slice(0, 200).map((o) => (
                <Pressable key={o.id} onPress={() => ed.setSelectedId(o.id)} style={{ height: 28, justifyContent: 'center', paddingLeft: 52, borderRadius: 6, backgroundColor: o.id === ed.selectedId ? C.blueTint : 'transparent' }}>
                  <T size={12} color={o.id === ed.selectedId ? C.blue : C.sub} numberOfLines={1}>{o.label ? `${o.name} · ${o.label}` : o.name}</T>
                </Pressable>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Add objects lives in AssetsPanel.tsx
export { AssetsPanel } from './AssetsPanel';

// ---------- AI chat ----------
// image: the Nano Banana concept of a redesign; step: the history step the AI's change became
type Msg = { from: 'you' | 'ai'; text: string; image?: string | null; step?: number; rendering?: boolean };
export function ChatPanel({ ed, projectId, aiLabel, renderConcept }: { ed: EditorState; projectId: string; aiLabel: string; renderConcept?: () => Promise<string | null> }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'ai', text: 'I can see everything in the room and change any of it. Try “hang the LED wall from a circular truss”, “add 8 purple uplighters along the walls”, “put our sponsors on a roll-up left of the stage” or “switch to a sunset mood”.' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<any>(null);
  const send = async (instruction = text) => {
    if (!instruction.trim() || !ed.scene) return;
    setMsgs((m) => [...m, { from: 'you', text: instruction }]); setText(''); setBusy(true);
    try {
      // the last few messages travel with the request, so "make it bigger" knows what "it" is
      const r = await api<{ reply: string; scene: Scene; redesigned?: boolean }>(`/projects/${projectId}/ai-edit`, { body: { instruction, scene: ed.scene, history: msgs.slice(1).slice(-8) } });
      // the whole AI change is one step of the history, named after what was asked
      const step = ed.setScene(r.scene, { label: `AI: ${instruction.trim().replace(/\s+/g, ' ').slice(0, 70)}`, by: 'ai' });
      const rendering = !!(r.redesigned && renderConcept);
      setMsgs((m) => [...m, { from: 'ai', text: r.reply, step, rendering }]);
      // a redesign's concept picture is rendered from the new 3D scene itself, so it shows exactly what was built
      if (rendering) {
        const image = await renderConcept!().catch(() => null);
        setMsgs((m) => m.map((x) => (x.step === step && x.rendering ? { ...x, image, rendering: false } : x)));
      }
    } catch (e: any) { setMsgs((m) => [...m, { from: 'ai', text: `Sorry — ${e.message}` }]); } finally { setBusy(false); }
  };
  useEffect(() => { setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50); }, [msgs, busy]);
  return (
    <View style={{ flex: 1 }}>
      <PanelTitle title="AI assistant" right={<Badge label={aiLabel} kind={aiLabel === 'Basic rules' ? 'gray' : 'blue'} />} />
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        {msgs.map((m, i) => m.from === 'you' ? (
          <View key={i} style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: C.blue, borderRadius: 12, padding: 10 }}><T size={12.5} color="#fff">{m.text}</T></View>
        ) : (
          <View key={i} style={{ flexDirection: 'row', gap: 8, maxWidth: '96%' }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.blueTint, alignItems: 'center', justifyContent: 'center' }}><Icon name="zap" size={13} color={C.blue} /></View>
            <View style={{ flex: 1, backgroundColor: C.bg, borderRadius: 12, padding: 10, gap: 8 }}>
              {m.image ? (
                <Pressable onPress={() => window.open(fileUrl(m.image!), '_blank')} accessibilityLabel="Open the concept image">
                  <Image source={{ uri: fileUrl(m.image) }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: C.surface }} resizeMode="cover" />
                  <T size={10.5} color={C.muted} style={{ marginTop: 4 }}>Concept rendered from this 3D design — the same design, photoreal</T>
                </Pressable>
              ) : null}
              <T size={12.5}>{m.text}</T>
              {m.rendering && (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={C.blue} /><T size={11.5} color={C.sub}>Rendering the concept from the new 3D design…</T>
                </View>
              )}
              {m.step != null && <AiStepUndo ed={ed} step={m.step} />}
            </View>
          </View>
        ))}
        {busy && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingLeft: 34 }}><ActivityIndicator size="small" color={C.blue} /><T size={12} color={C.muted}>Working on it…</T></View>}
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 }}>
        {/* short labels; each sends the full request */}
        {([['Moving heads on truss', 'Hang moving heads on a truss over the stage'], ['Uplighters', 'Add uplighters along the walls'], ['Gold & ivory', 'Make it a gold and ivory theme'], ['Sunset mood', 'Switch to sunset lighting']] as const).map(([l, t]) => <Chip key={l} label={l} onPress={() => send(t)} />)}
      </View>
      <View style={{ borderWidth: 1.5, borderColor: C.blue, borderRadius: 12, padding: 8, gap: 6 }}>
        <TextInput value={text} onChangeText={setText} placeholder="Ask for any change…" placeholderTextColor={C.muted} multiline onKeyPress={(e: any) => { if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault?.(); send(); } }}
          style={{ minHeight: 40, fontSize: 13, color: C.text, outlineWidth: 0 } as any} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={ed.undo} disabled={!ed.canUndo}><T size={12} color={ed.canUndo ? C.blue : C.muted} weight="600">Undo last change</T></Pressable>
          <Button icon="send" onPress={() => send()} loading={busy} small />
        </View>
      </View>
    </View>
  );
}

// ---------- Version history ----------
/** Under an AI reply: take its change back (or, after later changes, go back to before it). */
function AiStepUndo({ ed, step }: { ed: EditorState; step: number }) {
  const { index, steps } = ed.history;
  if (step >= steps.length || steps[step]?.by !== 'ai') return null; // that step has since been cut off the history
  const undone = index < step, latest = index === step;
  return (
    <Pressable onPress={() => ed.jumpTo(undone ? step : step - 1)} accessibilityLabel={undone ? 'Redo the AI change' : 'Undo the AI change'}
      style={({ hovered }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, height: 26, borderRadius: 6, borderWidth: 1, borderColor: hovered ? C.blue : C.border, backgroundColor: C.surface })}>
      <Icon name={undone ? 'corner-up-right' : 'corner-up-left'} size={12} color={C.blue} />
      <T size={11.5} weight="600" color={C.blue}>{undone ? 'Redo this change' : latest ? 'Undo this change' : 'Go back to before this'}</T>
    </Pressable>
  );
}

/** Every change of this session, newest first: click one to go back (or forward) to it. */
function SessionSteps({ ed }: { ed: EditorState }) {
  const { index, steps } = ed.history;
  const [all, setAll] = useState(false);
  const order = steps.map((s, i) => ({ ...s, i })).reverse(), shown = all ? order : order.slice(0, 12);
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <T size={12} weight="700" color={C.sub}>THIS SESSION</T>
        <T size={11} color={C.muted}>Ctrl+Z / Ctrl+Y</T>
      </View>
      {shown.map((s) => {
        const here = s.i === index, ahead = s.i > index;
        return (
          <Pressable key={`${s.i}-${s.at}`} onPress={() => ed.jumpTo(s.i)} accessibilityLabel={`Go to: ${s.label}`} {...({ title: here ? 'You are here' : ahead ? 'Redo up to here' : 'Undo back to here' } as any)}
            style={({ hovered }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: here ? '#F2F8FD' : hovered ? C.bg : 'transparent', opacity: ahead ? 0.5 : 1 })}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: here ? C.blue : 'transparent', borderWidth: 1.5, borderColor: here ? C.blue : C.border }} />
            {s.by === 'ai' ? <Icon name="zap" size={12} color={C.blue} /> : null}
            <T size={12.5} weight={here ? '600' : '400'} color={here ? C.blue : C.text} numberOfLines={1} style={{ flex: 1 }}>{s.label}</T>
            <T size={10.5} color={C.muted}>{timeAgo(new Date(s.at).toISOString())}</T>
          </Pressable>
        );
      })}
      {order.length > 12 && <Pressable onPress={() => setAll((x) => !x)} style={{ padding: 6 }}><T size={12} color={C.blue} weight="600">{all ? 'Show fewer' : `Show all ${order.length} steps`}</T></Pressable>}
    </View>
  );
}

export function HistoryPanel({ ed, projectId }: { ed: EditorState; projectId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>(`/projects/${projectId}/versions`).then(setRows).catch(() => setRows([])); }, [projectId, ed.data?.version]);
  const restore = async (v: number) => {
    const r = await api<{ scene: Scene }>(`/projects/${projectId}/versions/${v}`);
    ed.setScene(r.scene, { label: `Restored version ${v}` });
  };
  return (
    <View style={{ flex: 1 }}>
      <PanelTitle title="History" />
      {!rows ? <ActivityIndicator color={C.blue} /> : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
          <SessionSteps ed={ed} />
          <T size={12} weight="700" color={C.sub} style={{ marginTop: 14, marginBottom: 2 }}>SAVED VERSIONS</T>
          {rows.map((r) => (
            <View key={r.id} style={{ borderWidth: 1, borderColor: r.version === ed.data?.version ? C.blue : C.border, borderRadius: 10, padding: 12, gap: 4, backgroundColor: r.version === ed.data?.version ? '#F2F8FD' : C.surface }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T weight="700" color={r.version === ed.data?.version ? C.blue : C.text}>v{r.version}</T>
                {r.approval ? <Badge label="Approved" kind="green" /> : r.created_by === 'ai' ? <Badge label="AI" /> : null}
              </View>
              <T size={12.5}>{r.label || 'Saved'}</T>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T size={11.5} color={C.muted}>{timeAgo(r.created_at)}</T>
                {r.version !== ed.data?.version && <Pressable onPress={() => restore(r.version)}><T size={12} color={C.blue} weight="600">Restore</T></Pressable>}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ---------- Inspector for the selected object ----------
export function Inspector({ ed, obj, brandColors, brandLogo }: { ed: EditorState; obj: SceneObject; brandColors: string[]; brandLogo?: string | null }) {
  const [studio, setStudio] = useState(false);
  const [hex, setHex] = useState(obj.color);
  const [prevColor, setPrevColor] = useState(obj.color);
  if (prevColor !== obj.color) { setPrevColor(obj.color); setHex(obj.color); }
  const up = (patch: Partial<SceneObject>) => ed.updateObject(obj.id, patch);
  const catalog = useCatalog();
  const real = (!!catalog?.[obj.type] || !!obj.asset) && obj.type !== 'model' && !obj.modelUrl;
  const base = catalog?.[obj.type];
  const imported = obj.type === 'model' || !!obj.modelUrl;
  // models placed before they remembered their source: look the file up in the import library
  const looked = useImportedAsset(imported && !obj.asset ? obj.modelUrl : null);
  const asset = obj.asset || looked || undefined;
  const model = asset
    ? { name: asset.name, thumbnail: asset.thumbnail, author: asset.author, license: asset.license }
    : base && !imported ? { name: base.name, thumbnail: base.thumbnail, author: base.author, license: base.license }
      : imported ? { name: obj.name, thumbnail: null } : null;
  const [replacing, setReplacing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const procedural = isProcedural(obj);
  const isTable = obj.type === 'round_table';
  // real models keep their own finish until a colour is picked (round tables: the colour is the linen)
  const setColor = (color: string) => up(real && !isTable ? { color, tint: true } : { color });
  // copies of the same imported model count as "the same kind"
  const sameKind = (o: SceneObject) => (imported ? !!obj.modelUrl && o.modelUrl === obj.modelUrl : o.type === obj.type);
  const sameType = ed.scene?.objects.filter(sameKind).length || 0;
  const surface = hasSurface(obj), content = contentOf(obj);
  const palette = [...new Set([...brandColors, ...SWATCHES])].slice(0, 12);

  return (
    <ScrubGesture.Provider value={{ begin: ed.beginGesture, end: ed.endGesture }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {procedural ? (
          <Pressable onPress={() => setChoosing(true)} accessibilityLabel="Choose a variety" {...({ title: 'Choose a variety' } as any)}
            style={({ hovered }: any) => ({ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: hovered ? C.blue : C.border })}>
            <ProceduralThumb o={obj} size={52} />
            <View style={{ position: 'absolute', right: 2, bottom: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }}><Icon name="refresh-cw" size={10} color="#fff" /></View>
          </Pressable>
        ) : (real || imported) && model ? (
          <Pressable onPress={() => setReplacing(true)} accessibilityLabel="Replace with a similar model" {...({ title: 'Replace with a similar model' } as any)}
            style={({ hovered }: any) => ({ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: hovered ? C.blue : C.border, backgroundColor: C.bg })}>
            {model.thumbnail ? <Image source={{ uri: model.thumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Icon name={TYPE_ICON[obj.type] || 'box'} size={20} /></View>}
            <View style={{ position: 'absolute', right: 2, bottom: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }}><Icon name="refresh-cw" size={10} color="#fff" /></View>
          </Pressable>
        ) : (
          <View style={{ width: 38, height: 38, borderRadius: 8, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' }}><Icon name={TYPE_ICON[obj.type] || 'box'} size={18} color="#fff" /></View>
        )}
        <View style={{ flex: 1 }}>
          <TextInput value={obj.name} onChangeText={(name) => up({ name })} style={{ fontSize: 14, fontWeight: '600', color: C.text, outlineWidth: 0 } as any} />
          <T size={11.5} color={C.muted}>{TYPE_NAME[obj.type] || obj.type}{obj.label ? ` · ${obj.label}` : ''}</T>
        </View>
        <Pressable onPress={() => ed.duplicate(obj.id)} accessibilityLabel="Duplicate"><Icon name="copy" size={15} /></Pressable>
        <Pressable onPress={() => ed.removeObject(obj.id)} accessibilityLabel="Delete"><Icon name="trash-2" size={15} color={C.red} /></Pressable>
      </View>
      {(real || imported) && <Button small kind="soft" icon="refresh-cw" label={imported ? 'Replace model…' : 'Replace with similar…'} onPress={() => setReplacing(true)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
      {procedural && <Button small kind="soft" icon="layers" label="Choose variety…" onPress={() => setChoosing(true)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
      {choosing && (
        <VarietyModal obj={obj} sameType={sameType} onClose={() => setChoosing(false)}
          onPick={(v, all) => {
            const patch = (o: SceneObject): Partial<SceneObject> => ({ ...v.patch, variant: v.patch.variant ?? v.key, spec: { ...o.spec, ...v.patch.spec } });
            if (all) ed.setScene((s) => ({ ...s, objects: s.objects.map((o) => (o.type === obj.type ? { ...o, ...patch(o) } : o)) }));
            else up(patch(obj));
          }} />
      )}
      {procedural && <ProceduralSettings obj={obj} up={up} ed={ed} />}
      {obj.type === 'chair' && <ChairDress ed={ed} obj={obj} palette={[...(ed.scene?.plan as any)?.design?.theme?.palette?.map((c: { hex: string }) => c.hex) || [], ...palette]} />}
      {replacing && model && (
        <ReplaceModal obj={asset && !obj.asset ? { ...obj, asset } : obj} current={model} sameType={sameType} onClose={() => setReplacing(false)}
          onReplace={(asset, all, size) => {
            // an imported model takes the new file (at its real size); a catalogue object keeps its size
            const patch: Partial<SceneObject> = imported ? { asset, modelUrl: asset.url, name: asset.name.slice(0, 60), ...(size ? { size } : {}) } : { asset };
            if (all) ed.updateWhere(sameKind, patch); else up(patch);
          }} />
      )}

      <Label>Size (metres)</Label>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <NumBox label="W" min={0.05} step={0.05} value={obj.size[0]} onChange={(v) => up({ size: [v, obj.size[1], obj.size[2]] })} />
        <NumBox label="H" min={0.01} step={0.05} value={obj.size[1]} onChange={(v) => up({ size: [obj.size[0], v, obj.size[2]] })} />
        <NumBox label="D" min={0.01} step={0.05} value={obj.size[2]} onChange={(v) => up({ size: [obj.size[0], obj.size[1], v] })} />
      </View>
      <Label>Position · rotation</Label>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <NumBox label="X" step={0.05} value={round(obj.position[0])} onChange={(v) => up({ position: [v, obj.position[1], obj.position[2]] })} />
        <NumBox label="Z" step={0.05} value={round(obj.position[2])} onChange={(v) => up({ position: [obj.position[0], obj.position[1], v] })} />
        <NumBox label="°" step={5} value={Math.round((obj.rotation[1] * 180) / Math.PI)} onChange={(v) => up({ rotation: [0, (v * Math.PI) / 180, 0] })} />
      </View>

      {real && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 14, padding: 10, borderRadius: 8, backgroundColor: C.panel }}>
          <Icon name="box" size={14} color={C.blue} />
          <T size={11.5} color={C.sub} style={{ flex: 1 }}>{model?.name} · {model?.author || 'BlenderKit'} · {model?.license || 'Royalty free'}</T>
        </View>
      )}

      {isTable && real && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <T size={12.5}>Floor-length tablecloth</T>
          <Toggle value={obj.linen !== false} onChange={(v) => sameType > 1 ? ed.updateWhere((o) => o.type === 'round_table', { linen: v }) : up({ linen: v })} />
        </View>
      )}

      <Label>{isTable && real ? 'Linen colour' : real ? 'Colour tint' : 'Colour'}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
        {real && !isTable && <Chip label="Original finish" active={!obj.tint} onPress={() => up({ tint: false })} />}
        {palette.map((c) => <Swatch key={c} color={c} selected={(!real || isTable || obj.tint) && obj.color.toLowerCase() === c.toLowerCase()} onPress={() => setColor(c)} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <TextInput value={hex} onChangeText={setHex} onBlur={() => /^#[0-9a-f]{6}$/i.test(hex) && setColor(hex)} style={[ui.input, { flex: 1, minWidth: 0, height: 32, fontSize: 12 }]} />
        {sameType > 1 && (
          <Pressable onPress={() => ed.updateWhere((o) => o.type === obj.type, { color: obj.color, material: obj.material, tint: obj.tint, linen: obj.linen })} accessibilityLabel={`Apply this colour to all ${sameType}`} {...({ title: `Apply this colour to all ${sameType}` } as any)}
            style={({ hovered }: any) => ({ flexShrink: 0, height: 32, paddingHorizontal: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hovered ? '#D6E8F6' : C.blueTint })}>
            <Icon name="copy" size={12} color={C.blue} /><T size={12} weight="600" color={C.blue}>All {sameType}</T>
          </Pressable>
        )}
      </View>

      {!real && (
        <>
          <Label>Material</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(['matte', 'gloss', 'fabric', 'metal', 'wood'] as const).map((m) => <Chip key={m} label={m[0].toUpperCase() + m.slice(1)} active={(obj.material || 'matte') === m} onPress={() => up({ material: m })} />)}
          </View>
        </>
      )}

      {slotsOf(obj).length > 0 && (
        <>
          <Label>Materials</Label>
          {slotsOf(obj).map(({ key, label }) => {
            const f = obj.finish?.[key];
            // a material put on all of a kind at once (e.g. every chair) is changed or removed on all of them together
            const sharers = f ? (ed.scene?.objects || []).filter((o) => o.type === obj.type && o.finish?.[key]?.slug === f.slug) : [];
            const withSlot = (o: SceneObject, next: Finish | null) => ({ ...o, finish: Object.fromEntries(Object.entries({ ...o.finish, [key]: next }).filter(([, v]) => v)) as Record<string, Finish> });
            const set = (next: Finish | null) => {
              if (sharers.length <= 1) { up({ finish: withSlot(obj, next).finish }); return; }
              const ids = new Set(sharers.map((o) => o.id));
              ed.setScene((sc) => ({ ...sc, objects: sc.objects.map((o) => (ids.has(o.id) ? withSlot(o, next && o.finish?.[key] ? { ...o.finish[key], scale: next.scale } : next) : o)) }));
            };
            return (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5 }}>
                <View style={{ width: 34, height: 34, borderRadius: 6, overflow: 'hidden', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                  {f ? <Image source={{ uri: fileUrl(f.thumb) }} style={{ width: '100%', height: '100%' }} /> : <Icon name="droplet" size={14} color={C.muted} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={12} weight="600" numberOfLines={1}>{label}</T>
                  <T size={11} color={C.muted} numberOfLines={1}>{f ? `${f.name}${sharers.length > 1 ? ` · on all ${sharers.length} ${(TYPE_NAME[obj.type] || 'of these').toLowerCase()}` : ''}` : 'Built-in finish · drag a material here'}</T>
                  {/* pattern size on its own line, so the names keep their width */}
                  {f && (
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                      {([[0.5, 'Finer'], [1, 'Real size'], [2, 'Larger']] as const).map(([k, l]) => <Chip key={k} label={l} active={(f.scale || 1) === k} onPress={() => set({ ...f, scale: k })} />)}
                    </View>
                  )}
                </View>
                {f && <Pressable onPress={() => set(null)} accessibilityLabel={`Remove ${label} material`} {...({ title: sharers.length > 1 ? `Remove from all ${sharers.length}` : 'Remove this material' } as any)} style={{ alignSelf: 'flex-start', padding: 4 }}><Icon name="x" size={14} color={C.muted} /></Pressable>}
              </View>
            );
          })}
          {obj.finish && Object.keys(obj.finish).length > 0 && sameType > 1 && (
            <Button small kind="soft" label={`Apply these materials to all ${sameType}`} onPress={() => ed.updateWhere((o) => o.type === obj.type, { finish: obj.finish })} style={{ marginTop: 6, alignSelf: 'flex-start' }} />
          )}
        </>
      )}

      {surface && (
        <>
          <Label>{obj.type === 'booth' ? 'Back-wall graphic' : 'Content'}</Label>
          <Pressable onPress={() => setStudio(true)} accessibilityLabel="Edit content" style={({ hovered }: any) => ({ borderRadius: 8, borderWidth: 2, borderColor: hovered ? C.blue : C.border, padding: 6, alignItems: 'center', backgroundColor: C.bg })}>
            <SurfacePreview c={content} aspect={surfaceFace(obj).w / surfaceFace(obj).h} width={226} />
          </Pressable>
          {content.mode === 'design' && (
            <TextInput value={content.title || ''} onChangeText={(title) => up({ content: { ...content, title } })} placeholder="Title" placeholderTextColor={C.muted} style={[ui.input, { height: 34, marginTop: 8 }]} />
          )}
          <Button small icon="edit-3" label="Edit content…" onPress={() => setStudio(true)} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
          <T size={11} color={C.muted} style={{ marginTop: 6 }}>Tip: drop an image or video onto any screen, poster or banner in the 3D view.</T>
          {studio && (
            <ContentStudio obj={obj} sameCount={ed.scene?.objects.filter((o) => o.type === obj.type).length || 0} brandColors={brandColors} brandLogo={brandLogo}
              onClose={() => setStudio(false)}
              onApply={(c, all) => (all ? ed.updateWhere((o) => o.type === obj.type, { content: c }) : up({ content: c }))} />
          )}
        </>
      )}
    </ScrollView>
    </ScrubGesture.Provider>
  );
}
const round = (v: number) => Math.round(v * 100) / 100;

// ---------- Event settings when nothing is selected ----------
export function SceneSettings({ ed, projectId }: { ed: EditorState; projectId: string }) {
  const sc = ed.scene!;
  const plan = sc.plan;
  const [busy, setBusy] = useState(false);
  const [guests, setGuests] = useState(String(plan?.guests || ''));
  const [prevGuests, setPrevGuests] = useState(plan?.guests);
  if (prevGuests !== plan?.guests) { setPrevGuests(plan?.guests); setGuests(String(plan?.guests || '')); }
  const relayout = async (patch: Partial<Plan>) => {
    setBusy(true);
    try {
      const r = await api<{ scene: Scene }>(`/projects/${projectId}/relayout`, { body: { plan, patch, objects: sc.objects.filter((o) => o.asset || o.tint || o.variant).map(({ type, asset, tint, color, variant, spec }) => ({ type, asset, tint, color, variant, spec })) } });
      const extras = sc.objects.filter((o) => o.userAdded);
      ed.setScene({ ...r.scene, objects: [...r.scene.objects, ...extras] });
    } finally { setBusy(false); }
  };
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
      <PanelTitle title="Event" right={busy ? <ActivityIndicator size="small" color={C.blue} /> : null} />
      <T size={11.5} color={C.muted}>Nothing selected. Click an object to edit it.</T>
      <View style={{ marginTop: 10 }}>
        <Row k="Layout" v={plan?.layout || '—'} />
        <Row k="Seats placed" v={sc.stats?.seats ?? '—'} />
        {sc.stats?.tables != null && <Row k="Tables" v={sc.stats.tables} />}
        <Row k="Objects" v={sc.objects.length} />
      </View>
      <Label>Layout checks</Label>
      {(sc.checks || []).map((c, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
          <Icon name={c.level === 'ok' ? 'check-circle' : 'alert-triangle'} size={14} color={c.level === 'ok' ? C.green : C.amber} />
          <T size={12.5} color={c.level === 'ok' ? C.text : C.amber} style={{ flex: 1 }}>{c.text}</T>
        </View>
      ))}
      {plan && (
        <>
          {Object.keys(sc.environment?.venueFinishes || {}).length > 0 && (
            <>
              <Label>Venue surfaces</Label>
              {Object.entries(sc.environment!.venueFinishes!).map(([key, f]) => (
                <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                  <Image source={{ uri: fileUrl(f.thumb) }} style={{ width: 30, height: 30, borderRadius: 6 }} />
                  <View style={{ flex: 1 }}><T size={12} weight="600" numberOfLines={1}>{key === 'floor' || key === 'walls' ? key[0].toUpperCase() + key.slice(1) : key}</T><T size={11} color={C.muted} numberOfLines={1}>{f.name}</T></View>
                  <Pressable onPress={() => ed.setScene((x) => { const v = { ...x.environment?.venueFinishes }; delete v[key]; return { ...x, environment: { ...x.environment, venueFinishes: v } }; })} accessibilityLabel="Restore the original surface"><Icon name="x" size={14} color={C.muted} /></Pressable>
                </View>
              ))}
            </>
          )}
          <LightingShow ed={ed} />
          <Label>Guests and layout</Label>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput value={guests} onChangeText={setGuests} keyboardType="numeric" style={[ui.input, { flex: 1, height: 34 }]} />
            <Button small label="Re-layout" onPress={() => relayout({ guests: Number(guests) || plan.guests })} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {(['banquet', 'feast', 'theater', 'cocktail'] as const).map((l) => <Chip key={l} label={l[0].toUpperCase() + l.slice(1)} active={plan.layout === l} onPress={() => relayout({ layout: l })} />)}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <T size={12.5}>Dance floor</T><Toggle value={!!plan.include?.danceFloor} onChange={(v) => relayout({ include: { ...plan.include, danceFloor: v } })} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <T size={12.5}>Bar</T><Toggle value={plan.include?.bar !== false} onChange={(v) => relayout({ include: { ...plan.include, bar: v } })} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

export function Thumb({ url }: { url: string }) {
  return <Image source={{ uri: fileUrl(url) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />;
}
