// Novira programs and focuses the lighting itself, the way a lighting designer
// would for this kind of event — no consoles or menus for the user:
//  · a show that suits the event (a wedding opens with a gentle walk-in look,
//    a launch or party gets moving, a conference stays still and calm);
//  · haze to match (a light haze for a dinner, thicker for a concert);
//  · every new fixture aimed where it belongs: truss and stand lights on the
//    stage at performer height or on the dance floor, pinspots on the tables.
import { seek, setPlaying, setTimeline, showFx, type Moment } from './lightFx';
import type { Scene, SceneObject } from './types';

/** The look Novira runs for each kind of event. */
export function autoShow(eventType = ''): string {
  if (/party|launch|concert|festival/.test(eventType)) return 'party';
  if (/conference|summit|exhibition|expo/.test(eventType)) return 'dinner';
  return 'walk-in'; // weddings, galas, dinners: elegant, gently moving
}
const AUTO_HAZE: Record<string, number> = { 'walk-in': 0.45, dinner: 0.25, 'first-dance': 0.55, party: 0.7, concert: 0.85 };

const palette = (scene: Scene): string[] => (scene.plan as any)?.design?.theme?.palette?.map((c: { hex: string }) => c.hex) || [];

/** Give every light that has no program the show for `show` (or the event's own look), and the haze that goes with it. */
export function programLights(scene: Scene, show?: string, all = false): Scene {
  const look = show && show !== 'auto' ? show : autoShow(scene.plan?.eventType);
  const pal = palette(scene);
  const objects = scene.objects.map((o) => {
    if (o.type !== 'light' || (!all && o.spec?.fx)) return o;
    const fx = showFx(look, o, pal), spec = { ...(o.spec || {}) };
    if (fx) spec.fx = fx; else delete spec.fx;
    return { ...o, spec };
  });
  const haze = all || scene.environment?.haze == null ? AUTO_HAZE[look] ?? 0.5 : scene.environment.haze;
  return { ...scene, objects, environment: { ...scene.environment, haze } };
}

/** Pan and tilt (degrees) that point a fixture at a spot, in the fixture's own frame (tilt + is down). */
export function aimAt(o: SceneObject, at: [number, number, number]) {
  const yaw = o.rotation?.[1] || 0, dx = at[0] - o.position[0], dy = at[1] - o.position[1], dz = at[2] - o.position[2];
  const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw); // into the fixture's frame
  return { pan: Math.round((Math.atan2(lx, lz) * 180) / Math.PI), tilt: Math.round((Math.atan2(-dy, Math.hypot(lx, lz)) * 180) / Math.PI) };
}

/** Where a new fixture should point: what a lighting designer would focus it on. */
export function autoFocus(o: SceneObject, objects: SceneObject[]): [number, number, number] | null {
  if (o.type !== 'light') return null;
  const v = o.variant || '';
  if (/uplighter|floor-wash|strip-batten/.test(v)) return null; // these wash the wall they stand at
  const near = (type: string) => objects.filter((x) => x.type === type).sort((a, b) => Math.hypot(a.position[0] - o.position[0], a.position[2] - o.position[2]) - Math.hypot(b.position[0] - o.position[0], b.position[2] - o.position[2]))[0];
  if (v === 'pinspot') { const t = near('round_table') || near('long_table') || near('cocktail_table'); if (t) return [t.position[0], t.position[1] + t.size[1] + 0.3, t.position[2]]; }
  const stage = near('stage'), dance = near('dance_floor');
  const onStage = stage && [stage.position[0], stage.position[1] + stage.size[1] + 1.5, stage.position[2]] as [number, number, number]; // performer height
  const onFloor = dance && [dance.position[0], 0.8, dance.position[2]] as [number, number, number];
  if (!onStage) return onFloor || null;
  if (!onFloor) return onStage;
  // moving heads share the work: closer to the dance floor than the stage → the floor
  const d = (p: [number, number, number]) => Math.hypot(p[0] - o.position[0], p[2] - o.position[2]);
  return /^moving-head|^beam$/.test(v) && d(onFloor) < d(onStage) ? onFloor : onStage;
}

/** The evening as a lighting designer would run it for this kind of event (each moment a preview-length while, looping). */
export function timelineFor(eventType = ''): Moment[] {
  if (/party|launch|concert|festival/.test(eventType)) return [
    { show: 'walk-in', label: 'Doors', seconds: 30 }, { show: 'party', label: 'Party', seconds: 45 }, { show: 'concert', label: 'Headline', seconds: 40 }, { show: 'party', label: 'Party', seconds: 35 },
  ];
  if (/conference|summit|exhibition|expo/.test(eventType)) return [
    { show: 'walk-in', label: 'Walk-in', seconds: 30 }, { show: 'dinner', label: 'Keynote', seconds: 50 }, { show: 'walk-in', label: 'Break', seconds: 25 },
  ];
  if (/gala|dinner/.test(eventType)) return [
    { show: 'walk-in', label: 'Walk-in', seconds: 30 }, { show: 'dinner', label: 'Dinner', seconds: 40 }, { show: 'concert', label: 'Awards', seconds: 30 }, { show: 'party', label: 'Party', seconds: 40 },
  ];
  return [ // weddings and celebrations
    { show: 'walk-in', label: 'Walk-in', seconds: 30 }, { show: 'dinner', label: 'Dinner', seconds: 40 }, { show: 'first-dance', label: 'First dance', seconds: 35 }, { show: 'party', label: 'Party', seconds: 45 },
  ];
}

/** Run the lighting: 'auto' plays the event's timeline; any other moment holds that look. Returns the scene to save. */
export function startShow(scene: Scene, moment = 'auto'): Scene {
  if (moment === 'auto') {
    setTimeline(timelineFor(scene.plan?.eventType), palette(scene));
    seek(0);
    setPlaying(true);
    return scene;
  }
  setTimeline([]);
  const next = programLights(scene, moment, true);
  setPlaying(true);
  return next;
}
