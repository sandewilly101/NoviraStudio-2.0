export type Vec3 = [number, number, number];

export type ObjectType =
  | 'stage' | 'led_screen' | 'lectern' | 'speaker' | 'bar' | 'dance_floor'
  | 'round_table' | 'long_table' | 'cocktail_table' | 'chair' | 'centrepiece' | 'sofa'
  | 'sign' | 'model'
  | 'tent' | 'truss' | 'curtain' | 'booth' | 'light'
  | 'chandelier' | 'ceiling_drape' | 'arch';

export interface ObjectAsset {
  url: string;
  name: string;
  thumbnail?: string | null;
  author?: string | null;
  license?: string | null;
  source?: string;
  externalId?: string;
  /** what it was found as ("indoor plant"), so replacing it again searches for the same kind of thing */
  kind?: string;
}

export interface SceneObject {
  id: string;
  type: ObjectType;
  name: string;
  position: Vec3;
  rotation: Vec3;
  size: Vec3;
  color: string;
  material?: 'matte' | 'gloss' | 'fabric' | 'metal' | 'wood';
  text?: { content: string; color?: string; sub?: string; accent?: string };
  imageUrl?: string;
  modelUrl?: string;
  label?: string;
  group?: string;
  ledStrip?: boolean;
  userAdded?: boolean;
  /** Real models keep their own materials unless the user picked a colour. */
  tint?: boolean;
  /** Round tables: floor-length tablecloth (default on). */
  linen?: boolean;
  /** A sourced model chosen to replace the catalogue default for this object. */
  asset?: ObjectAsset;
  /** Procedural objects (Nozila builds): the preset / variety in use, e.g. a tent family or LED panel. */
  variant?: string;
  /** Extra procedural settings (LED curve and frame, stage stairs, tent canopy…). */
  spec?: Record<string, any>;
  /** What a display surface shows (LED wall, poster, banner, backdrop, stand graphic). */
  content?: SurfaceContent;
  /** Real materials on its surfaces, by surface (deck, skirt, fabric, cloth, carpet, walls, floor, body). */
  finish?: Record<string, Finish>;
}

/** A real material (Poly Haven PBR scan) on a surface. */
export interface Finish {
  slug: string;
  name: string;
  thumb: string;
  maps: { color: string; normal?: string; roughness?: string; ao?: string };
  /** Real-world width of one tile of the scan, metres. */
  sizeM: number;
  /** Extra scale on top of the real size (0.5 = finer, 2 = larger pattern). */
  scale?: number;
  tint?: string;
}

/** A design (layout + words + logo + photo + colours) or a media file (image / looping video). */
export interface SurfaceContent {
  mode: 'design' | 'media';
  template?: 'headline' | 'logo' | 'split' | 'agenda' | 'sponsors' | 'speaker' | 'photo';
  title?: string;
  subtitle?: string;
  /** Agenda lines ("19:00 - Welcome"), sponsor names, or a third line — one per line. */
  body?: string;
  logoUrl?: string;
  /** Photo used by the photo / split / speaker layouts. */
  imageUrl?: string;
  bg?: string;
  fg?: string;
  accent?: string;
  font?: 'sans' | 'serif' | 'display';
  align?: 'center' | 'left';
  /** Darkening under text on a full-bleed photo, 0–1. */
  overlay?: number;
  mediaUrl?: string;
  mediaKind?: 'image' | 'video';
  /** cover: fill the surface (crop); contain: show it all (letterbox in mediaBg). */
  fit?: 'cover' | 'contain';
  mediaBg?: string;
}

export interface Plan {
  eventName: string;
  eventType: string;
  guests: number;
  layout: 'banquet' | 'theater' | 'feast' | 'cocktail';
  seatsPerTable: number;
  walkway: number;
  include: Record<string, boolean>;
  stage: { width: number; depth: number; height: number };
  colors: { linen: string; chair: string; accent: string; stage: string; uplight: string };
  screenText: string;
  mode: 'day' | 'night';
}

/** Lighting environment (Poly Haven HDRI). Lights the scene and its reflections. */
export interface Hdri {
  slug: string;
  name: string;
  thumb: string;
  /** Local copy of the .hdr, under /uploads/hdri. */
  url: string;
  /** Show the HDRI itself behind the room (off: plain backdrop). */
  background?: boolean;
  intensity?: number;
  /** Turns the environment around the vertical axis: aims the sun. */
  rotationDeg?: number;
}

export interface Check { level: 'ok' | 'warn'; text: string }

export interface Scene {
  units: 'm';
  venueId: number | null;
  plan: Plan;
  environment: { mode?: 'day' | 'night'; /** how hazy the room is for the lighting (0 clear … 1 thick), default 0.6 */ haze?: number;
    /** where it happens: inside a venue (default) or in the open air, on this ground */
    setting?: 'indoor' | 'outdoor';
    ground?: 'grass' | 'sand' | 'paving'; uplight?: string; ambient?: number; hdri?: Hdri | null; /** materials on the venue's own surfaces, by the venue model's material name */ venueFinishes?: Record<string, Finish> };
  objects: SceneObject[];
  checks: Check[];
  stats: { seats: number; tables?: number; rows?: number };
}

export interface VenueAnalysis {
  scale: number;
  offset: Vec3;
  size: Vec3;
  floor: { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number };
  meshes: number;
  triangles: number;
  /** true once the real floor surface was found (not just the model's lowest point) */
  floorDetected?: boolean;
  /** true when the event room's walls were found (floor = that room only) */
  roomDetected?: boolean;
  /** analysis version; older ones are re-measured */
  v?: number;
}

export interface Venue {
  id: number;
  name: string;
  file_url: string;
  file_name: string;
  file_size: number;
  analysis: VenueAnalysis | null;
  status: 'uploaded' | 'ready';
  project_count?: number;
  created_at: string;
}

export interface Project {
  id: number;
  name: string;
  venue_id: number | null;
  venue_name?: string;
  event_type: string;
  guests: number;
  brief: string | null;
  status: 'draft' | 'in_review' | 'approved';
  share_token: string | null;
  thumbnail_url: string | null;
  version?: number;
  render_count?: number;
  updated_at: string;
  created_at: string;
}

export interface Render {
  id: number;
  project_id: number;
  project_name?: string;
  kind: 'image' | 'enhanced' | 'panorama' | 'video' | 'floorplan';
  file_url: string;
  created_at: string;
}

export interface BrandKit {
  id: number;
  name: string;
  logo_url: string | null;
  colors: { name: string; hex: string }[];
  fonts: { heading?: string; body?: string };
}

export interface Comment {
  id: number;
  author_name: string;
  author_role: string;
  body: string;
  position: Vec3 | null;
  resolved: number;
  created_at: string;
}
