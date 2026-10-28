import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import ScenePreview from '@/components/three/ScenePreview';
import ConceptRenderer, { type ConceptResult } from '@/components/three/ConceptRenderer';
import { Badge, Button, Card, Chip, ErrorNote, Field, Icon, PageHeader, T, Toggle } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { C } from '@/lib/theme';
import type { BrandKit, Check, Plan, Scene, Venue } from '@/lib/types';

const KEEP = 'novira.new.designs';
const kept = (): { result: Result; brief: string } | null => { try { return JSON.parse(sessionStorage.getItem(KEEP) || 'null'); } catch { return null; } };
type Result = { renderId?: number; source: string; options: Option[]; plan?: Plan & { design?: Design }; venue?: { id: number; name: string } | null; venueNote?: VenueNote; art?: string | null };
// concept: the picture of the design, rendered from its 3D scene; conceptCheck: how closely it matched (or why it failed)
type Option = { layout: Plan['layout']; scene: Scene; stats: Scene['stats']; checks: Check[]; concept?: string | null; conceptCheck?: { matches?: boolean; issues?: string[]; error?: string } };
type Design = { concept: string; theme: { name: string; palette: { name: string; hex: string }[] }; venueMention: string | null };
type VenueNote = { mention: string; match?: { id: number; name: string }; missing?: boolean } | null;
// what the designer is doing while the designs are made (about a minute)
const STEPS = ['Reading your brief…', 'Designing the concept and theme…', 'Laying out seating in the room…', 'Building the design in 3D: fabrics, drapes, light…', 'Sourcing props and painting the branding…', 'Final touches…'];
// a venue named in the brief ("in rotana") that is in the library
const venueWords = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !['hotel', 'venue', 'hall', 'room', 'ballroom', 'garden', 'gardens'].includes(w));
const venueIn = (brief: string, list: Venue[]) => { const b = venueWords(brief); return list.find((v) => venueWords(v.name).some((w) => b.some((x) => x.startsWith(w) || w.startsWith(x)))) || null; };
const TYPES = ['gala', 'wedding', 'conference', 'dinner', 'launch', 'party', 'exhibition'];
const LAYOUTS: [Plan['layout'] | '', string][] = [['', 'Let AI choose'], ['banquet', 'Round tables'], ['feast', 'Long tables'], ['theater', 'Theatre rows'], ['cocktail', 'Cocktail / lounge']];
const LAYOUT_NAME: Record<string, string> = { banquet: 'Classic banquet', feast: 'Long feast', theater: 'Theatre', cocktail: 'Cocktail lounge' };
const guessGuests = (b = '') => b.match(/(\d{2,4})\s*(guests|people|pax)/i)?.[1];

