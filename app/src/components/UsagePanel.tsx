// Settings → AI usage: what the paid AI services have cost, by day and by what
// they were used for. Costs are estimates from list prices (server/src/usage.js).
// Charts are plain SVG: stacked daily bars (spend per service) and a donut (spend
// per feature group), each with a legend, hover details and a table view.
import { createElement, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { Card, Icon, T } from '@/components/ui';
import { api } from '@/lib/api';
import { C } from '@/lib/theme';

type Row = { day: string; service: string; cost: string | number; calls: number };
type Feature = { feature: string; cost: string | number; calls: number; images: number | null };
type Recent = { created_at: string; provider: string; model: string; feature: string; kind: string; input_tokens: number; output_tokens: number; images: number; cost_usd: string | null; ok: number };
type Usage = { days: number; provider: string | null; totals: { calls: number; failed: string | null; cost: string; images: string | null; tokens: string | null; unpriced: string | null }; daily: Row[]; features: Feature[]; recent: Recent[] };

// the validated categorical slots, in fixed order (dataviz reference palette, light)
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const OTHER = '#9AA1AB';
const GRID = '#E6E8EC';

// services: colour follows the service, whatever is in range
const SERVICES = [
  { key: 'openai text', label: 'GPT-4o (text)', colour: SERIES[0] },
  { key: 'openai image', label: 'OpenAI images', colour: SERIES[1] },
  { key: 'other', label: 'Other image services', colour: SERIES[2] },
];
const serviceOf = (s: string) => (s === 'openai text' || s === 'openai image' ? s : 'other');

// features fold into five fixed groups (+ Other), each always the same colour
const GROUPS = [
  { label: 'Concepts & photoreal renders', colour: SERIES[0], has: ['Concept renders', 'Photoreal previews'] },
  { label: 'Graphics & artwork', colour: SERIES[1], has: ['LED wall artwork', 'Branding graphics', 'Graphics', 'AI fabric textures'] },
  { label: 'Design planning', colour: SERIES[2], has: ['Design planning'] },
  { label: 'AI assistant', colour: SERIES[3], has: ['AI assistant'] },
  { label: 'Checks & model choosing', colour: SERIES[4], has: ['Checking concepts against the 3D', 'Choosing library models'] },
];
const groupOf = (f: string) => GROUPS.find((g) => g.has.includes(f));

const n = (v: unknown) => Number(v) || 0;
const money = (v: number) => (v === 0 ? '$0.00' : v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`);
const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v)));
const h = createElement;

export function UsagePanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    let live = true;
    api<Usage>(`/usage?days=${days}`).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [days]);

  const t = data?.totals;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <View style={{ gap: 2 }}>
          <T size={17} weight="600">AI usage</T>
          <T size={12.5} color={C.sub}>Pictures by {data?.provider || '…'}, text by GPT-4o. Costs are estimates from list prices.</T>
        </View>
        {/* the time range: one control, above the charts */}
        <View style={{ flexDirection: 'row', backgroundColor: C.bg, borderRadius: 8, padding: 3, gap: 2 }}>
          {[7, 30, 90].map((d) => (
            <Pressable key={d} onPress={() => setDays(d)} accessibilityLabel={`Last ${d} days`} style={{ paddingHorizontal: 12, height: 30, justifyContent: 'center', borderRadius: 6, backgroundColor: days === d ? C.surface : 'transparent' }}>
              <T size={12.5} weight="600" color={days === d ? C.blue : C.sub}>{d} days</T>
            </Pressable>
          ))}
        </View>
      </View>
      {error ? <Card><T color={C.red}>{error}</T></Card> : !data ? <ActivityIndicator color={C.blue} /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Tile label="Estimated spend" value={money(n(t?.cost))} note={n(t?.unpriced) ? `${n(t?.unpriced)} calls not priced` : `last ${data.days} days`} />
            <Tile label="AI calls" value={compact(n(t?.calls))} note={n(t?.failed) ? `${n(t?.failed)} failed` : 'none failed'} warn={n(t?.failed) > 0} />
            <Tile label="Images made" value={compact(n(t?.images))} note="concepts, renders, graphics" />
            <Tile label="Tokens" value={compact(n(t?.tokens))} note="text and image tokens" />
          </View>
          {Platform.OS !== 'web' ? <Card><T color={C.sub}>Charts are shown on the web app.</T></Card> : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              <Card style={{ flexGrow: 2, flexBasis: 520, gap: 10 }}>
                <T size={14} weight="600">Spend per day</T>
                <DailyBars rows={data.daily} days={data.days} />
              </Card>
              <Card style={{ flexGrow: 1, flexBasis: 340, gap: 10 }}>
                <T size={14} weight="600">Spend by what it was for</T>
                <FeatureDonut features={data.features} />
              </Card>
            </View>
          )}
          <Card style={{ gap: 10 }}>
            <Pressable onPress={() => setTable((x) => !x)} accessibilityLabel={table ? 'Hide the latest calls' : 'Show the latest calls'} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name={table ? 'chevron-down' : 'chevron-right'} size={16} color={C.sub} />
              <T size={14} weight="600">Latest calls</T>
              <T size={12} color={C.muted}>{data.recent.length} shown</T>
            </Pressable>
            {table && <RecentTable rows={data.recent} />}
          </Card>
        </>
      )}
    </View>
  );
}

function Tile({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 180, gap: 4 }}>
      <T size={12.5} color={C.sub}>{label}</T>
      <T size={26} weight="700">{value}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {warn ? <Icon name="alert-triangle" size={12} color={C.amber} /> : null}
        <T size={12} color={warn ? C.amber : C.muted}>{note}</T>
      </View>
    </Card>
  );
}

function Legend({ items }: { items: { label: string; colour: string; value?: string }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {items.map((i) => (
        <View key={i.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: i.colour }} />
          <T size={12} color={C.sub}>{i.label}{i.value ? <T size={12} weight="600" color={C.text}>  {i.value}</T> : null}</T>
        </View>
      ))}
    </View>
  );
}

/** Stacked bars: one per day, a segment per service, with a 2 px gap between segments. */
function DailyBars({ rows, days }: { rows: Row[]; days: number }) {
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    const out: { day: string; parts: number[]; calls: number }[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      // the server counts days by the clock where it runs (this computer's); so must the chart, not UTC
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, parts = [0, 0, 0];
      let calls = 0;
      for (const r of rows.filter((x) => x.day === key)) { parts[SERVICES.findIndex((s) => s.key === serviceOf(r.service))] += n(r.cost); calls += n(r.calls); }
      out.push({ day: key, parts, calls });
    }
    return out;
  }, [rows, days]);
  const max = Math.max(0.01, ...series.map((s) => s.parts.reduce((a, b) => a + b, 0)));
  const nice = (() => { const m = max * 1.1, p = 10 ** Math.floor(Math.log10(m)), s = [1, 2, 2.5, 5, 10].find((k) => k * p >= m)! * p; return s; })();
  const H = 200, left = 46, bottom = 22, plotW = Math.max(120, width - left - 8), slot = plotW / series.length, bar = Math.max(3, Math.min(22, slot * 0.62));
  const y = (v: number) => H - bottom - (v / nice) * (H - bottom - 8);
  const totals = SERVICES.map((s, k) => ({ ...s, total: series.reduce((a, d) => a + d.parts[k], 0) }));
  const hv = hover != null ? series[hover] : null;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: 10 }}>
      <Legend items={totals.map((s) => ({ label: s.label, colour: s.colour, value: money(s.total) }))} />
      <View>
        {h('svg', { width, height: H, role: 'img', 'aria-label': `Estimated AI spend per day over ${days} days, by service`, style: { display: 'block', overflow: 'visible' } },
          // recessive grid and axis: four levels
          [0, 0.25, 0.5, 0.75, 1].map((f) => h('g', { key: f },
            h('line', { x1: left, x2: left + plotW, y1: y(nice * f), y2: y(nice * f), stroke: GRID, strokeWidth: 1 }),
            h('text', { x: left - 6, y: y(nice * f) + 4, textAnchor: 'end', fontSize: 10.5, fill: C.muted, fontFamily: 'system-ui, sans-serif' }, nice < 0.1 && f > 0 ? `$${(nice * f).toFixed(3)}` : money(nice * f)))),
          series.map((d, i) => {
            const cx = left + slot * i + slot / 2;
            let base = H - bottom;
            const segs = d.parts.map((v, k) => {
              if (v <= 0) return null;
              const hgt = Math.max(1.5, (v / nice) * (H - bottom - 8));
              const top = base - hgt;
              const isTop = d.parts.slice(k + 1).every((x) => x <= 0);
              const el = h('rect', { key: k, x: cx - bar / 2, y: top, width: bar, height: Math.max(0.5, hgt - (isTop ? 0 : 2)), rx: isTop ? Math.min(4, bar / 2) : 0, fill: SERVICES[k].colour });
              base = top;
              return el;
            });
            return h('g', { key: d.day },
              segs,
              // a generous hit target over the whole day column
              h('rect', { x: left + slot * i, y: 0, width: slot, height: H - bottom, fill: hover === i ? 'rgba(14,42,74,.05)' : 'transparent', onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null) }));
          }),
          // a few dates along the bottom
          series.map((d, i) => (i % Math.ceil(series.length / 6) === 0 || i === series.length - 1)
            ? h('text', { key: `l${d.day}`, x: left + slot * i + slot / 2, y: H - 6, textAnchor: 'middle', fontSize: 10.5, fill: C.muted, fontFamily: 'system-ui, sans-serif' }, new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))
            : null))}
        {hv && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: Math.min(width - 200, Math.max(0, left + slot * hover! + slot / 2 - 100)), width: 200, backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 10, gap: 4, boxShadow: '0 8px 22px rgba(20,30,50,.16)' } as any}>
            <T size={12} weight="600">{new Date(`${hv.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</T>
            {SERVICES.map((s, k) => (
              <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.colour }} />
                <T size={11.5} color={C.sub} style={{ flex: 1 }}>{s.label}</T>
                <T size={11.5} weight="600">{money(hv.parts[k])}</T>
              </View>
            ))}
            <T size={11} color={C.muted}>{hv.calls} calls</T>
          </View>
        )}
      </View>
    </View>
  );
}

