// Novira's built-to-measure objects: stage, LED wall, truss, dance floor,
// pipe & drape, exhibition stands and lighting fixtures, each modelled on the
// real hire equipment, plus Nozila's tents.
// A Novira object keeps position / rotation / size / colour; `variant` picks
// the preset (tent family, LED panel, truss shape, fixture…) and `spec` holds
// extra settings. Everything is drawn in object-local space, as in Nozila.
import { CeilingDrape, Chandelier, WeddingArch } from '@/components/three/Decor';
import { useMemo } from 'react';
import { Booth } from '@/components/three/Booth';
import { DANCE_FINISHES, DanceFloor } from '@/components/three/DanceFloor';
import { DRAPE_FABRICS, Drape } from '@/components/three/Drape';
import { DISPLAY_TYPES, Display } from '@/components/three/Display';
import { defaultDisplay } from '@/lib/content';
import { LedWall } from '@/components/three/LedWall';
import { Stage } from '@/components/three/StageDeck';
import { FIXTURES, StageLight } from '@/components/three/StageLight';
import { Truss } from '@/components/three/Truss';
import type { SceneObject } from '@/lib/types';
import { LED_PANELS, LED_PRESETS, ledPanel, type TentSceneObject } from './shared';
import { TENT_PRESETS, Tent3D, buildSlots, createTent } from './three/Tent3D';

const MM = 1000;
const ORIGIN = { x: 0, y: 0, z: 0 };
const local = { positionMm: ORIGIN, rotationDeg: ORIGIN, scale: { x: 1, y: 1, z: 1 } };

/** Object types built to measure (with varieties behind their thumbnail). */
export const PROCEDURAL = new Set(['stage', 'led_screen', 'tent', 'truss', 'curtain', 'booth', 'light', 'dance_floor', 'sign', 'chandelier', 'ceiling_drape', 'arch']);
export const isProcedural = (o: SceneObject) => PROCEDURAL.has(o.type);

// ---------- varieties shown behind the thumbnail ----------
export type Variety = { key: string; label: string; note?: string; patch: Partial<SceneObject> };

