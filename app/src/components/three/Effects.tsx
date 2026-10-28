// What makes the 3D view read like a lit room instead of a diagram:
//  · neutral (Khronos PBR) tone mapping, bloom on whatever really emits light (LED
//    walls, bulbs, candle flames, beams) and, in the evening, a soft vignette;
//  · LED walls that light the room: each is an area light the size of its face,
//    in the average colour of what it is showing, spilling onto the stage,
//    floor and the people's side of the room — brighter in the evening.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { SceneObject } from '@/lib/types';
import { useSurfaceTexture } from '@/lib/content';

RectAreaLightUniformsLib.init(); // once: the uniforms area lights need

export function SceneEffects({ evening }: { evening: boolean }) {
  return (
    // no multisampling: bloom on a multisampled buffer renders a black frame on some Intel/Direct3D drivers — SMAA smooths the edges instead
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom mipmapBlur luminanceThreshold={evening ? 0.75 : 0.92} luminanceSmoothing={0.25} intensity={evening ? 0.85 : 0.4} radius={0.7} />
      <Vignette offset={0.32} darkness={evening ? 0.5 : 0.18} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} /> {/* keeps fabric and brand colours true, unlike AgX */}
      <SMAA />
    </EffectComposer>
  );
}

/** The average colour of an image (sampled small), or null while it isn't drawable. */
// the last reading per picture: a playing video changes every frame, its glow needn't be re-read every frame
const sampled = new WeakMap<object, { at: number; colour: THREE.Color | null }>();
function averageColour(img: CanvasImageSource | undefined): THREE.Color | null {
  if (!img) return null;
  const had = sampled.get(img), now = performance.now();
  if (had && now - had.at < 500) return had.colour;
  const colour = readColour(img);
  sampled.set(img, { at: now, colour });
  return colour;
}
function readColour(img: CanvasImageSource): THREE.Color | null {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch { return null; } // a cross-origin image can't be read: fall back to warm white
}

/** An LED wall as a light source: an area light over its face, facing the audience. */
export function LedSpill({ o, evening }: { o: SceneObject; evening: boolean }) {
  const tex = useSurfaceTexture(o);
  const ref = useRef<THREE.RectAreaLight>(null);
  const [W, H] = o.size, yaw = o.rotation?.[1] || 0;
  const colour = useMemo(() => averageColour(tex?.image as CanvasImageSource | undefined) || new THREE.Color('#FFF1DE'), [tex, tex?.version]); // eslint-disable-line react-hooks/exhaustive-deps -- re-sampled when the content redraws
  // keep the light from washing everything white: tint by colour, scale by how bright the content is
  const lum = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
  const intensity = (evening ? 7 : 2.5) * (0.4 + lum);
  const at = useMemo(() => {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), y = o.position[1] + H / 2;
    return { pos: new THREE.Vector3(o.position[0] + fx * 0.12, y, o.position[2] + fz * 0.12), look: new THREE.Vector3(o.position[0] + fx * 5, y - 0.6, o.position[2] + fz * 5) };
  }, [o.position, H, yaw]);
  useEffect(() => { ref.current?.lookAt(at.look); }, [at]);
  return <rectAreaLight ref={ref} position={at.pos} width={W} height={H} color={colour} intensity={intensity} />;
}
