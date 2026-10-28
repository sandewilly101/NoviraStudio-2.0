// The floor plan as a measured drawing, built from the scene itself (not a
// picture of it): walls with overall dimensions, every table, chair, stage,
// dance floor, screen and bar as its real footprint, rigging overhead dashed,
// table numbers, a metre grid and a title block with the counts. One plan
// model, three outputs: SVG (preview and PNG), PDF at a true printing scale
// (A3), and DXF for AutoCAD and other CAD tools (save as DWG from there).
import type { Scene, SceneObject } from './types';

type P = [number, number]; // metres on the floor: x across, y = scene z (towards the guests)
export type Layer = 'walls' | 'grid' | 'stage' | 'tables' | 'seating' | 'av' | 'decor' | 'overhead' | 'dims' | 'text';
export type Shape =
  | { k: 'poly'; pts: P[]; closed?: boolean; layer: Layer; fill?: string; dash?: boolean; weight?: number }
  | { k: 'circle'; c: P; r: number; layer: Layer; fill?: string; dash?: boolean; weight?: number }
  | { k: 'text'; at: P; text: string; size: number; layer: Layer; anchor?: 'start' | 'middle' | 'end'; bold?: boolean }
  | { k: 'dim'; a: P; b: P; offset: P; text: string; layer: Layer };
export type Plan = {
  shapes: Shape[]; bounds: { minX: number; minY: number; maxX: number; maxY: number };
  title: string; venue: string; date: string; facts: [string, string][];
};

const COLOURS: Record<Layer, string> = { walls: '#1B2430', grid: '#E3E8EF', stage: '#5B6B7F', tables: '#24313F', seating: '#6C7A8B', av: '#0B6BCB', decor: '#3E8A5C', overhead: '#B0473E', dims: '#0B6BCB', text: '#1B2430' };
const FILLS = { stage: '#E6EBF1', dance: '#F3EEDC', table: '#FFFFFF', screen: '#0B6BCB', bar: '#EFE7DA' };
const m = (v: number) => `${(Math.round(v * 100) / 100).toFixed(v % 1 ? (Math.round(v * 100) % 10 ? 2 : 1) : 0)} m`;

/** The corners of an object's footprint, turned as it stands. */
function footprint(o: SceneObject, w = o.size[0], d = o.size[2]): P[] {
  const a = o.rotation?.[1] || 0, c = Math.cos(a), s = Math.sin(a), [x, , z] = o.position;
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as P[]).map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
}
/** The line along an object's width (a screen, a curtain), at its front face. */
function spanLine(o: SceneObject): P[] { const f = footprint(o, o.size[0], 0.0001); return [f[0], f[1]]; }

