// The lighting engine: what a lighting console's effect engine and real
// fixtures do, frame by frame.
//
//  · Effects (as on a console): a movement (sweep, tilt wave, circle, figure 8,
//    ballyhoo, fan, crossfire), a dimmer effect (pulse, chase, breathe, strobe,
//    candle flicker) and a colour effect (palette fade, rainbow, chase), each at
//    a speed in BPM, a size in degrees, and a spread that offsets the fixtures
//    of a rig from one another (a chase runs down the truss, a fan opens out).
//  · Physics: a moving head's motors accelerate, reach top speed and brake into
//    position (bang-bang with braking, per fixture type); tungsten filaments lag
//    and warm as they dim; LED colour mixing fades over ~0.1 s; a strobe fires
//    short flashes that are never missed on a slow frame.
//  · A show clock (play / pause) shared by every fixture, with no React renders.
import * as THREE from 'three';
import type { SceneObject } from './types';

export type Move = 'static' | 'sweep' | 'tilt-wave' | 'circle' | 'figure8' | 'ballyhoo' | 'fan' | 'crossfire';
export type DimFx = 'steady' | 'pulse' | 'chase' | 'breathe' | 'strobe' | 'flicker';
export type ColourFx = 'steady' | 'fade' | 'rainbow' | 'chase';
export interface LightFx {
  move?: Move; dimmer?: DimFx; colour?: ColourFx;
  /** beats per minute of every effect (one cycle per 4 beats for movements) */
  speed?: number;
  /** movement size in degrees */
  size?: number;
  /** how far apart the fixtures of a rig run, 0 (together) … 1 (spread over a whole cycle) */
  spread?: number;
  /** colours for fade / chase (hex), else the fixture's own colour */
  palette?: string[];
  /** strobe rate, flashes per second */
  strobeHz?: number;
  gobo?: Gobo; goboSpin?: number; prism?: boolean;
  /** fixtures sharing a group run as one rig (default: all fixtures with an effect) */
  group?: string;
}
export type Gobo = 'none' | 'dots' | 'breakup' | 'stars' | 'rays' | 'swirl' | 'ring';

export const MOVES: [Move, string][] = [['static', 'Static'], ['sweep', 'Sweep'], ['tilt-wave', 'Tilt wave'], ['circle', 'Circle'], ['figure8', 'Figure 8'], ['ballyhoo', 'Ballyhoo'], ['fan', 'Fan'], ['crossfire', 'Crossfire']];
export const DIMMERS: [DimFx, string][] = [['steady', 'Steady'], ['pulse', 'Pulse'], ['chase', 'Chase'], ['breathe', 'Breathe'], ['strobe', 'Strobe'], ['flicker', 'Candle flicker']];
export const COLOURS: [ColourFx, string][] = [['steady', 'Steady'], ['fade', 'Palette fade'], ['rainbow', 'Rainbow'], ['chase', 'Colour chase']];
export const GOBOS: [Gobo, string][] = [['none', 'Open'], ['dots', 'Dots'], ['breakup', 'Leaf breakup'], ['stars', 'Stars'], ['rays', 'Rays'], ['swirl', 'Swirl'], ['ring', 'Ring']];

// ---------- the show clock ----------
const clock = { playing: false, start: 0, pausedAt: 0, listeners: new Set<() => void>() };
export const showTime = () => (clock.playing ? (performance.now() - clock.start) / 1000 : clock.pausedAt);
export const isPlaying = () => clock.playing;
export function setPlaying(on: boolean) {
  if (on === clock.playing) return;
  if (on) clock.start = performance.now() - clock.pausedAt * 1000; else clock.pausedAt = showTime();
  clock.playing = on;
  clock.listeners.forEach((f) => f());
}
export const onClock = (f: () => void) => { clock.listeners.add(f); return () => { clock.listeners.delete(f); }; };

// ---------- how hazy the room is (0 clear … 1 thick), set by the scene ----------
let haze = 0.6;
export const setHaze = (v: number) => { haze = Math.max(0, Math.min(1, v)); };
/** The room's haze now — with a timeline running, each moment brings its own (blended through the crossfade). */
export const hazeLevel = () => {
  const at = tl.moments.length && clock.playing ? momentAt(showTime()) : null;
  if (!at) return haze;
  const a = HAZE[at.moment.show] ?? haze, b = HAZE[at.next.show] ?? haze;
  return a + (b - a) * at.blend;
};

