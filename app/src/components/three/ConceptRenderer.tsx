// Native: concepts are rendered from the 3D on the web app (it needs WebGL and a hidden 3D view).
import type { Scene, Venue } from '@/lib/types';

export type ConceptJob = { key: string; scene: Scene; plan?: unknown };
export type ConceptResult = { url: string | null; matches?: boolean; issues?: string[]; error?: string };

export default function ConceptRenderer(_props: { jobs: ConceptJob[]; venue: Venue | null; onResult: (key: string, r: ConceptResult) => void }) {
  return null;
}