export function buildPlan(scene: Scene, room: { minX: number; maxX: number; minZ: number; maxZ: number }, meta: { title: string; venue: string }): Plan {
  const S: Shape[] = [], objs = scene.objects;
  const W = room.maxX - room.minX, D = room.maxZ - room.minZ;
  // a light metre grid, every fifth line a little stronger
  for (let x = Math.ceil(room.minX); x <= room.maxX; x++) S.push({ k: 'poly', pts: [[x, room.minZ], [x, room.maxZ]], layer: 'grid', weight: x % 5 ? 0.5 : 1 });
  for (let z = Math.ceil(room.minZ); z <= room.maxZ; z++) S.push({ k: 'poly', pts: [[room.minX, z], [room.maxX, z]], layer: 'grid', weight: z % 5 ? 0.5 : 1 });
  // the walls, and the room's overall size
  S.push({ k: 'poly', pts: [[room.minX, room.minZ], [room.maxX, room.minZ], [room.maxX, room.maxZ], [room.minX, room.maxZ]], closed: true, layer: 'walls', weight: 3 });
  S.push({ k: 'dim', a: [room.minX, room.minZ], b: [room.maxX, room.minZ], offset: [0, -1.2], text: m(W), layer: 'dims' });
  S.push({ k: 'dim', a: [room.minX, room.minZ], b: [room.minX, room.maxZ], offset: [-1.2, 0], text: m(D), layer: 'dims' });

  // a label sits inside its object: smaller if the words would run past its edges
  const label = (o: SceneObject, text: string, size = 0.32, dy = 0) => {
    const f = footprint(o), across = Math.max(...f.map((p) => p[0])) - Math.min(...f.map((p) => p[0]));
    S.push({ k: 'text', at: [o.position[0], o.position[2] + dy], text, size: Math.max(0.12, Math.min(size, (across * 0.9) / (text.length * 0.55))), layer: 'text', anchor: 'middle' });
  };
  const tables = objs.filter((o) => o.type === 'round_table' || o.type === 'long_table' || o.type === 'cocktail_table');
  const seatsAt = (t: SceneObject) => objs.filter((o) => o.type === 'chair' && o.group === t.id).length;
  // tables numbered as a guest list would: from the stage end, left to right, row by row
  const numbered = [...tables].sort((a, b) => (Math.round(a.position[2] / 1.5) - Math.round(b.position[2] / 1.5)) || a.position[0] - b.position[0]);

  for (const o of objs) {
    const [w, h, d] = o.size;
    switch (o.type) {
      case 'stage':
        S.push({ k: 'poly', pts: footprint(o), closed: true, layer: 'stage', fill: FILLS.stage, weight: 1.6 });
        label(o, `STAGE ${m(w)} × ${m(d)}`, 0.42, -0.15); label(o, `deck ${m(h)} high`, 0.28, 0.4);
        S.push({ k: 'dim', a: footprint(o)[3], b: footprint(o)[2], offset: [0, 0.7], text: m(w), layer: 'dims' });
        break;
      case 'dance_floor':
        S.push({ k: 'poly', pts: footprint(o), closed: true, layer: 'decor', fill: FILLS.dance, weight: 1.2 });
        label(o, `DANCE FLOOR ${m(w)} × ${m(d)}`, 0.34);
        break;
      case 'round_table': case 'cocktail_table':
        S.push({ k: 'circle', c: [o.position[0], o.position[2]], r: w / 2, layer: 'tables', fill: FILLS.table, weight: 1.2 });
        break;
      case 'long_table': case 'bar': case 'booth': case 'lectern': case 'sofa':
        S.push({ k: 'poly', pts: footprint(o), closed: true, layer: o.type === 'long_table' ? 'tables' : 'decor', fill: o.type === 'bar' ? FILLS.bar : FILLS.table, weight: 1.1 });
        if (o.type === 'bar' || o.type === 'booth') label(o, o.type === 'bar' ? `BAR ${m(w)}` : o.name.toUpperCase().slice(0, 24), 0.3);
        break;
      case 'chair':
        S.push({ k: 'poly', pts: footprint(o), closed: true, layer: 'seating', weight: 0.7 });
        break;
      case 'led_screen': {
        const flown = o.spec?.frame === 'flown';
        S.push({ k: 'poly', pts: footprint(o, w, Math.max(0.12, Math.min(d, 0.4))), closed: true, layer: 'av', fill: flown ? undefined : FILLS.screen, dash: flown, weight: 1.2 });
        S.push({ k: 'text', at: [o.position[0], o.position[2] + 0.75], text: `LED ${m(w)} × ${m(h)}${flown ? ' (flown)' : ''}`, size: 0.28, layer: 'text', anchor: 'middle' });
        break;
      }
      case 'speaker':
        S.push({ k: 'poly', pts: footprint(o), closed: true, layer: 'av', weight: 1 });
        break;
      case 'curtain':
        S.push({ k: 'poly', pts: spanLine(o), layer: 'decor', weight: 2.2 });
        break;
      case 'sign': case 'arch':
        S.push({ k: 'poly', pts: footprint(o, w, Math.max(0.1, d)), closed: true, layer: 'decor', weight: 1 });
        if (w >= 1.5) label(o, o.name.toUpperCase().slice(0, 24), 0.24, d / 2 + 0.35);
        break;
      case 'model':
        if (Math.max(w, d) >= 0.5) {
          S.push({ k: 'poly', pts: footprint(o), closed: true, layer: 'decor', weight: 0.9 });
          if (Math.max(w, d) >= 1.2) label(o, o.name.slice(0, 22), 0.22);
        }
        break;
      // overhead: dashed, so the floor stays readable
      case 'truss': S.push({ k: 'poly', pts: footprint(o, w, Math.max(0.3, d)), closed: true, layer: 'overhead', dash: true, weight: 1 }); break;
      case 'ceiling_drape': S.push({ k: 'poly', pts: footprint(o), closed: true, layer: 'overhead', dash: true, weight: 0.8 }); break;
      case 'chandelier': S.push({ k: 'circle', c: [o.position[0], o.position[2]], r: Math.max(0.3, w / 2), layer: 'overhead', dash: true, weight: 0.9 }); break;
      case 'light': {
        const [x, , z] = o.position;
        S.push({ k: 'circle', c: [x, z], r: 0.16, layer: 'overhead', weight: 0.9 });
        S.push({ k: 'poly', pts: [[x - 0.16, z], [x + 0.16, z]], layer: 'overhead', weight: 0.7 }, { k: 'poly', pts: [[x, z - 0.16], [x, z + 0.16]], layer: 'overhead', weight: 0.7 });
        break;
      }
      case 'tent': S.push({ k: 'poly', pts: footprint(o), closed: true, layer: 'overhead', dash: true, weight: 1.2 }); break;
      default: break;
    }
  }
  numbered.forEach((t, i) => {
    const n = seatsAt(t);
    S.push({ k: 'text', at: [t.position[0], t.position[2] - 0.02], text: String(i + 1), size: Math.min(0.5, t.size[0] * 0.32), layer: 'text', anchor: 'middle', bold: true });
    if (n) S.push({ k: 'text', at: [t.position[0], t.position[2] + Math.min(0.42, t.size[0] * 0.28)], text: `${n} seats`, size: Math.min(0.22, t.size[0] * 0.14), layer: 'text', anchor: 'middle' });
  });
  // how far the first guests sit from the stage
  const stage = objs.find((o) => o.type === 'stage');
  if (stage && tables.length) {
    const front = Math.max(...footprint(stage).map((p) => p[1]));
    const first = tables.map((t) => ({ t, gap: t.position[2] - (t.type === 'long_table' ? t.size[2] / 2 : t.size[0] / 2) - front })).filter((x) => x.gap > 0).sort((a, b) => a.gap - b.gap)[0];
    if (first) S.push({ k: 'dim', a: [first.t.position[0], front], b: [first.t.position[0], front + first.gap], offset: [0.9, 0], text: m(first.gap), layer: 'dims' });
  }

  const chairs = objs.filter((o) => o.type === 'chair').length;
  const facts: [string, string][] = [
    ['Room', `${m(W)} × ${m(D)} (${Math.round(W * D)} m²)`],
    ['Guests seated', String(scene.stats?.seats ?? chairs)],
    ['Tables', String(tables.length)],
    ['Chairs', String(chairs)],
  ];
  if (stage) facts.push(['Stage', `${m(stage.size[0])} × ${m(stage.size[2])}, ${m(stage.size[1])} high`]);
  const df = objs.find((o) => o.type === 'dance_floor');
  if (df) facts.push(['Dance floor', `${m(df.size[0])} × ${m(df.size[2])}`]);
  const led = objs.filter((o) => o.type === 'led_screen');
  if (led.length) facts.push(['LED walls', led.map((o) => `${m(o.size[0])} × ${m(o.size[1])}`).join(', ')]);
  const lights = objs.filter((o) => o.type === 'light').length;
  if (lights) facts.push(['Lighting fixtures', String(lights)]);

  return {
    shapes: S, bounds: { minX: room.minX - 2.2, minY: room.minZ - 2.2, maxX: room.maxX + 1, maxY: room.maxZ + 1 },
    title: meta.title, venue: meta.venue, date: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }), facts,
  };
}

