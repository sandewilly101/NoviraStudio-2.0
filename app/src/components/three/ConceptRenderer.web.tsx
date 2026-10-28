// Renders each design's concept picture FROM its 3D scene: one hidden,
// full-quality 3D view at a time, framed like an event photographer's hero shot
// (from the back of the room, above the guests' heads, looking at the stage),
// waited on until every model has loaded, then sent to be made photoreal with
// everything kept exactly as built (POST /projects/concept).
import { createElement, useEffect, useRef, useState } from 'react';
import SceneView from './SceneView';
import { frameHero, nextFrames, settled, snapshot, visibleIds, type CaptureCtx } from './capture';
import { api } from '@/lib/api';
import type { Scene, Venue } from '@/lib/types';

export type ConceptJob = { key: string; scene: Scene; plan?: unknown };
export type ConceptResult = { url: string | null; matches?: boolean; issues?: string[]; error?: string };

const W = 1536, H = 1024; // exactly the photoreal model's 3:2 canvas: nothing is cropped or reframed

export default function ConceptRenderer({ jobs, venue, onResult }: { jobs: ConceptJob[]; venue: Venue | null; onResult: (key: string, r: ConceptResult) => void }) {
  const [current, setCurrent] = useState<ConceptJob | null>(null);
  const queue = useRef<ConceptJob[]>([]);
  const ready = useRef<((c: CaptureCtx) => void) | null>(null);
  // the 3D view reports itself again once its orbit controls exist: framing must move those too, or they
  // turn the camera back to their own target on the next frame
  const latest = useRef<CaptureCtx | null>(null);
  const venueIn = useRef<(() => void) | null>(null);
  const started = useRef(new Set<string>());
  const report = useRef(onResult);
  useEffect(() => { report.current = onResult; });

  // new jobs join the queue; one 3D view at a time works through it
  useEffect(() => {
    for (const j of jobs) if (!started.current.has(j.key)) { started.current.add(j.key); queue.current.push(j); }
    if (!current && queue.current.length) setCurrent(queue.current.shift()!);
  }, [jobs, current]);

  useEffect(() => {
    if (!current) return;
    let live = true;
    (async () => {
      // the 3D view, then the venue model (it is the biggest download), then everything else settling
      const venueLoaded = venue ? new Promise<void>((res) => { venueIn.current = res; setTimeout(res, 90000); }) : Promise.resolve();
      latest.current = null; // this design's own 3D view, not the last one
      const first = await new Promise<CaptureCtx>((res) => { ready.current = res; });
      const ctx = () => latest.current || first;
      await venueLoaded;
      // framed first: what loads (near detail, the small things culled from afar) depends on where the camera is
      frameHero(ctx(), current.scene);
      await settled(ctx());
      if (!live) return;
      frameHero(ctx(), current.scene);
      await nextFrames(4);
      const dataUrl = snapshot(ctx()), visible = visibleIds(ctx(), current.scene.objects);
      // the next design starts loading while this one is being rendered
      setCurrent(queue.current.shift() || null);
      try {
        const r = await api<{ url: string; matches: boolean; issues: string[] }>('/projects/concept', { body: { dataUrl, scene: current.scene, plan: current.plan, visible } });
        report.current(current.key, { url: r.url, matches: r.matches, issues: r.issues });
      } catch (e: any) { report.current(current.key, { url: null, error: e.message }); }
    })();
    return () => { live = false; };
  }, [current, venue]);

  if (!current) return null;
  // off screen, full size and full quality (shadows, effects), so the picture is the real thing
  return createElement('div', { 'aria-hidden': true, style: { position: 'fixed', left: -W - 200, top: 0, width: W, height: H, pointerEvents: 'none' } },
    <SceneView key={current.key} scene={current.scene} venue={venue} cutaway={false} onReady={(c) => { latest.current = c; ready.current?.(c); }} onVenueLoaded={() => venueIn.current?.()} />);
}