/** A donut of spend per feature group (five fixed groups + Other); by calls when nothing was priced. */
function FeatureDonut({ features }: { features: Feature[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const byCost = features.some((f) => n(f.cost) > 0);
  const slices = useMemo(() => {
    const out = [...GROUPS.map((g) => ({ label: g.label, colour: g.colour, value: 0, calls: 0, parts: [] as string[] })), { label: 'Other', colour: OTHER, value: 0, calls: 0, parts: [] as string[] }];
    for (const f of features) {
      const i = Math.max(0, GROUPS.indexOf(groupOf(f.feature)!));
      const s = groupOf(f.feature) ? out[i] : out[out.length - 1];
      s.value += byCost ? n(f.cost) : n(f.calls); s.calls += n(f.calls); s.parts.push(f.feature);
    }
    return out.filter((s) => s.value > 0);
  }, [features, byCost]);
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (!total) return <T color={C.sub}>No AI calls in this period yet.</T>;
  const R = 78, r = 50, cx = 90, cy = 90;
  let a0 = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const a1 = a0 + (s.value / total) * Math.PI * 2, gap = slices.length > 1 ? 0.012 : 0; // a hairline of surface between slices
    const p = (rad: number, ang: number) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = p(R, a0 + gap), [x1, y1] = p(R, a1 - gap), [x2, y2] = p(r, a1 - gap), [x3, y3] = p(r, a0 + gap), big = a1 - a0 > Math.PI ? 1 : 0;
    const d = slices.length === 1
      ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`
      : `M ${x0} ${y0} A ${R} ${R} 0 ${big} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${big} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return d;
  });
  const hv = hover != null ? slices[hover] : null;
  const fmt = (v: number) => (byCost ? money(v) : `${v} calls`);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <View>
          {h('svg', { width: 180, height: 180, role: 'img', 'aria-label': `AI ${byCost ? 'spend' : 'calls'} by feature` },
            slices.map((s, i) => h('path', { key: s.label, d: arcs[i], fill: s.colour, opacity: hover == null || hover === i ? 1 : 0.45, onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null), style: { cursor: 'default' } })),
            h('text', { x: cx, y: cy - 2, textAnchor: 'middle', fontSize: 17, fontWeight: 700, fill: C.text, fontFamily: 'system-ui, sans-serif' }, hv ? fmt(hv.value) : fmt(total)),
            h('text', { x: cx, y: cy + 16, textAnchor: 'middle', fontSize: 10.5, fill: C.muted, fontFamily: 'system-ui, sans-serif' }, hv ? `${Math.round((hv.value / total) * 100)}%` : byCost ? 'estimated' : 'no costs yet'))}
        </View>
        {/* the legend carries the numbers, so no slice is read by colour alone */}
        <View style={{ flex: 1, minWidth: 150, gap: 8 }}>
          {slices.map((s, i) => (
            <Pressable key={s.label} onHoverIn={() => setHover(i)} onHoverOut={() => setHover(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: hover == null || hover === i ? 1 : 0.6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.colour }} />
              <T size={12.5} color={C.text} style={{ flex: 1 }} numberOfLines={1}>{s.label}</T>
              <T size={12.5} weight="600">{fmt(s.value)}</T>
              <T size={11.5} color={C.muted} style={{ width: 34, textAlign: 'right' }}>{Math.round((s.value / total) * 100)}%</T>
            </Pressable>
          ))}
        </View>
      </View>
      {hv && <T size={11.5} color={C.sub}>{hv.label}: {hv.parts.join(', ')} · {hv.calls} calls</T>}
    </View>
  );
}