const STAGE_VARIETIES: Variety[] = [
  { key: 'standard', label: 'Stage 24″', note: '7.3 × 4.9 m, skirted, LED edge', patch: { size: [7.3, 0.61, 4.9] } },
  { key: 'riser', label: 'Low riser 16″', note: 'Speaker riser 4.9 × 2.4 m', patch: { size: [4.9, 0.41, 2.4] } },
  { key: 'high', label: 'High stage 40″', note: 'Concert stage 9.8 × 4.9 m', patch: { size: [9.8, 1.02, 4.9] } },
  { key: 'runway', label: 'Runway / catwalk', note: '2.4 × 9.75 m', patch: { size: [2.44, 0.61, 9.75] } },
]
const LED_VARIETIES: Variety[] = [
  ...LED_PRESETS.map((p) => {
    const panel = ledPanel(p.panelKey);
    const w = (p.columns * panel.widthMm) / MM, h = (p.rows * panel.heightMm) / MM;
    return { key: `preset:${p.key}`, label: p.label, note: `${w.toFixed(1)} × ${h.toFixed(2)} m · ${panel.label}${p.curveDeg ? ` · curved ${p.curveDeg}°` : ''}`,
      patch: { variant: p.panelKey, size: [w, h, 0.1] as [number, number, number], spec: { frame: p.frame, curveDeg: p.curveDeg, bottomMm: p.bottomMm } } };
  }),
  ...LED_PANELS.map((p) => ({ key: p.key, label: `${p.label} panels`, note: `${p.widthMm}×${p.heightMm} mm cabinets, ${p.pitchMm} mm pitch`, patch: { variant: p.key } })),
];
const TENT_VARIETIES: Variety[] = TENT_PRESETS.map((p) => ({
  key: p.key, label: p.label, note: p.family === 'clearspan' ? 'Clearspan marquee' : 'Frame tent',
  patch: { variant: p.key, size: [p.widthMm / MM, tentPeak(p.family, p.widthMm) / MM, p.lengthMm / MM] as [number, number, number] },
}));
const TRUSS_VARIETIES: Variety[] = [
  { key: 'goalpost', label: 'Goalpost', note: 'Two towers and a header, 8 × 5 m', patch: { variant: 'goalpost', name: 'Goalpost truss', size: [8, 5, 0.3] } },
  { key: 'arch', label: 'Arch', note: 'Rolled arch on two legs, 6 × 4.5 m — entrances, photo walls', patch: { variant: 'arch', name: 'Arch truss', size: [6, 4.5, 0.3] } },
  { key: 'square', label: 'Square grid', note: 'Box over the floor on four towers, 8 × 6 m', patch: { variant: 'square', name: 'Truss grid', size: [8, 5, 6] } },
  { key: 'u-shape', label: 'U-shape', note: 'Three sides on four towers, open to the audience', patch: { variant: 'u-shape', name: 'U truss', size: [8, 5, 4] } },
  { key: 'circle', label: 'Circle', note: 'Rolled ring Ø 8 m, flown on chain hoists', patch: { variant: 'circle', name: 'Circle truss', size: [8, 6, 8] } },
  { key: 'straight', label: 'Flown bar', note: '8 m straight run on two hoists', patch: { variant: 'straight', name: 'Flown truss', size: [8, 5, 0.3] } },
];
const CURTAIN_VARIETIES: Variety[] = Object.entries(DRAPE_FABRICS).map(([key, f]) => ({ key, label: f.label, note: f.fabric === 'sheer' ? 'Translucent voile' : f.fabric === 'satin' ? 'Satin, high sheen' : 'Cotton velour, light-absorbing', patch: { variant: key, color: f.color } }));
const BOOTH_VARIETIES: Variety[] = [
  ['shell-scheme', 'Shell scheme', 'Back and side walls, fascia with your name'], ['inline', 'Inline', 'Between neighbours, open to one aisle'],
  ['corner', 'Corner', 'Open to two aisles, L-shaped fascia'], ['peninsula', 'Peninsula', 'Back wall only, open on three sides'],
  ['island', 'Island', 'Raised floor, open all round, lightbox wall'], ['double-decker', 'Island, large', 'Raised floor and lightbox for big stands'],
].map(([key, label, note]) => ({ key, label, note, patch: { variant: key } }));
const LIGHT_VARIETIES: Variety[] = Object.entries(FIXTURES).map(([key, f]) => ({ key, label: f.label, note: `${f.beam}° beam · ${f.mount === 'truss' ? 'truss mounted' : f.mount === 'stand' ? 'on a stand' : 'floor standing'}`, patch: { variant: key, name: f.label } }));
const SIGN_VARIETIES: Variety[] = DISPLAY_TYPES.map(([key, label, note, size]) => ({ key, label, note, patch: { variant: key, size: [...size] as [number, number, number] } }));
const DANCE_VARIETIES: Variety[] = DANCE_FINISHES.map(([key, label]) => ({ key, label, note: 'Interlocking 3 ft panels, aluminium edge ramps', patch: { variant: key } }));

