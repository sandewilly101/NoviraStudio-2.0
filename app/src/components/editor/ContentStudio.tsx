// Content studio for a display surface (LED wall, poster, roll-up, backdrop,
// media wall, hanging banner, screen, stand graphic). Four ways in — a designed
// layout, your own image or video, the media library, or AI artwork made at the
// surface's exact proportions — with a live preview at the real aspect ratio.
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, Chip, ErrorNote, Icon, Swatch, T, Toggle, s as ui } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { TEMPLATES, contentOf, drawDesign, surfaceFace } from '@/lib/content';
import { deleteMedia, isMediaFile, listMedia, pickFile, uploadMedia, type Media } from '@/lib/media';
import { C, SWATCHES } from '@/lib/theme';
import type { SceneObject, SurfaceContent } from '@/lib/types';

type Tab = 'design' | 'media' | 'library' | 'ai';
type Target = 'media' | 'logo' | 'photo';
const STYLES = ['Elegant', 'Corporate', 'Festive', 'Minimal', 'Luxury gold', 'Neon night'];
const BODY_HINT: Record<string, string> = {
  agenda: '19:00 - Welcome drinks\n19:30 - Dinner\n21:00 - Awards',
  sponsors: 'One sponsor per line',
  headline: 'Optional third line',
};

/** A design drawn straight onto a canvas on the page (no image encoding, so typing stays instant). */
function DesignCanvas({ c, w, h }: { c: SurfaceContent; w: number; h: number }) {
  const [el, setEl] = useState<HTMLCanvasElement | null>(null);
  const key = JSON.stringify([c, w, h]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      if (!el || !live) return;
      const off = await drawDesign(c, w, h); // draw off-screen, then blit, so it never flashes empty
      if (!live) return;
      el.width = w; el.height = h;
      el.getContext('2d')!.drawImage(off, 0, 0);
    }, 60);
    return () => { live = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on what the preview shows
  }, [key, el]);
  return createElement('canvas', { ref: setEl, width: w, height: h, style: { width: '100%', height: '100%', display: 'block' } });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ marginTop: 12 }}><T size={12} weight="600" color={C.sub} style={{ marginBottom: 6 }}>{label}</T>{children}</View>;
}
function Swatches({ palette, value, pick }: { palette: string[]; value?: string; pick: (c: string) => void }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>{palette.map((c) => <Swatch key={c} size={20} color={c} selected={value?.toLowerCase() === c.toLowerCase()} onPress={() => pick(c)} />)}</View>;
}

/** The surface as it will look, at its real proportions. */
export function SurfacePreview({ c, aspect, width }: { c: SurfaceContent; aspect: number; width: number }) {
  const height = Math.round(width / aspect);
  // drawn at the on-screen size (×1.5 for sharpness), capped
  const pw = Math.round(Math.min(1100, width * 1.5)), ph = Math.max(16, Math.round(pw / aspect));
  const box = { width, height, backgroundColor: c.mode === 'media' ? c.mediaBg || '#000' : '#0B0C0E', overflow: 'hidden' as const, borderRadius: 4 };
  if (c.mode === 'media' && c.mediaUrl && c.mediaKind === 'video') {
    return <View style={box}>{createElement('video', { src: fileUrl(c.mediaUrl), autoPlay: true, loop: true, muted: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: c.fit === 'contain' ? 'contain' : 'cover' } })}</View>;
  }
  if (c.mode === 'design') return <View style={box}><DesignCanvas c={c} w={pw} h={ph} /></View>;
  return <View style={box}>{c.mediaUrl ? <Image source={{ uri: fileUrl(c.mediaUrl) }} style={{ width: '100%', height: '100%' }} resizeMode={c.fit === 'contain' ? 'contain' : 'cover'} /> : <ActivityIndicator color={C.blue} style={{ flex: 1 }} />}</View>;
}