// ---------- each fixture's place in its rig (set by the scene, read every frame) ----------
const slots = new Map<string, { i: number; n: number }>();
export function setRig(objects: SceneObject[]) {
  slots.clear();
  const groups = new Map<string, SceneObject[]>();
  for (const o of objects) if (o.type === 'light') { const k = o.spec?.fx?.group || 'rig'; (groups.get(k) || groups.set(k, []).get(k)!).push(o); }
  for (const list of groups.values()) {
    // in order along the rig (left to right as built), so a chase runs down the truss
    list.sort((a, b) => a.position[0] - b.position[0] || a.position[2] - b.position[2]);
    list.forEach((o, i) => slots.set(o.id, { i, n: list.length }));
  }
}
const slotOf = (id: string) => slots.get(id) || { i: 0, n: 1 };

// ---------- evaluating an effect at a moment ----------
const TAU = Math.PI * 2;
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x: number) => x * x * (3 - 2 * x);
/** smooth pseudo-random in -1..1 (for ballyhoo and candle flicker) */
const wander = (t: number, seed: number) => { const i = Math.floor(t), f = smooth(t - i); return (hash(i + seed * 17.3) * (1 - f) + hash(i + 1 + seed * 17.3) * f) * 2 - 1; };

export interface FxTarget { pan: number; tilt: number; dimmer: number; colour: THREE.Color; goboAngle: number }
const tmp = new THREE.Color();

/** What an effect asks of this fixture at time t (degrees for pan/tilt, 0–1 dimmer). */
export function evaluate(o: SceneObject, t: number, base: { pan: number; tilt: number; colour: string }, out: FxTarget, fxIn?: LightFx | null): FxTarget {
  const fx: LightFx = fxIn || o.spec?.fx || {}, { i, n } = slotOf(o.id);
  const bpm = Math.max(1, Number(fx.speed ?? 30)), beat = (t * bpm) / 60; // beats elapsed
  const spread = Math.max(0, Math.min(1, Number(fx.spread ?? 0.5))), phase = n > 1 ? (i / n) * spread : 0, side = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
  const size = Number(fx.size ?? 25), cyc = beat / 4 + phase; // movements: one cycle per bar of 4 beats
  let pan = base.pan, tilt = base.tilt;
  switch (fx.move || 'static') {
    case 'sweep': pan += Math.sin(cyc * TAU) * size; break;
    case 'tilt-wave': tilt += Math.sin(cyc * TAU) * size * 0.6; break;
    case 'circle': pan += Math.cos(cyc * TAU) * size; tilt += Math.sin(cyc * TAU) * size * 0.6; break;
    case 'figure8': pan += Math.sin(cyc * TAU) * size; tilt += Math.sin(cyc * TAU * 2) * size * 0.35; break;
    case 'ballyhoo': pan += wander(beat / 2, i + 1) * size * 1.6; tilt += wander(beat / 2 + 9, i + 3) * size * 0.8; break; // big searching swings
    case 'fan': pan += side * size * (0.5 + 0.5 * Math.sin((beat / 4) * TAU)); break; // the rig opens out and closes
    case 'crossfire': pan += (i % 2 ? 1 : -1) * Math.sin(cyc * TAU) * size; break; // neighbours cross each other
  }
  let dim = 1;
  switch (fx.dimmer || 'steady') {
    case 'pulse': dim = 0.5 + 0.5 * Math.cos((beat + phase * 4) * TAU); break; // a pulse every beat
    case 'chase': { const k = ((beat / 2 - (n > 1 ? i / n : 0)) % 1 + 1) % 1; dim = Math.pow(Math.max(0, 1 - k * 3), 1.5); break; } // one bright step running down the rig
    case 'breathe': dim = 0.25 + 0.75 * smooth(0.5 + 0.5 * Math.sin((beat / 8 + phase) * TAU)); break;
    case 'flicker': dim = 0.72 + 0.18 * wander(t * 7, i) + 0.1 * wander(t * 19, i + 5); break; // candle / fire
    case 'strobe': dim = 1; break; // the shutter is applied by the physics (it must never miss a flash)
  }
  let colour = out.colour.set(base.colour);
  const pal = (fx.palette?.length ? fx.palette : [base.colour]).map((c) => c);
  switch (fx.colour || 'steady') {
    case 'fade': { const k = ((beat / 8 + phase) % 1) * pal.length, a = Math.floor(k) % pal.length; colour = out.colour.set(pal[a]).lerp(tmp.set(pal[(a + 1) % pal.length]), smooth(k - Math.floor(k))); break; }
    case 'rainbow': colour = out.colour.setHSL(((beat / 16 + phase) % 1 + 1) % 1, 1, 0.5); break;
    case 'chase': colour = out.colour.set(pal[(Math.floor(beat) + i) % pal.length]); break;
  }
  out.pan = pan; out.tilt = tilt; out.dimmer = dim; out.colour = colour;
  out.goboAngle = (t * Number(fx.goboSpin ?? 0) * TAU) / 10; // goboSpin: turns per 10 s (negative: the other way)
  return out;
}