const CHANDELIER_VARIETIES: Variety[] = [
  { key: 'crystal-tiered', label: 'Crystal waterfall', note: 'Three tiers of crystal strands, warm bulbs', patch: { variant: 'crystal-tiered', size: [1.2, 1.3, 1.2] } },
  { key: 'candle-gold', label: 'Gold candle chandelier', note: '14 candle arms in two tiers, crystal drops', patch: { variant: 'candle-gold', size: [1.1, 0.9, 1.1] } },
  { key: 'crystal-ball', label: 'Crystal sphere', note: 'A globe of crystal drops round a bulb cluster', patch: { variant: 'crystal-ball', size: [0.8, 0.8, 0.8] } },
];
const CEILING_VARIETIES: Variety[] = [
  { key: 'ivory', label: 'Ivory swags', note: 'Three parallel velour swags', patch: { variant: 'ivory', color: '#EFE7D6', spec: { count: 3, layout: 'parallel' } } },
  { key: 'white', label: 'White sheer swags', note: 'Translucent voile, five runs', patch: { variant: 'white', color: '#F7F7F4', spec: { count: 5, layout: 'parallel' } } },
  { key: 'gold', label: 'Champagne canopy', note: 'Satin swags radiating from a centre', patch: { variant: 'gold', color: '#D8C08A', spec: { count: 8, layout: 'radial' } } },
  { key: 'burgundy', label: 'Burgundy swags', note: 'Rich velour, three runs', patch: { variant: 'burgundy', color: '#6E1F2C', spec: { count: 3, layout: 'parallel' } } },
];
const ARCH_VARIETIES: Variety[] = [
  { key: 'square', label: 'Draped canopy', note: 'Four-post gold frame, ivory satin, flowers', patch: { variant: 'square', size: [2.4, 2.6, 1.2], spec: { frame: 'gold', drape: 'ivory' } } },
  { key: 'round', label: 'Round arch', note: 'Gold hoop on two posts, flower clusters', patch: { variant: 'round', size: [2.2, 2.5, 0.4], spec: { frame: 'gold', drape: 'white' } } },
  { key: 'hexagon', label: 'Hexagon arch', note: 'Natural wood, sheer drape — boho / rustic', patch: { variant: 'hexagon', size: [2.4, 2.5, 2.1], spec: { frame: 'wood', drape: 'white' } } },
];

export function varietiesFor(type: string): Variety[] {
  return ({ stage: STAGE_VARIETIES, led_screen: LED_VARIETIES, tent: TENT_VARIETIES, truss: TRUSS_VARIETIES, curtain: CURTAIN_VARIETIES, booth: BOOTH_VARIETIES, light: LIGHT_VARIETIES, dance_floor: DANCE_VARIETIES, sign: SIGN_VARIETIES, chandelier: CHANDELIER_VARIETIES, ceiling_drape: CEILING_VARIETIES, arch: ARCH_VARIETIES } as Record<string, Variety[]>)[type] || [];
}
export const currentVariety = (o: SceneObject) => o.variant || (o.type === 'sign' ? defaultDisplay(o) : undefined) || ({ stage: 'standard', led_screen: 'p3-9-indoor', tent: 'frame-20x40', truss: 'goalpost', curtain: 'black', booth: 'shell-scheme', light: 'par-can', dance_floor: 'checker', chandelier: 'crystal-tiered', ceiling_drape: 'ivory', arch: 'square' } as Record<string, string>)[o.type];

function tentPeak(family: string, widthMm: number) {
  const eave = family === 'clearspan' ? (widthMm >= 20000 ? 4000 : 3000) : 2440;
  return eave + Math.round(widthMm * 0.22);
}

// ---------- Novira object -> Nozila spec ----------
export function toTent(o: SceneObject): TentSceneObject {
  const preset = TENT_PRESETS.find((p) => p.key === o.variant) || TENT_PRESETS.find((p) => p.key === 'frame-20x40') || TENT_PRESETS[0];
  const t = createTent(preset);
  const widthMm = Math.round(o.size[0] * MM), lengthMm = Math.round(o.size[2] * MM);
  return { ...t, ...local, id: o.id, name: o.name, widthMm, lengthMm, slots: buildSlots(widthMm, lengthMm, t.bayLengthMm), canopyColor: o.color || t.canopyColor, canopyHidden: !!o.spec?.canopyHidden };
}

