import { useEffect, useState } from 'react';
import { api } from './api';

// Real, sourced furniture models used for the solver's object types.
export interface CatalogItem {
  type: string;
  name: string;
  file_url: string;
  thumbnail: string | null;
  author: string | null;
  license: string | null;
  /** drawn in clear glass whatever the model's own material says (glassware) */
  glass?: boolean;
  yaw: number;
  pitch?: number;
  stretch: boolean;
  linen?: boolean;
  stand?: boolean;
}

let cache: Record<string, CatalogItem> | null = null;
let pending: Promise<Record<string, CatalogItem>> | null = null;

export function loadCatalog() {
  if (cache) return Promise.resolve(cache);
  pending ||= api<CatalogItem[]>('/catalog')
    .then((items) => (cache = Object.fromEntries(items.map((i) => [i.type, i]))))
    .catch(() => (cache = {}));
  return pending;
}

export function useCatalog() {
  const [cat, setCat] = useState<Record<string, CatalogItem> | null>(cache);
  useEffect(() => { let live = true; loadCatalog().then((c) => live && setCat(c)); return () => { live = false; }; }, []);
  return cat;
}