// ---------- the show timeline: moments that follow one another, crossfading ----------
// Novira builds it for the event (a wedding: walk-in → dinner → first dance →
// party). Each moment lasts a preview-length while (an evening compressed into
// minutes), looping; the last seconds of a moment crossfade into the next — the
// motors carry the heads there physically, and the haze changes with it.
export interface Moment { show: string; label: string; seconds: number }
const XFADE = 4;
const HAZE: Record<string, number> = { 'walk-in': 0.45, dinner: 0.25, 'first-dance': 0.55, party: 0.7, concert: 0.85, off: 0.3 };
const tl = { moments: [] as Moment[], palette: [] as string[] };
export function setTimeline(moments: Moment[], palette: string[] = []) { tl.moments = moments; tl.palette = palette; fxCache.clear(); clock.listeners.forEach((f) => f()); }
export const timeline = () => tl.moments;
export const timelineLength = () => tl.moments.reduce((n, m) => n + m.seconds, 0);
/** Where the show is: the moment, the next one, how far into the crossfade (0–1), and the position in the loop. */
export function momentAt(t: number) {
  const total = timelineLength();
  if (!total) return null;
  let x = ((t % total) + total) % total, i = 0;
  while (i < tl.moments.length - 1 && x >= tl.moments[i].seconds) { x -= tl.moments[i].seconds; i++; }
  const m = tl.moments[i], next = tl.moments[(i + 1) % tl.moments.length];
  return { i, moment: m, next, into: x, blend: smooth(Math.max(0, Math.min(1, (x - (m.seconds - XFADE)) / XFADE))), loop: ((t % total) + total) % total };
}
/** Jump the show to a point (seconds into the timeline). */
export function seek(seconds: number) {
  if (clock.playing) clock.start = performance.now() - seconds * 1000; else clock.pausedAt = seconds;
  clock.listeners.forEach((f) => f());
}
const fxCache = new Map<string, LightFx | null>();
const fxFor = (show: string, o: SceneObject) => {
  const key = `${show}|${o.id}|${o.variant}`;
  if (!fxCache.has(key)) fxCache.set(key, showFx(show, o, tl.palette));
  return fxCache.get(key)!;
};
const B: FxTarget = { pan: 0, tilt: 0, dimmer: 0, colour: new THREE.Color(), goboAngle: 0 };
/** The fixture's target now: its own effect, or the timeline's moment (crossfading into the next). */
export function aimNow(o: SceneObject, t: number, base: { pan: number; tilt: number; colour: string }, out: FxTarget): { target: FxTarget; fx: LightFx | null } {
  const at = momentAt(t);
  if (!at) return { target: evaluate(o, t, base, out), fx: o.spec?.fx || null };
  const fa = fxFor(at.moment.show, o);
  evaluate(o, t, base, out, fa || {});
  if (at.blend > 0) {
    const fb = fxFor(at.next.show, o);
    evaluate(o, t, base, B, fb || {});
    out.pan += (B.pan - out.pan) * at.blend; out.tilt += (B.tilt - out.tilt) * at.blend; out.dimmer += (B.dimmer - out.dimmer) * at.blend;
    out.colour.lerp(B.colour, at.blend); out.goboAngle += (B.goboAngle - out.goboAngle) * at.blend;
    return { target: out, fx: at.blend > 0.5 ? fb : fa };
  }
  return { target: out, fx: fa };
}