export function NozilaBody({ o, selected = false, ground = 0, realLight = true }: { o: SceneObject; selected?: boolean; ground?: number; realLight?: boolean }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when what the tent reads changes
  const tent = useMemo(() => (o.type === 'tent' ? toTent(o) : null), [o.type, o.variant, o.spec, o.size[0], o.size[2], o.color, o.name]);
  switch (o.type) {
    case 'led_screen': return <LedWall o={o} ground={ground} />;
    case 'stage': return <Stage o={o} />;
    case 'tent': return <Tent3D tent={tent!} selected={selected} showSlots={false} />;
    case 'truss': return <Truss o={o} />;
    case 'curtain': return <Drape o={o} />;
    case 'booth': return <Booth o={o} />;
    case 'light': return <StageLight o={o} ground={ground} realLight={realLight} />;
    case 'dance_floor': return <DanceFloor o={o} />;
    case 'sign': return <Display o={o} />;
    case 'chandelier': return <Chandelier o={o} light={realLight} />;
    case 'ceiling_drape': return <CeilingDrape o={o} />;
    case 'arch': return <WeddingArch o={o} />;
    default: return null;
  }
}

// Defaults when an item is added from the library.
export function newProcedural(type: string): Omit<SceneObject, 'id' | 'position'> & { position?: [number, number, number] } {
  switch (type) {
    case 'tent': { const v = TENT_VARIETIES.find((x) => x.key === 'frame-20x40')!; return { type: 'tent', name: v.label, rotation: [0, 0, 0], size: v.patch.size!, color: '#F7F6F3', variant: v.key }; }
    case 'truss': return { type: 'truss', name: 'Goalpost truss', rotation: [0, 0, 0], size: [8, 5, 0.3], color: '#C2C7CE', variant: 'goalpost' };
    case 'curtain': return { type: 'curtain', name: 'Pipe & drape', rotation: [0, 0, 0], size: [6, 3, 0.2], color: '#141414', variant: 'black' };
    case 'booth': return { type: 'booth', name: 'Exhibition stand', rotation: [0, 0, 0], size: [3, 2.5, 3], color: '#F2F2F0', variant: 'shell-scheme', text: { content: 'Exhibitor' } };
    case 'light': return { type: 'light', name: 'Moving head wash', rotation: [0, 0, 0], size: [0.4, 0.5, 0.4], color: '#FFFFFF', variant: 'moving-head-wash', position: [0, 4, 0], spec: { intensity: 0.8 } }; // aimed automatically where it is placed
    case 'sign': return { type: 'sign', name: 'Poster', rotation: [0, 0, 0], size: [0.66, 1.75, 0.6], color: '#0E2A4A', variant: 'easel', content: { mode: 'design', template: 'headline', title: 'Welcome', subtitle: '', bg: '#0E2A4A', fg: '#FFFFFF', accent: '#C9A227', font: 'sans' } };
    case 'chandelier': return { type: 'chandelier', name: 'Crystal chandelier', rotation: [0, 0, 0], size: [1.2, 1.3, 1.2], color: '#C9A24A', variant: 'crystal-tiered', spec: { drop: 0.8 }, position: [0, 3.4, 0] };
    case 'ceiling_drape': return { type: 'ceiling_drape', name: 'Ceiling drape', rotation: [0, 0, 0], size: [12, 1.2, 4], color: '#EFE7D6', variant: 'ivory', spec: { count: 3, layout: 'parallel' }, position: [0, 5.2, 0] };
    case 'arch': return { type: 'arch', name: 'Wedding arch', rotation: [0, 0, 0], size: [2.4, 2.6, 1.2], color: '#EFE7D6', variant: 'square', spec: { frame: 'gold', drape: 'ivory', flowers: ['#F5F0E8', '#B5553C', '#7A1E2C'] } };
    case 'dance_floor': return { type: 'dance_floor', name: 'Dance floor', rotation: [0, 0, 0], size: [5.6, 0.03, 5.6], color: '#E9E4DA', variant: 'checker' };
    case 'led_screen': return { type: 'led_screen', name: 'LED wall', rotation: [0, 0, 0], size: [5, 3, 0.1], color: '#0E2A4A', variant: 'p3-9-indoor', spec: { frame: 'ground-support' }, position: [0, 1, 0], text: { content: 'Your Event', color: '#FFFFFF', accent: '#C9A227' } };
    default: return { type: 'stage', name: 'Stage', rotation: [0, 0, 0], size: [7.3, 0.61, 4.9], color: '#1C1E21', spec: { stairs: true } };
  }
}