export function ContentStudio({ obj, sameCount, brandColors, brandLogo, onClose, onApply }: {
  obj: SceneObject; sameCount: number; brandColors: string[]; brandLogo?: string | null;
  onClose: () => void; onApply: (c: SurfaceContent, all: boolean) => void;
}) {
  const face = surfaceFace(obj), aspect = face.w / face.h;
  const [draft, setDraft] = useState<SurfaceContent>(() => contentOf(obj));
  const [designMemory, setDesignMemory] = useState<SurfaceContent>(() => { const c = contentOf(obj); return c.mode === 'design' ? c : { mode: 'design', template: 'headline', title: obj.text?.content || 'Your Event', bg: '#0E2A4A', fg: '#FFFFFF', accent: '#C9A227', font: 'sans' }; });
  const [tab, setTab] = useState<Tab>(draft.mode === 'media' ? 'media' : 'design');
  const [target, setTarget] = useState<Target>('media');
  const [all, setAll] = useState(false);
  const [library, setLibrary] = useState<Media[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('Elegant');
  const palette = useMemo(() => [...new Set([...brandColors, '#0E2A4A', '#111111', '#FFFFFF', '#C9A227', ...SWATCHES])].slice(0, 14), [brandColors]);

  const design = (p: Partial<SurfaceContent>) => { const next = { ...designMemory, ...p, mode: 'design' as const }; setDesignMemory(next); setDraft(next); };
  const media = (p: Partial<SurfaceContent>) => setDraft((d) => ({ ...(d.mode === 'media' ? d : { mode: 'media', fit: 'cover', mediaBg: '#000000' }), ...p, mode: 'media' }));
  const loadLibrary = useCallback(() => listMedia().then(setLibrary).catch((e) => setError(e.message)), []);
  useEffect(() => { if (tab === 'library' && !library) loadLibrary(); }, [tab, library, loadLibrary]);

  // a picked or uploaded file goes where it was asked for: the surface itself, or the layout's logo / photo
  const applyMedia = (m: Pick<Media, 'file_url' | 'kind'>) => {
    if (target === 'logo') { design({ logoUrl: m.file_url }); setTab('design'); }
    else if (target === 'photo') { design({ imageUrl: m.file_url }); setTab('design'); }
    else { media({ mediaUrl: m.file_url, mediaKind: m.kind }); setTab('media'); }
    setTarget('media');
  };
  const uploadAndUse = async (file: File | null) => {
    if (!file) return;
    if (!isMediaFile(file)) { setError('Choose an image or a video file.'); return; }
    setBusy('Uploading…'); setError(null);
    try { const m = await uploadMedia(file, (p) => setBusy(`Uploading… ${p}%`)); setLibrary((l) => (l ? [m, ...l] : l)); applyMedia(m); }
    catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy('Nano Banana is designing…'); setError(null);
    try {
      const words = [designMemory.title, designMemory.subtitle].filter(Boolean).join(' — ');
      const r = await api<{ url: string; media?: Media }>('/renders/graphic', { body: {
        prompt: `${prompt.trim()}. Style: ${style}. ${words ? `Include the text "${words}" spelled exactly.` : ''} Designed for a ${face.w.toFixed(1)} × ${face.h.toFixed(1)} m ${obj.type === 'led_screen' ? 'LED video wall' : 'printed event graphic'}.`,
        aspect: `${face.px[0]}:${face.px[1]}`, colors: brandColors } });
      if (r.media) setLibrary((l) => (l ? [r.media!, ...l] : l));
      media({ mediaUrl: r.url, mediaKind: 'image', fit: 'cover' }); setTab('media');
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const picker = (label: string, url: string | undefined, which: Target) => (
    <Field label={label}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {url ? <Image source={{ uri: fileUrl(url) }} style={{ width: 54, height: 36, borderRadius: 4, backgroundColor: C.bg }} resizeMode="contain" /> : null}
        {which === 'logo' && brandLogo ? <Chip label="Brand logo" onPress={() => design({ logoUrl: brandLogo })} /> : null}
        <Chip icon="upload" label="Upload" onPress={() => { setTarget(which); pickFile('image/*').then(uploadAndUse); }} />
        <Chip icon="folder" label="Library" onPress={() => { setTarget(which); setTab('library'); }} />
        {url ? <Pressable onPress={() => design(which === 'logo' ? { logoUrl: undefined } : { imageUrl: undefined })}><T size={12} color={C.red}>Remove</T></Pressable> : null}
      </View>
    </Field>
  );

  const d = designMemory;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(18,26,43,.55)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={{ width: '100%', maxWidth: 1180, height: '92%', backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <View style={{ flex: 1 }}>
              <T size={18} weight="700">Content · {obj.name}</T>
              <T size={12} color={C.sub}>{face.note}</T>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close"><Icon name="x" size={20} /></Pressable>
          </View>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {/* controls */}
            <View style={{ width: 400, borderRightWidth: 1, borderRightColor: C.border }}>
              <View style={{ flexDirection: 'row', gap: 6, padding: 12, flexWrap: 'wrap' }}>
                {([['design', 'layout', 'Design'], ['media', 'image', 'Image / video'], ['library', 'folder', 'Library'], ['ai', 'zap', 'AI artwork']] as const).map(([k, ic, l]) => (
                  <Chip key={k} icon={ic} label={l} active={tab === k} onPress={() => { setTab(k); if (k === 'design') setDraft(designMemory); }} />
                ))}
              </View>
              {target !== 'media' && tab === 'library' && <T size={12} color={C.blue} style={{ paddingHorizontal: 14 }}>Choose the {target} for the layout</T>}
              <ErrorNote text={error} />
              {busy && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 14 }}><ActivityIndicator size="small" color={C.blue} /><T size={12.5}>{busy}</T></View>}

              {tab === 'design' && (
                <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 0 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {TEMPLATES.map((t) => (
                      <Pressable key={t.key} onPress={() => design({ template: t.key })}
                        style={({ hovered }: any) => ({ width: 178, padding: 6, borderRadius: 10, borderWidth: (d.template || 'headline') === t.key ? 2 : 1, borderColor: (d.template || 'headline') === t.key || hovered ? C.blue : C.border })}>
                        <SurfacePreview c={{ ...d, template: t.key }} aspect={aspect} width={164} />
                        <T size={12} weight="600" style={{ marginTop: 6 }}>{t.label}</T>
                        <T size={10.5} color={C.muted} numberOfLines={1}>{t.note}</T>
                      </Pressable>
                    ))}
                  </View>
                  <Field label="Title"><TextInput value={d.title || ''} onChangeText={(title) => design({ title })} placeholder="Event name" placeholderTextColor={C.muted} style={[ui.input, { height: 36 }]} /></Field>
                  <Field label="Second line"><TextInput value={d.subtitle || ''} onChangeText={(subtitle) => design({ subtitle })} placeholder="Date, venue, speaker title…" placeholderTextColor={C.muted} style={[ui.input, { height: 36 }]} /></Field>
                  {['agenda', 'sponsors', 'headline'].includes(d.template || 'headline') && (
                    <Field label={d.template === 'agenda' ? 'Programme (one per line)' : d.template === 'sponsors' ? 'Sponsors (one per line)' : 'Third line'}>
                      <TextInput value={d.body || ''} onChangeText={(body) => design({ body })} multiline placeholder={BODY_HINT[d.template || 'headline']} placeholderTextColor={C.muted} style={[ui.input, { height: d.template === 'headline' ? 36 : 96, paddingTop: 8 }]} />
                    </Field>
                  )}
                  {picker('Logo', d.logoUrl, 'logo')}
                  {['photo', 'split', 'speaker'].includes(d.template || '') && picker('Photo', d.imageUrl, 'photo')}
                  <Field label="Background"><Swatches palette={palette} value={d.bg} pick={(bg) => design({ bg })} /></Field>
                  <Field label="Text"><Swatches palette={palette} value={d.fg} pick={(fg) => design({ fg })} /></Field>
                  <Field label="Accent"><Swatches palette={palette} value={d.accent} pick={(accent) => design({ accent })} /></Field>
                  <Field label="Lettering">
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {([['sans', 'Modern'], ['serif', 'Classic serif'], ['display', 'Bold display']] as const).map(([k, l]) => <Chip key={k} label={l} active={(d.font || 'sans') === k} onPress={() => design({ font: k })} />)}
                      <Chip label="Centred" active={d.align !== 'left'} onPress={() => design({ align: 'center' })} />
                      <Chip label="Left" active={d.align === 'left'} onPress={() => design({ align: 'left' })} />
                    </View>
                  </Field>
                </ScrollView>
              )}

              {tab === 'media' && (
                <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 0, gap: 12 }}>
                  <Pressable onPress={() => { setTarget('media'); pickFile().then(uploadAndUse); }}
                    {...({ onDragOver: (e: any) => e.preventDefault(), onDrop: (e: any) => { e.preventDefault(); setTarget('media'); uploadAndUse(e.dataTransfer?.files?.[0] || null); } } as any)}
                    style={({ hovered }: any) => ({ height: 150, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: hovered ? C.blue : C.border, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.bg })}>
                    <Icon name="upload-cloud" size={26} color={C.blue} />
                    <T size={13} weight="600">Drop an image or video here</T>
                    <T size={11.5} color={C.muted}>or click to choose · PNG, JPG, WebP, SVG, MP4, WebM</T>
                  </Pressable>
                  {draft.mode === 'media' && draft.mediaUrl ? (
                    <>
                      <T size={12} weight="600" color={C.sub}>Fit</T>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Chip label="Fill (crop to fit)" active={draft.fit !== 'contain'} onPress={() => media({ fit: 'cover' })} />
                        <Chip label="Show all" active={draft.fit === 'contain'} onPress={() => media({ fit: 'contain' })} />
                      </View>
                      {draft.fit === 'contain' && <><T size={12} weight="600" color={C.sub}>Background around it</T><Swatches palette={palette} value={draft.mediaBg} pick={(mediaBg) => media({ mediaBg })} /></>}
                    </>
                  ) : <T size={12} color={C.muted}>Your file is added to the media library and can be reused on any surface.</T>}
                </ScrollView>
              )}

              {tab === 'library' && (
                library === null ? <ActivityIndicator color={C.blue} style={{ margin: 20 }} /> : library.length === 0 ? <T size={12.5} color={C.muted} style={{ padding: 14 }}>Nothing yet. Upload or generate something and it appears here.</T> : (
                  <FlatList data={library} numColumns={2} keyExtractor={(m) => String(m.id)} columnWrapperStyle={{ gap: 8 }} contentContainerStyle={{ padding: 14, paddingTop: 0, gap: 8 }}
                    renderItem={({ item: m }) => (
                      <Pressable onPress={() => applyMedia(m)} style={({ hovered }: any) => ({ flex: 1, maxWidth: '50%', borderRadius: 10, borderWidth: 1, borderColor: hovered ? C.blue : C.border, overflow: 'hidden' })}>
                        <View style={{ aspectRatio: 16 / 10, backgroundColor: '#0B0C0E', alignItems: 'center', justifyContent: 'center' }}>
                          {m.kind === 'image' ? <Image source={{ uri: fileUrl(m.file_url) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name="film" size={24} color="#fff" />}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 6, gap: 4 }}>
                          <T size={11} numberOfLines={1} style={{ flex: 1 }}>{m.source === 'ai' ? '✦ ' : ''}{m.name}</T>
                          <Pressable onPress={() => deleteMedia(m.id).then(() => setLibrary((l) => l?.filter((x) => x.id !== m.id) || l))} accessibilityLabel="Delete from library"><Icon name="trash-2" size={13} color={C.muted} /></Pressable>
                        </View>
                      </Pressable>
                    )} />
                )
              )}

              {tab === 'ai' && (
                <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 0, gap: 10 }}>
                  <T size={12.5} color={C.sub}>Nano Banana designs artwork at this surface&apos;s exact proportions ({face.px[0]} × {face.px[1]}), in your brand colours, using your title and second line.</T>
                  <TextInput value={prompt} onChangeText={setPrompt} multiline placeholder="e.g. Deep navy with gold art-deco lines, the event name large in the centre" placeholderTextColor={C.muted} style={[ui.input, { height: 96, paddingTop: 8 }]} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{STYLES.map((s) => <Chip key={s} label={s} active={style === s} onPress={() => setStyle(s)} />)}</View>
                  <Button icon="zap" label="Generate artwork" onPress={generate} loading={!!busy} />
                </ScrollView>
              )}
            </View>

            {/* live preview at the surface's real proportions */}
            <View style={{ flex: 1, backgroundColor: '#E9EDF2', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>
              <SurfacePreview c={draft} aspect={aspect} width={Math.min(680, Math.round(500 * Math.min(1.6, aspect)))} />
              <T size={12} color={C.sub}>{face.w.toFixed(2)} × {face.h.toFixed(2)} m · shown at its real proportions</T>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: C.border }}>
            {sameCount > 1 && <><Toggle value={all} onChange={setAll} /><T size={13}>Show on all {sameCount} similar surfaces</T></>}
            <View style={{ flex: 1 }} />
            <Button kind="secondary" label="Cancel" onPress={onClose} />
            <Button label="Apply" onPress={() => { onApply(draft, all); onClose(); }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