// ---------- physics: how the fixture gets there ----------
export interface Motor { pan: number; tilt: number; vp: number; vt: number; level: number; colour: THREE.Color; init: boolean }
/** Top speed (°/s) and acceleration (°/s²) of each kind of head; static fixtures don't move. */
export const MOTORS: Record<string, { speed: number; accel: number }> = {
  mhBeam: { speed: 420, accel: 1800 }, mhSpot: { speed: 300, accel: 1000 }, mhWash: { speed: 240, accel: 700 }, follow: { speed: 90, accel: 220 },
};
/** Tungsten lamps lag and warm as they dim; LEDs answer at once. */
export const TUNGSTEN = new Set(['can', 'profile', 'fresnel', 'blinder', 'pin', 'follow']);
const WARM = new THREE.Color('#FF7A2E'), lamp = new THREE.Color();

/** Bang-bang with braking: accelerate towards the target, never faster than top speed, braking in time to stop on it. */
function axis(pos: number, vel: number, target: number, speed: number, accel: number, dt: number) {
  const err = target - pos;
  const want = Math.sign(err) * Math.min(speed, Math.sqrt(2 * accel * Math.abs(err)));
  const dv = Math.max(-accel * dt, Math.min(accel * dt, want - vel));
  vel += dv;
  pos += vel * dt;
  if (Math.abs(target - pos) < 0.05 && Math.abs(vel) < 2) { pos = target; vel = 0; }
  return [pos, vel] as const;
}

/** Advance a fixture's motors, lamp and colour mixing by dt towards what the effect asks. */
export function step(m: Motor, target: FxTarget, body: string, dt: number, o: SceneObject, t: number, fxNow: LightFx | null = o.spec?.fx || null) {
  const motor = MOTORS[body];
  if (!m.init) { m.pan = target.pan; m.tilt = target.tilt; m.vp = m.vt = 0; m.level = target.dimmer; m.colour.copy(target.colour); m.init = true; }
  else if (motor) {
    [m.pan, m.vp] = axis(m.pan, m.vp, target.pan, motor.speed, motor.accel, dt);
    [m.tilt, m.vt] = axis(m.tilt, m.vt, target.tilt, motor.speed * 0.85, motor.accel * 0.85, dt);
  } else { m.pan = target.pan; m.tilt = target.tilt; }
  const tung = TUNGSTEN.has(body);
  m.level += (target.dimmer - m.level) * (1 - Math.exp(-dt / (tung ? 0.18 : 0.02)));
  m.colour.lerp(target.colour, 1 - Math.exp(-dt / (motor ? 0.12 : 0.03)));
  // the shutter: short flashes at the strobe rate, never skipped when a frame is long
  let shutter = 1;
  if (fxNow?.dimmer === 'strobe') {
    const hz = Math.max(0.5, Math.min(25, Number(fxNow.strobeHz ?? 8))), flash = 0.025, before = (t - dt) * hz, now = t * hz;
    shutter = dt * hz >= 1 ? Math.min(1, flash * hz * 1.6) : Math.floor(now) !== Math.floor(before) || now - Math.floor(now) < flash * hz ? 1 : 0;
  }
  const out = Math.max(0, Math.min(1, m.level)) * shutter;
  // a dimmed filament glows redder (lower colour temperature)
  const colour = tung ? lamp.copy(m.colour).lerp(WARM, Math.pow(1 - Math.min(1, m.level), 2) * 0.6) : m.colour;
  return { out, colour };
}

