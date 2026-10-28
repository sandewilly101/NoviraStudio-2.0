// Hung fabric that swings when it is moved: a curtain on its pipe, a ceiling
// drape between its fixings (physics in lib/clothSway).
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { local, newMover, restingPendulum, swing, track } from '@/lib/clothSway';
import type { SceneObject } from '@/lib/types';

/**
 * Fabric hung from a line — a curtain on its pipe, a ceiling drape between its
 * fixings — swings about that line when moved: the body is tilted about its top
 * edge by the swing of its hem. `top` is the height of the line in the object's space.
 */
export function Swing({ o, top, length, damping = 0.18, children }: { o: SceneObject; top: number; length: number; damping?: number; children: ReactNode }) {
  const tilt = useRef<THREE.Group>(null);
  const live = useRef(o);
  live.current = o; // eslint-disable-line react-hooks/refs -- the frame loop reads the latest placement
  const sim = useMemo(() => ({ mover: newMover(), p: restingPendulum(), out: [0, 0, 0], resting: true }), []);
  const fabric = useMemo(() => ({ length: Math.max(0.4, length), damping }), [length, damping]);
  /* eslint-disable react-hooks/immutability -- the simulation's scratch state, stepped every frame */
  useFrame((_, dt) => {
    const g = tilt.current, cur = live.current;
    if (!g) return;
    const yaw = cur.rotation?.[1] || 0;
    track(sim.mover, cur.position[0], cur.position[2], yaw, dt);
    const moving = swing(sim.p, fabric, sim.mover, dt);
    if (!moving && sim.resting) return;
    sim.resting = !moving;
    local(sim.p, yaw, sim.out);
    // pinned along its top edge: it can only swing across it (about the local x axis)
    g.rotation.x = moving ? -Math.asin(Math.max(-0.5, Math.min(0.5, sim.out[1] / fabric.length))) : 0;
  });
  /* eslint-enable react-hooks/immutability */
  return (
    <group position={[0, top, 0]}>
      <group ref={tilt}>
        <group position={[0, -top, 0]}>{children}</group>
      </group>
    </group>
  );
}