export default function NewMockup() {
  const params = useLocalSearchParams<{ brief?: string; venueId?: string }>();
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [venueId, setVenueId] = useState<number | null>(params.venueId ? Number(params.venueId) : null);
  const [kitId, setKitId] = useState<number | null>(null);
  const [name, setName] = useState(() => (params.brief ? '' : kept()?.result?.plan?.eventName || ''));
  const [type, setType] = useState(''); // '' = the AI reads it from the brief
  const [guests, setGuests] = useState(() => guessGuests(params.brief) || '120');
  const [brief, setBriefText] = useState(params.brief || kept()?.brief || '');
  // a venue the user clicked wins; otherwise one named in the brief is picked for them
  const [venueChosen, setVenueChosen] = useState(!!params.venueId);
  // where it happens: from the brief (auto), a plain hall (none), the open air (outdoor), or one of the user's venues
  const [venueMode, setVenueMode] = useState<'auto' | 'none' | 'outdoor' | 'venue'>(params.venueId ? 'venue' : 'auto');
  const [detected, setDetected] = useState<number | null>(null);
  const setBrief = (b: string) => {
    setBriefText(b);
    const g = guessGuests(b); if (g) setGuests(g);
    const v = !venueChosen && venues ? venueIn(b, venues) : null;
    if (v && venueMode === 'auto') { setVenueId(v.id); setDetected(v.id); }
  };
  const [layout, setLayout] = useState<Plan['layout'] | ''>('');
  const [include, setInclude] = useState({ stage: true, ledScreen: true, bar: false, danceFloor: false });
  const [touched, setTouched] = useState<Record<string, boolean>>({}); // only these are the user's decision

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the generated designs survive "Edit brief" and a page refresh (kept for this browser tab) until new ones are generated
  const [result, setResultState] = useState<Result | null>(() => (params.brief ? null : kept()?.result || null));
  // takes a result or an update of the latest one (concepts arrive one by one and must not overwrite each other)
  const setResult = (r: Result | null | ((prev: Result | null) => Result | null)) => setResultState((prev) => {
    const next = typeof r === 'function' ? r(prev) : r;
    try { if (next) sessionStorage.setItem(KEEP, JSON.stringify({ result: next, brief })); else sessionStorage.removeItem(KEEP); } catch { /* not kept */ }
    return next;
  });
  const [editing, setEditing] = useState(false); // looking at the brief while the designs are kept
  const [picked, setPicked] = useState(0);
  // per card: its concept, or its live 3D — one live 3D at a time (several at once overwhelm a laptop's GPU)
  const [show3d, setShow3dState] = useState<Record<number, boolean>>({});
  const setShow3d = (next: Record<number, boolean>) => {
    const on = Object.keys(next).find((k) => next[Number(k)] && !show3d[Number(k)]);
    setShow3dState(on != null ? Object.fromEntries(Object.keys(next).map((k) => [k, k === on])) : next);
  };
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 9000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    api<Venue[]>('/venues').then(setVenues).catch(() => setVenues([]));
    api<BrandKit[]>('/brand-kits').then(setKits).catch(() => {}); // a brand kit is opt-in: its colours would override the theme
  }, []);

  const venue = venues?.find((v) => v.id === venueId) || null;
  const kit = kits.find((k) => k.id === kitId);

  const generate = async () => {
    setBusy(true); setError(null); setStep(0); // the current designs stay on screen until the new ones are ready
    try {
      const colors = kit?.colors?.length ? { accent: kit.colors[0].hex, linen: kit.colors[1]?.hex, stage: kit.colors[2]?.hex } : undefined;
      const chosen = Object.fromEntries(Object.entries(include).filter(([k]) => touched[k]));
      const r = await api('/projects/generate', { body: { brief, venueId: venueMode === 'venue' ? venueId : null, venueMode, venueChosen, guests: Number(guests) || undefined, eventType: type || undefined, eventName: name || undefined, include: Object.keys(chosen).length ? chosen : undefined, colors, ...(layout ? { layout } : {}) } });
      if (layout) r.options = [r.options.find((o: Option) => o.layout === layout) || r.options[0], ...r.options.filter((o: Option) => o.layout !== layout)].slice(0, 3);
      if (r.venue && r.venue.id !== venueId) setVenueId(r.venue.id);
      if (!r.venue) setVenueId(null);
      setResult({ ...r, renderId: (result?.renderId || 0) + 1 }); setPicked(0); setShow3d({}); setEditing(false);
      if (!name) setName(r.plan?.eventName || 'New event');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const create = async () => {
    if (!result) return;
    setCreating(true); setError(null);
    try {
      const opt = result.options[picked];
      const p = await api('/projects', { body: { name: name || 'New event', venueId: result.venue?.id ?? null, brief, scene: opt.scene, concept: opt.concept || undefined, eventType: type || result.plan?.eventType, guests: Number(guests), brandKitId: kitId } });
      try { sessionStorage.removeItem(KEEP); } catch { /* nothing kept */ } // used: the next new mockup starts fresh
      router.replace(`/editor/${p.id}`);
    } catch (e: any) { setError(e.message); setCreating(false); }
  };

  if (result && !editing) return (
    <View>
      <PageHeader title={`3 designs ready${name ? ` for ${name}` : ''}`} subtitle={result.source === 'gpt' ? 'Planned by GPT-4o and placed by the layout solver.' : 'Planned by the built-in rules (add an OpenAI key for GPT-4o).'}
        right={<><Button kind="secondary" icon="chevron-left" label="Edit brief" onPress={() => setEditing(true)} /><Button kind="secondary" icon="refresh-cw" label="Regenerate" onPress={generate} loading={busy} /></>} />
      <ErrorNote text={error} />
      {result.plan?.design?.concept ? (
        <Card style={{ marginBottom: 16, flexDirection: 'row', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {result.art ? <Image source={{ uri: fileUrl(result.art) }} style={{ width: 160, height: 90, borderRadius: 8, backgroundColor: C.bg }} resizeMode="cover" /> : null}
          <View style={{ flex: 1, minWidth: 260, gap: 6 }}>
            <T size={12} weight="600" color={C.blue}>{result.plan.design.theme?.name ? `THEME · ${result.plan.design.theme.name.toUpperCase()}` : 'DESIGN CONCEPT'}</T>
            <T size={14.5} color={C.text}>{result.plan.design.concept}</T>
            {result.plan.design.theme?.palette?.length ? (
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                {result.plan.design.theme.palette.map((c) => (
                  <View key={c.hex + c.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.hex, borderWidth: 1, borderColor: 'rgba(0,0,0,.12)' }} />
                    <T size={11.5} color={C.sub}>{c.name}</T>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}
      {result.venueNote?.missing ? (
        <Card style={{ marginBottom: 16, flexDirection: 'row', gap: 14, alignItems: 'center', flexWrap: 'wrap', borderColor: '#F3D9A4', backgroundColor: '#FFFBF2' }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FCEBC7', alignItems: 'center', justifyContent: 'center' }}><Icon name="map-pin" size={18} color={C.amber} /></View>
          <View style={{ flex: 1, minWidth: 240, gap: 2 }}>
            <T size={14} weight="600">“{result.venueNote.mention}” isn’t in your venues yet</T>
            <T size={12.5} color={C.sub}>Upload its 3D model (.glb) and the mockup is built in the real room, with its true walls, size and finishes. These designs use {result.venue ? result.venue.name : 'a standard hall'} for now.</T>
          </View>
          <Button icon="upload" label={`Upload ${result.venueNote.mention}`} onPress={() => router.push('/venues')} />
        </Card>
      ) : result.venueNote?.match ? (
        <View style={{ marginBottom: 12, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Icon name="map-pin" size={13} color={C.blue} />
          <T size={12.5} color={C.sub}>Built in <T size={12.5} weight="600" color={C.text}>{result.venueNote.match.name}</T>, the venue named in your brief.</T>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
        {result.options.map((o, i) => (
          <Pressable key={i} onPress={() => setPicked(i)} style={{ flexGrow: 1, flexBasis: 320, borderRadius: 14, borderWidth: picked === i ? 2 : 1, borderColor: picked === i ? C.blue : C.border, backgroundColor: C.surface, overflow: 'hidden' }}>
            <View style={{ height: 260 }}>
              {o.concept && !show3d[i]
                ? <Image source={{ uri: fileUrl(o.concept) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                : show3d[i] || (i === picked && !Object.values(show3d).some(Boolean))
                  ? <ScenePreview scene={o.scene} venue={venues?.find((v) => v.id === result.venue?.id) || null} compact />
                  : <View style={{ flex: 1, backgroundColor: '#11151D' }} />}
              {/* the concept is rendered from this very 3D scene, so the two are the same design */}
              {!o.concept && !o.conceptCheck?.error && (
                <View style={{ position: 'absolute', bottom: 12, left: 12, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(14,18,26,.72)', borderRadius: 8, paddingHorizontal: 10, height: 30 }}>
                  <ActivityIndicator size="small" color="#fff" /><T size={12} color="#fff">Rendering the concept from this 3D…</T>
                </View>
              )}
              {!o.concept && o.conceptCheck?.error && !show3d[i] && (
                <View style={{ position: 'absolute', bottom: 12, left: 12, right: 12, gap: 8, backgroundColor: 'rgba(14,18,26,.82)', borderRadius: 10, padding: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                    <Icon name="alert-triangle" size={13} color="#F5C451" />
                    <T size={11.5} color="#fff" style={{ flex: 1 }}>{o.conceptCheck.error}</T>
                  </View>
                  <Pressable onPress={() => setResult((prev) => (prev ? { ...prev, renderId: (prev.renderId || 0) + 1, options: prev.options.map((x) => (x.conceptCheck?.error ? { ...x, conceptCheck: undefined } : x)) } : prev))}
                    accessibilityLabel="Try rendering the concepts again" style={{ alignSelf: 'flex-start', paddingHorizontal: 10, height: 26, borderRadius: 6, justifyContent: 'center', backgroundColor: '#fff' }}>
                    <T size={11.5} weight="600" color={C.blue}>Try again</T>
                  </Pressable>
                </View>
              )}
              {o.concept && !show3d[i] && o.conceptCheck && (
                <View style={{ position: 'absolute', bottom: 12, left: 12, right: 12, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(14,18,26,.72)', borderRadius: 8, paddingHorizontal: 10, minHeight: 28, paddingVertical: 4, flexShrink: 1 }}>
                    <Icon name={o.conceptCheck.matches === false ? 'alert-triangle' : 'check-circle'} size={13} color={o.conceptCheck.matches === false ? '#F5C451' : '#7BD88F'} />
                    <T size={11.5} color="#fff" numberOfLines={2}>{o.conceptCheck.matches === false ? `Differs from the 3D: ${o.conceptCheck.issues?.[0] || ''}` : 'Rendered from the 3D: same design'}</T>
                  </View>
                </View>
              )}
              {o.concept || !show3d[i] ? (
                <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', backgroundColor: 'rgba(255,255,255,.92)', borderRadius: 8, padding: 3, gap: 2 }}>
                  {([['Concept', false], ['3D', true]] as const).filter(([, v]) => v || o.concept).map(([l, v]) => (
                    <Pressable key={l} onPress={() => setShow3d({ ...show3d, [i]: v })} style={{ paddingHorizontal: 10, height: 24, borderRadius: 6, justifyContent: 'center', backgroundColor: !!show3d[i] === v ? C.blue : 'transparent' }}>
                      <T size={11.5} weight="600" color={!!show3d[i] === v ? '#fff' : C.sub}>{l}</T>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={{ position: 'absolute', top: 12, left: 12, width: 32, height: 32, borderRadius: 8, backgroundColor: picked === i ? C.blue : '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <T weight="700" color={picked === i ? '#fff' : C.text}>{'ABC'[i]}</T>
              </View>
            </View>
            <View style={{ padding: 18, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T size={17} weight="600">{o.layout === 'banquet' && o.scene.plan?.seatsPerTable === 10 ? 'Grand rounds of 10' : o.layout === 'banquet' ? `Rounds of ${o.scene.plan?.seatsPerTable || 8}` : LAYOUT_NAME[o.layout]}</T>
                {i === 0 && <Badge label="Best fit" />}
              </View>
              <T color={C.sub}>{o.stats.seats} {o.layout === 'cocktail' ? 'guests standing' : 'seats'}{o.stats.tables ? ` · ${o.stats.tables} tables` : ''}{o.stats.rows ? ` · ${o.stats.rows} rows` : ''}</T>
              {o.checks.map((c, j) => (
                <View key={j} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Icon name={c.level === 'ok' ? 'check-circle' : 'alert-triangle'} size={13} color={c.level === 'ok' ? C.green : C.amber} />
                  <T size={12.5} color={c.level === 'ok' ? C.sub : C.amber}>{c.text}</T>
                </View>
              ))}
            </View>
          </Pressable>
        ))}
      </View>
      <ConceptRenderer
        venue={venues?.find((v) => v.id === result.venue?.id) || null}
        jobs={result.options.map((o, i) => ({ key: `${result.renderId || 0}-${i}`, scene: o.scene, plan: result.plan })).filter((_, i) => !result.options[i].concept && !result.options[i].conceptCheck?.error)}
        onResult={(key, r: ConceptResult) => {
          const i = Number(key.split('-')[1]);
          setResult((prev) => (prev ? { ...prev, options: prev.options.map((o, k) => (k === i ? { ...o, concept: r.url, conceptCheck: { matches: r.matches, issues: r.issues, error: r.error } } : o)) } : prev));
        }} />
      <Card style={{ marginTop: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Project name" value={name} onChangeText={setName} style={{ flex: 1, minWidth: 260 }} />
        <Button icon="arrow-right" label={`Open design ${'ABC'[picked]} in editor`} onPress={create} loading={creating} style={{ height: 40 }} />
      </Card>
    </View>
  );

  return (
    <View>
      <PageHeader title="New mockup" subtitle="Describe the event. The AI plans the layout, the solver places every table and chair." />
      {result && (
        // the designs are still there: edit the brief and regenerate, or go straight back to them
        <Card style={{ marginBottom: 16, flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: '#9CC7E8', backgroundColor: '#F2F8FD' }}>
          {result.options[0]?.concept ? <Image source={{ uri: fileUrl(result.options[0].concept) }} style={{ width: 96, height: 54, borderRadius: 6 }} resizeMode="cover" /> : null}
          <View style={{ flex: 1, minWidth: 220 }}>
            <T size={13.5} weight="600">Your 3 designs{result.plan?.design?.theme?.name ? ` · ${result.plan.design.theme.name}` : ''} are kept</T>
            <T size={12} color={C.sub}>Change the brief and generate again to replace them, or go back to them as they are.</T>
          </View>
          <Button icon="arrow-left" label="Back to your 3 designs" onPress={() => setEditing(false)} />
        </Card>
      )}
      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Card style={{ flexGrow: 2, flexBasis: 560, gap: 16 }}>
          <T size={17} weight="600">Tell us about the event</T>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Event name" value={name} onChangeText={setName} placeholder="e.g. Apoli Gala Dinner" style={{ flex: 2, minWidth: 220 }} />
            <Field label="Guests" value={guests} onChangeText={setGuests} keyboardType="numeric" style={{ flex: 1, minWidth: 100 }} />
          </View>
          <View style={{ gap: 8 }}>
            <T size={12.5} weight="600" color={C.sub}>Event type</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip label="Let AI decide" active={!type} onPress={() => setType('')} />
              {TYPES.map((t) => <Chip key={t} label={t[0].toUpperCase() + t.slice(1)} active={type === t} onPress={() => setType(type === t ? '' : t)} />)}
            </View>
          </View>
          <Field label="Describe it in your own words" value={brief} onChangeText={setBrief} multiline
            placeholder="Elegant corporate gala. Round tables of 8 facing a wide stage with an LED wall showing our logo. Gold and white theme, warm uplighting, a bar on the left wall." />
          <View style={{ gap: 8 }}>
            <T size={12.5} weight="600" color={C.sub}>Layout</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{LAYOUTS.map(([v, l]) => <Chip key={l} label={l} active={layout === v} onPress={() => setLayout(v)} />)}</View>
          </View>
          <View style={{ gap: 10 }}>
            <T size={12.5} weight="600" color={C.sub}>Must include <T size={11.5} color={C.muted}>· switch only what you insist on; the AI decides the rest from your brief</T></T>
            <View style={{ flexDirection: 'row', gap: 22, flexWrap: 'wrap' }}>
              {([['stage', 'Stage'], ['ledScreen', 'LED wall'], ['bar', 'Bar'], ['danceFloor', 'Dance floor']] as const).map(([k, l]) => (
                <View key={k} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Toggle value={(include as any)[k]} onChange={(v) => { setInclude({ ...include, [k]: v }); setTouched({ ...touched, [k]: true }); }} /><T size={13} color={touched[k] ? C.text : C.sub}>{l}{touched[k] ? '' : ' · auto'}</T></View>
              ))}
            </View>
          </View>
        </Card>

        <View style={{ flexGrow: 1, flexBasis: 320, gap: 16 }}>
          <Card style={{ gap: 10 }}>
            <T size={15} weight="600">Where is it?</T>
            {([['auto', 'zap', 'Let AI decide', 'From the brief: a venue it names, the open air for an outdoor event, else a plain hall'],
              ['outdoor', 'sun', 'Outdoors', 'Open air — lawn, beach, park or grounds, sized for the guests'],
              ['none', 'square', 'No venue', 'A plain hall, sized for the guests']] as const).map(([k, ic, label, note]) => (
              <Pressable key={k} onPress={() => { setVenueMode(k); setVenueChosen(k !== 'auto'); setDetected(null); }} accessibilityLabel={label}
                style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: venueMode === k ? C.blue : C.border, backgroundColor: venueMode === k ? '#F2F8FD' : C.surface }}>
                <Icon name={ic} size={16} color={venueMode === k ? C.blue : C.sub} />
                <View style={{ flex: 1 }}><T size={13} weight="600">{label}</T><T size={11.5} color={C.sub}>{note}</T></View>
              </Pressable>
            ))}
            {!venues ? <ActivityIndicator color={C.blue} /> : venues.length ? <T size={12} weight="600" color={C.sub} style={{ marginTop: 4 }}>YOUR VENUES</T> : null}
            {(venues || []).map((v) => {
              const on = venueMode === 'venue' && venueId === v.id;
              return (
                <Pressable key={v.id} onPress={() => { setVenueMode('venue'); setVenueId(v.id); setVenueChosen(true); setDetected(null); }} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: on ? C.blue : C.border, backgroundColor: on ? '#F2F8FD' : C.surface }}>
                  <Icon name="map-pin" size={16} color={on ? C.blue : C.sub} />
                  <View style={{ flex: 1 }}>
                    <T size={13} weight="600">{v.name}</T>
                    <T size={11.5} color={v.analysis ? C.sub : C.amber}>{v.analysis ? `${v.analysis.size[0]} × ${v.analysis.size[2]} m` : 'Not measured yet — open it once first'}{detected === v.id ? ' · named in your brief' : ''}</T>
                  </View>
                  {!v.analysis && <Button small kind="soft" label="Analyse" onPress={() => router.push(`/venues/${v.id}`)} />}
                </Pressable>
              );
            })}
            <Button kind="secondary" icon="upload" label={venues?.length ? 'Upload another venue' : 'Upload a venue'} onPress={() => router.push('/venues')} />
          </Card>
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={15} weight="600">Brand kit</T><Pressable onPress={() => router.push('/brand')}><T size={12.5} color={C.blue} weight="600">Manage</T></Pressable></View>
            {kits.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Chip label="None" active={!kitId} onPress={() => setKitId(null)} />
                {kits.map((k) => <Chip key={k.id} label={k.name} active={kitId === k.id} onPress={() => setKitId(k.id)} />)}
              </View>
            ) : <T size={12.5} color={C.sub}>Optional: add a brand kit so colours and logo are applied automatically.</T>}
            {kit && <View style={{ flexDirection: 'row', gap: 6 }}>{kit.colors.map((c) => <View key={c.hex} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.hex, borderWidth: 1, borderColor: C.border }} />)}</View>}
          </Card>
          <ErrorNote text={error} />
          <Button icon="zap" label={busy ? 'Designing your event…' : result ? 'Generate 3 new designs' : 'Generate 3 designs'} onPress={generate} loading={busy} disabled={!brief.trim() && !guests} style={{ height: 46 }} />
          {busy && (
            <View style={{ gap: 6, paddingHorizontal: 4 }}>
              {STEPS.map((x, i) => (
                <View key={x} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', opacity: i > step ? 0.4 : 1 }}>
                  {i < step ? <Icon name="check" size={13} color={C.green} /> : i === step ? <ActivityIndicator size="small" color={C.blue} /> : <Icon name="circle" size={11} color={C.muted} />}
                  <T size={12.5} color={i === step ? C.text : C.sub}>{x}</T>
                </View>
              ))}
            </View>
          )}
          {venueMode === 'venue' && venue && !venue.analysis && <T size={12} color={C.amber}>This venue hasn’t been measured yet, so a default 30 × 30 m hall will be used.</T>}
        </View>
      </View>
    </View>
  );
}
