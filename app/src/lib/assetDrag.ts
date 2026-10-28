// Dragging an item from Add objects into the 3D view, plus the warm caches
// that make it instant: library search pages are fetched (and their
// thumbnails decoded) as soon as the editor opens, and a library model starts
// importing the moment it is pressed or dragged, so it is usually ready on drop.
import { useEffect, useState } from 'react';
import { api } from './api';
import type { ObjectAsset, SceneObject, Vec3 } from './types';

export const ASSET_MIME = 'application/x-novira-object';

export type LibraryResult = { source: string; externalId: string; name: string; author?: string; license?: string; thumbnail?: string | null; needsKey?: boolean; viewerUrl?: string; downloadApiUrl?: string };
export type NewObject = Omit<SceneObject, 'id' | 'position'> & { position?: Vec3 };
/** What is being dragged: a built-in object (`make`), a library model (`library`) or a material (`material`). */
export type DragPayload = { label: string; thumb?: string | null; note?: string; make?: () => NewObject; library?: LibraryResult; material?: { slug: string; name: string } };

/** What releasing would do, given where the pointer is now — shown on the chip before the drop. */
export type DropIntent =
  | { type: 'none' }
  | { type: 'place'; x: number; z: number; y: number; onTruss?: boolean; on?: string }
  | { type: 'paint'; text: string; objectId?: string; slot?: string; venueKey?: string }
  | { type: 'reject'; reason: string };

// ---------- the drag in progress (HTML drag events don't expose their data until the drop) ----------
let current: DragPayload | null = null;
let intent: DropIntent = { type: 'none' };
let intentKey = '';
let busy: string | null = null;
let pointer = { x: 0, y: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let frame = 0;
const track = (e: DragEvent) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; emit(); });
};

const blank = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }) : null;

export function startAssetDrag(e: DragEvent, p: DragPayload) {
  current = p;
  e.dataTransfer?.setData(ASSET_MIME, p.label);
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'copy'; if (blank) e.dataTransfer.setDragImage(blank, 0, 0); } // our own card follows the pointer instead
  pointer = { x: e.clientX, y: e.clientY };
  document.addEventListener('dragover', track);
  if (p.library) importLibraryModel(p.library).catch(() => undefined); // get a head start on the download
  emit();
}
/** Publish what the drop would do (only re-renders the chip when it actually changes). */
export function setDropIntent(next: DropIntent) {
  const key = JSON.stringify(next.type === 'place' ? { ...next, x: Math.round(next.x * 20), z: Math.round(next.z * 20), y: Math.round(next.y * 20) } : next);
  if (key === intentKey) return;
  intentKey = key; intent = next; emit();
}
export const dropIntent = () => intent;
export function setDragBusy(label: string | null) { busy = label; emit(); }

export function endAssetDrag() {
  current = null; intent = { type: 'none' }; intentKey = '';
  document.removeEventListener('dragover', track);
  emit();
}
export const draggedAsset = () => current;

/** The item being dragged and where the pointer is (re-renders at most once a frame). */
export function useAssetDrag() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return { payload: current, pointer, intent, busy };
}

// ---------- library pages, cached and fetched ahead ----------
type Page = { results: LibraryResult[]; next: string | null };
const pages = new Map<string, Promise<Page>>();
const thumbs = new Set<string>();
const decode = (urls: (string | null | undefined)[]) => urls.forEach((u) => { if (u && !thumbs.has(u)) { thumbs.add(u); const i = new Image(); i.decoding = 'async'; i.src = u; } });

export function librarySearch(source: string, q = '', cursor: string | null = null): Promise<Page> {
  const key = `${source}|${q.toLowerCase()}|${cursor || ''}`;
  let p = pages.get(key);
  if (!p) {
    const params = new URLSearchParams({ source, q });
    if (cursor) params.set('cursor', cursor);
    p = api<Page>(`/assets/search?${params}`);
    pages.set(key, p);
    p.then((r) => decode(r.results.map((x) => x.thumbnail))).catch(() => pages.delete(key));
  }
  return p;
}
/** A page already fetched (so a tab shows its results immediately). */
export const cachedPage = (source: string, q = '') => peek.get(`${source}|${q.toLowerCase()}|`) || null;
const peek = new Map<string, Page>();
const remember = (source: string, q: string, r: Page) => { peek.set(`${source}|${q.toLowerCase()}|`, r); return r; };
export const libraryFirstPage = (source: string, q = '') => librarySearch(source, q).then((r) => remember(source, q, r));

let warmed = false;
/** Fetch every library's opening page (and decode its thumbnails) in the background. */
export function prefetchLibraries() {
  if (warmed) return;
  warmed = true;
  for (const s of ['blenderkit', 'polyhaven', 'sketchfab']) libraryFirstPage(s).then((r) => { if (r.next) librarySearch(s, '', r.next); }).catch(() => { warmed = false; });
}

// ---------- what an imported model is (for models placed before they carried it) ----------
type AssetRow = { source: string; external_id: string | null; name: string; author: string | null; license: string | null; thumbnail_url: string | null; file_url: string | null };
let imported: Promise<Map<string, ObjectAsset>> | null = null;
/** The library record behind an imported model file: name, thumbnail, source. */
export function importedAsset(fileUrl: string): Promise<ObjectAsset | null> {
  if (!imported) {
    imported = api<AssetRow[]>('/assets').then((rows) => new Map(rows.filter((r) => r.file_url).map((r) => [r.file_url!, {
      url: r.file_url!, name: r.name, thumbnail: r.thumbnail_url, author: r.author, license: r.license, source: r.source, externalId: r.external_id || undefined,
    }])));
    imported.catch(() => { imported = null; });
  }
  return imported.then((m) => m.get(fileUrl) || null);
}
/** `importedAsset` as a hook: null until known (or when there is no record). */
export function useImportedAsset(fileUrl?: string | null) {
  const [found, setFound] = useState<{ url: string; asset: ObjectAsset | null } | null>(null);
  useEffect(() => {
    if (!fileUrl) return;
    let live = true;
    importedAsset(fileUrl).then((asset) => { if (live) setFound({ url: fileUrl, asset }); }).catch(() => undefined);
    return () => { live = false; };
  }, [fileUrl]);
  return found && found.url === fileUrl ? found.asset : null;
}

// ---------- imports, started early and shared ----------
export type ImportedAsset = { file_url: string; size?: Vec3 | null; name?: string };
const imports = new Map<string, Promise<ImportedAsset>>();
export function importLibraryModel(m: LibraryResult): Promise<ImportedAsset> {
  const key = `${m.source}|${m.externalId}`;
  let p = imports.get(key);
  if (!p) { p = api<ImportedAsset>('/assets/import', { body: m }); imports.set(key, p); p.catch(() => imports.delete(key)); }
  return p;
}

// ---------- where the preview is, updated every frame without re-rendering React ----------
/** The live landing spot of the dragged object (the 3D preview reads it each frame). */
export const ghostSpot = { x: 0, y: 0, z: 0, ry: 0 };