function RecentTable({ rows }: { rows: Recent[] }) {
  if (!rows.length) return <T color={C.sub}>No calls yet.</T>;
  const cols = [['When', 1.3], ['Service', 1.3], ['What for', 2], ['Tokens', 0.9], ['Images', 0.7], ['Cost', 0.8], ['', 0.4]] as const;
  return (
    <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', backgroundColor: C.bg, paddingHorizontal: 10, paddingVertical: 7 }}>
        {cols.map(([c, f]) => <T key={c || 'ok'} size={11.5} weight="600" color={C.sub} style={{ flex: f }}>{c}</T>)}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.border, alignItems: 'center' }}>
          <T size={12} color={C.sub} style={{ flex: 1.3 }}>{new Date(r.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</T>
          <T size={12} style={{ flex: 1.3 }} numberOfLines={1}>{r.provider === 'openai' ? r.model : r.provider}</T>
          <T size={12} style={{ flex: 2 }} numberOfLines={1}>{r.feature}</T>
          <T size={12} color={C.sub} style={{ flex: 0.9 }}>{compact(n(r.input_tokens) + n(r.output_tokens))}</T>
          <T size={12} color={C.sub} style={{ flex: 0.7 }}>{r.images || '–'}</T>
          <T size={12} weight="600" style={{ flex: 0.8 }}>{r.cost_usd == null ? 'n/a' : money(n(r.cost_usd))}</T>
          <View style={{ flex: 0.4 }}><Icon name={r.ok ? 'check-circle' : 'x-circle'} size={13} color={r.ok ? C.green : C.red} /></View>
        </View>
      ))}
    </View>
  );
}