// ---------------------------------------------------------------------------
// SVG (for the preview, and the PNG saved to Renders)

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The dimension's pieces: the measured line (offset from the object), two extension lines, and where its text goes. */
function dimParts(s: Extract<Shape, { k: 'dim' }>) {
  const [ox, oy] = s.offset, a: P = [s.a[0] + ox, s.a[1] + oy], b: P = [s.b[0] + ox, s.b[1] + oy];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, t = 0.18;
  const tick = (p: P): P[] => [[p[0] - (ux + uy) * t * 0.7, p[1] - (uy - ux) * t * 0.7], [p[0] + (ux + uy) * t * 0.7, p[1] + (uy - ux) * t * 0.7]];
  const vertical = Math.abs(uy) > Math.abs(ux);
  return { line: [a, b] as P[], ext: [[s.a, a], [s.b, b]] as P[][], ticks: [tick(a), tick(b)], text: [(a[0] + b[0]) / 2 + (vertical ? -0.18 : 0), (a[1] + b[1]) / 2 - (vertical ? 0 : 0.18)] as P, vertical };
}

/** The plan as SVG; `fit` makes it fill its box (for a preview), otherwise it is drawn at `pxPerMetre`. */
export function toSvg(plan: Plan, pxPerMetre = 40, fit = false) {
  const { minX, minY, maxX, maxY } = plan.bounds, k = pxPerMetre;
  const X = (x: number) => ((x - minX) * k).toFixed(1), Y = (y: number) => ((y - minY) * k).toFixed(1);
  const pts = (ps: P[]) => ps.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const out: string[] = [];
  for (const s of plan.shapes) {
    const stroke = COLOURS[s.layer];
    if (s.k === 'poly') out.push(`<${s.closed ? 'polygon' : 'polyline'} points="${pts(s.pts)}" fill="${s.fill || 'none'}" stroke="${stroke}" stroke-width="${(s.weight || 1).toFixed(1)}"${s.dash ? ' stroke-dasharray="6 4"' : ''}/>`);
    else if (s.k === 'circle') out.push(`<circle cx="${X(s.c[0])}" cy="${Y(s.c[1])}" r="${(s.r * k).toFixed(1)}" fill="${s.fill || 'none'}" stroke="${stroke}" stroke-width="${(s.weight || 1).toFixed(1)}"${s.dash ? ' stroke-dasharray="6 4"' : ''}/>`);
    else if (s.k === 'text') out.push(`<text x="${X(s.at[0])}" y="${Y(s.at[1])}" font-size="${(s.size * k).toFixed(1)}" text-anchor="${s.anchor || 'start'}" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif"${s.bold ? ' font-weight="700"' : ''} fill="${stroke}">${esc(s.text)}</text>`);
    else {
      const d = dimParts(s);
      out.push(`<g stroke="${stroke}" stroke-width="1">${[d.line, ...d.ext, ...d.ticks].map((l) => `<polyline points="${pts(l)}" fill="none"/>`).join('')}</g>`);
      out.push(`<text x="${X(d.text[0])}" y="${Y(d.text[1])}" font-size="${(0.3 * k).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="${stroke}"${d.vertical ? ` transform="rotate(-90 ${X(d.text[0])} ${Y(d.text[1])})"` : ''}>${esc(s.text)}</text>`);
    }
  }
  const w = (maxX - minX) * k, h = (maxY - minY) * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fit ? '100%' : w.toFixed(0)}" height="${fit ? '100%' : h.toFixed(0)}" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}"><rect width="100%" height="100%" fill="#FFFFFF"/>${out.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// PDF: A3 landscape, the drawing at a standard scale, a title block on the right

const SCALES = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
const pdfText = (t: string) => t.normalize('NFKD').replace(/×/g, 'x').replace(/[–—·]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/[\\()]/g, (c) => `\\${c}`);
const rgb = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

export function toPdf(plan: Plan): Blob {
  const PW = 1190.55, PH = 841.89, margin = 28, side = 250; // A3 landscape in points
  const areaW = PW - margin * 2 - side - 16, areaH = PH - margin * 2;
  const { minX, minY, maxX, maxY } = plan.bounds;
  const MM = 72 / 25.4, perMetre = (scale: number) => (1000 / scale) * MM; // points per metre at 1:scale
  const scale = SCALES.find((sc) => (maxX - minX) * perMetre(sc) <= areaW && (maxY - minY) * perMetre(sc) <= areaH) || 1000;
  const k = perMetre(scale), ox = margin + (areaW - (maxX - minX) * k) / 2, oy = PH - margin - (areaH - (maxY - minY) * k) / 2;
  const X = (x: number) => (ox + (x - minX) * k).toFixed(2), Y = (y: number) => (oy - (y - minY) * k).toFixed(2); // PDF y runs up
  const c: string[] = ['1 J 1 j'];
  const path = (ps: P[], closed?: boolean) => ps.map(([x, y], i) => `${X(x)} ${Y(y)} ${i ? 'l' : 'm'}`).join(' ') + (closed ? ' h' : '');
  const style = (layer: Layer, weight = 1, dash?: boolean, fill?: string) => {
    c.push(`${rgb(COLOURS[layer])} RG ${(weight * 0.45).toFixed(2)} w ${dash ? '[4 3] 0 d' : '[] 0 d'}`);
    if (fill) c.push(`${rgb(fill)} rg`);
  };
  const text = (at: [string, string], t: string, size: number, anchor: 'start' | 'middle' | 'end' = 'start', bold = false, colour = '#1B2430', rotate = false) => {
    const wApprox = t.length * size * 0.52, dx = anchor === 'middle' ? -wApprox / 2 : anchor === 'end' ? -wApprox : 0;
    const [x, y] = [Number(at[0]), Number(at[1])];
    c.push(`BT ${rgb(colour)} rg /${bold ? 'F2' : 'F1'} ${size.toFixed(2)} Tf ${rotate ? `0 1 -1 0 ${(x + size * 0.35).toFixed(2)} ${(y + dx).toFixed(2)} Tm` : `1 0 0 1 ${(x + dx).toFixed(2)} ${(y - size * 0.35).toFixed(2)} Tm`} (${pdfText(t)}) Tj ET`);
  };
  const circle = (cx: number, cy: number, r: number) => {
    const q = 0.5523 * r, x = Number(X(cx)), y = Number(Y(cy)), rr = r * k, qq = q * k;
    return `${(x + rr).toFixed(2)} ${y.toFixed(2)} m ${(x + rr).toFixed(2)} ${(y + qq).toFixed(2)} ${(x + qq).toFixed(2)} ${(y + rr).toFixed(2)} ${x.toFixed(2)} ${(y + rr).toFixed(2)} c ${(x - qq).toFixed(2)} ${(y + rr).toFixed(2)} ${(x - rr).toFixed(2)} ${(y + qq).toFixed(2)} ${(x - rr).toFixed(2)} ${y.toFixed(2)} c ${(x - rr).toFixed(2)} ${(y - qq).toFixed(2)} ${(x - qq).toFixed(2)} ${(y - rr).toFixed(2)} ${x.toFixed(2)} ${(y - rr).toFixed(2)} c ${(x + qq).toFixed(2)} ${(y - rr).toFixed(2)} ${(x + rr).toFixed(2)} ${(y - qq).toFixed(2)} ${(x + rr).toFixed(2)} ${y.toFixed(2)} c h`;
  };
  for (const s of plan.shapes) {
    if (s.k === 'poly') { style(s.layer, s.weight, s.dash, s.fill); c.push(`${path(s.pts, s.closed)} ${s.fill ? 'B' : 'S'}`); }
    else if (s.k === 'circle') { style(s.layer, s.weight, s.dash, s.fill); c.push(`${circle(s.c[0], s.c[1], s.r)} ${s.fill ? 'B' : 'S'}`); }
    else if (s.k === 'text') text([X(s.at[0]), Y(s.at[1])], s.text, Math.max(4, s.size * k), s.anchor, s.bold, COLOURS[s.layer]);
    else {
      const d = dimParts(s);
      style('dims', 0.9);
      for (const l of [d.line, ...d.ext, ...d.ticks]) c.push(`${path(l)} S`);
      text([X(d.text[0]), Y(d.text[1])], s.text, Math.max(5, 0.3 * k), 'middle', false, COLOURS.dims, d.vertical);
    }
  }
  // the title block
  const bx = PW - margin - side;
  c.push(`${rgb('#1B2430')} RG 0.8 w [] 0 d ${bx.toFixed(2)} ${margin} ${side} ${(PH - margin * 2).toFixed(2)} re S`);
  let ty = PH - margin - 30;
  const line = (t: string, size: number, bold = false, colour = '#1B2430') => { text([(bx + 14).toFixed(2), ty.toFixed(2)], t, size, 'start', bold, colour); ty -= size * 1.55; };
  line('FLOOR PLAN', 9, true, '#0B6BCB'); ty -= 4;
  for (const part of wrap(plan.title, 26)) line(part, 15, true);
  line(plan.venue, 10, false, '#5B6B7F'); ty -= 10;
  for (const [kk, v] of plan.facts) { line(kk.toUpperCase(), 7, true, '#6C7A8B'); for (const part of wrap(v, 38)) line(part, 10); ty -= 3; }
  ty -= 8;
  line('LEGEND', 7, true, '#6C7A8B');
  for (const [lay, t] of [['tables', 'Tables, numbered from the stage'], ['seating', 'Chairs'], ['av', 'Screens and sound'], ['overhead', 'Overhead: rigging, lights (dashed)'], ['dims', 'Dimensions in metres']] as [Layer, string][]) {
    c.push(`${rgb(COLOURS[lay])} RG 1.4 w ${lay === 'overhead' ? '[4 3] 0 d' : '[] 0 d'} ${(bx + 14).toFixed(2)} ${(ty + 3).toFixed(2)} m ${(bx + 38).toFixed(2)} ${(ty + 3).toFixed(2)} l S`);
    text([(bx + 46).toFixed(2), (ty + 3).toFixed(2)], t, 8.5); ty -= 15;
  }
  // scale bar: 5 m at the drawing's scale
  const barY = margin + 58, bar = 5 * k;
  c.push(`${rgb('#1B2430')} RG 0.8 w [] 0 d`);
  for (let i = 0; i < 5; i++) c.push(`${i % 2 ? '1 1 1' : rgb('#1B2430')} rg ${(bx + 14 + (i * bar) / 5).toFixed(2)} ${barY} ${(bar / 5).toFixed(2)} 5 re B`);
  text([(bx + 14).toFixed(2), (barY - 9).toFixed(2)], '0', 7); text([(bx + 14 + bar).toFixed(2), (barY - 9).toFixed(2)], '5 m', 7, 'middle');
  ty = margin + 32; line(`Scale 1:${scale} at A3`, 9, true); line(`${plan.date} · Novira Studio`, 8, false, '#6C7A8B');

  // the file: catalogue, pages, one page, its drawing, two fonts
  const stream = c.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${pdfText(plan.title)} - floor plan) /Creator (Novira Studio) >>`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

function wrap(t: string, n: number) {
  const out: string[] = [];
  let cur = '';
  for (const w of t.split(/\s+/)) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// DXF (R12, metres): opens in AutoCAD, BricsCAD, LibreCAD, Vectorworks…; save as DWG from there

const ACI: Record<Layer, number> = { walls: 7, grid: 9, stage: 8, tables: 7, seating: 8, av: 5, decor: 3, overhead: 1, dims: 5, text: 7 };

/** The plan as DXF text. */
export function toDxf(plan: Plan) {
  const out: (string | number)[] = [];
  const g = (code: number, v: string | number) => out.push(code, typeof v === 'number' ? Number(v.toFixed(4)) : v);
  const y = (v: number) => -v; // CAD's y runs up the sheet: the stage stays at the top
  const layers = Object.keys(ACI) as Layer[];
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 6); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, 0.45); g(49, 0.3); g(49, -0.15);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const l of layers) { g(0, 'LAYER'); g(2, l.toUpperCase()); g(70, 0); g(62, ACI[l]); g(6, l === 'overhead' ? 'DASHED' : 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (layer: Layer, a: P, b: P) => { g(0, 'LINE'); g(8, layer.toUpperCase()); g(10, a[0]); g(20, y(a[1])); g(30, 0); g(11, b[0]); g(21, y(b[1])); g(31, 0); };
  const text = (layer: Layer, at: P, t: string, h: number, anchor: 'start' | 'middle' | 'end' = 'start', rot = 0) => {
    g(0, 'TEXT'); g(8, layer.toUpperCase()); g(10, at[0]); g(20, y(at[1])); g(30, 0); g(40, h); g(1, t.replace(/×/g, 'x')); if (rot) g(50, rot);
    if (anchor !== 'start') { g(72, anchor === 'middle' ? 1 : 2); g(11, at[0]); g(21, y(at[1])); g(31, 0); }
  };
  for (const s of plan.shapes) {
    if (s.k === 'poly') { const ps = s.closed ? [...s.pts, s.pts[0]] : s.pts; for (let i = 1; i < ps.length; i++) line(s.layer, ps[i - 1], ps[i]); }
    else if (s.k === 'circle') { g(0, 'CIRCLE'); g(8, s.layer.toUpperCase()); g(10, s.c[0]); g(20, y(s.c[1])); g(30, 0); g(40, s.r); }
    else if (s.k === 'text') text(s.layer, s.at, s.text, s.size, s.anchor);
    else { const d = dimParts(s); for (const l of [d.line, ...d.ext, ...d.ticks]) line('dims', l[0], l[1]); text('dims', d.text, s.text, 0.3, 'middle', d.vertical ? 90 : 0); }
  }
  // the title, below the room
  const { minX, maxY } = plan.bounds;
  text('text', [minX + 1, maxY + 1], `${plan.title} - ${plan.venue}`, 0.6);
  plan.facts.forEach(([kk, v], i) => text('text', [minX + 1, maxY + 2 + i * 0.6], `${kk}: ${v}`, 0.35));
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