// ---------- gobos: patterns cut in steel, projected and seen in haze ----------
const goboCache = new Map<string, THREE.Texture>();
export function goboTexture(g: Gobo): THREE.Texture | null {
  if (!g || g === 'none') return null;
  if (goboCache.has(g)) return goboCache.get(g)!;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!, r = S / 2;
  x.fillStyle = '#000'; x.fillRect(0, 0, S, S); x.fillStyle = '#fff'; x.strokeStyle = '#fff';
  const rnd = (k: number) => hash(k * 3.7 + g.length);
  x.save(); x.beginPath(); x.arc(r, r, r * 0.98, 0, TAU); x.clip();
  if (g === 'dots') for (let ring = 0; ring < 4; ring++) for (let k = 0; k < (ring ? ring * 8 : 1); k++) { const a = (k / Math.max(1, ring * 8)) * TAU, d = ring * r * 0.24; x.beginPath(); x.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, r * 0.07, 0, TAU); x.fill(); }
  if (g === 'breakup') for (let k = 0; k < 70; k++) { x.beginPath(); x.ellipse(rnd(k) * S, rnd(k + 99) * S, 8 + rnd(k + 7) * 22, 5 + rnd(k + 3) * 12, rnd(k + 5) * TAU, 0, TAU); x.fill(); }
  if (g === 'stars') for (let k = 0; k < 40; k++) { const px = rnd(k) * S, py = rnd(k + 50) * S, s = 3 + rnd(k + 9) * 7; x.beginPath(); for (let p = 0; p < 10; p++) { const a = (p / 10) * TAU, d = p % 2 ? s * 0.4 : s; x.lineTo(px + Math.cos(a) * d, py + Math.sin(a) * d); } x.fill(); }
  if (g === 'rays') for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; x.beginPath(); x.moveTo(r, r); x.arc(r, r, r, a, a + TAU / 30); x.fill(); }
  if (g === 'swirl') for (let k = 0; k < 6; k++) { x.lineWidth = 10; x.beginPath(); for (let s2 = 0; s2 < 60; s2++) { const a = (k / 6) * TAU + s2 * 0.08, d = s2 * (r / 60); x.lineTo(r + Math.cos(a) * d, r + Math.sin(a) * d); } x.stroke(); }
  if (g === 'ring') { x.lineWidth = r * 0.16; x.beginPath(); x.arc(r, r, r * 0.62, 0, TAU); x.stroke(); x.beginPath(); x.arc(r, r, r * 0.12, 0, TAU); x.fill(); }
  x.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  goboCache.set(g, t);
  return t;
}

// ---------- shows: a whole rig programmed in one click ----------
export const SHOWS: [string, string, string][] = [
  ['dinner', 'Elegant dinner', 'Still, warm, gently breathing washes'],
  ['walk-in', 'Walk-in', 'Slow sweeps and a soft palette fade'],
  ['first-dance', 'First dance', 'Slow circles on the dance floor, warm and romantic'],
  ['party', 'Party', 'Ballyhoo, colour chases and pulses on the beat'],
  ['concert', 'Concert', 'Fast fans with prisms and gobos, strobe hits'],
  ['off', 'No effects', 'Every fixture still at its own aim'],
];
/** The effect each fixture gets in a show (moving heads move; static fixtures only dim and change colour). */
export function showFx(show: string, o: SceneObject, palette: string[]): LightFx | null {
  const moving = /^moving-head|^beam$|follow/.test(o.variant || ''), up = o.variant === 'uplighter' || o.variant === 'floor-wash' || o.variant === 'strip-batten';
  const pal = palette.length ? palette : ['#FFB46B', '#FF5A8C', '#7A5CFF'];
  switch (show) {
    case 'dinner': return { move: 'static', dimmer: 'breathe', colour: 'steady', speed: 12, spread: 0.6 };
    case 'walk-in': return moving ? { move: 'sweep', dimmer: 'steady', colour: 'fade', speed: 16, size: 22, spread: 0.5, palette: pal } : { dimmer: 'steady', colour: 'fade', speed: 12, palette: pal, spread: 0.4 };
    case 'first-dance': return moving ? { move: 'circle', dimmer: 'steady', colour: 'steady', speed: 10, size: 10, spread: 0.25, gobo: 'breakup', goboSpin: 0.6 } : up ? { dimmer: 'breathe', colour: 'steady', speed: 10 } : { dimmer: 'steady' };
    case 'party': return moving ? { move: 'ballyhoo', dimmer: 'pulse', colour: 'chase', speed: 124, size: 35, spread: 0.7, palette: pal } : { dimmer: 'chase', colour: 'chase', speed: 124, palette: pal, spread: 1 };
    case 'concert': return moving ? { move: 'fan', dimmer: 'steady', colour: 'fade', speed: 128, size: 40, spread: 1, palette: pal, prism: o.variant === 'beam', gobo: o.variant === 'moving-head-spot' ? 'rays' : 'none', goboSpin: 2 } : o.variant === 'blinder' ? { dimmer: 'strobe', strobeHz: 10 } : { dimmer: 'pulse', colour: 'fade', speed: 128, palette: pal };
    default: return null;
  }
}
