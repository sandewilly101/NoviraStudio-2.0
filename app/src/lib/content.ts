// Content on display surfaces — LED walls, posters, roll-ups, backdrops, media
// walls, hanging banners, TVs, stand graphics. A surface shows either a
// *design* (a layout filled with the event's words, logo, photo and brand
// colours, drawn at the surface's real proportions) or *media* (an uploaded or
// generated image, or a looping video).
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { fileUrl } from './api';
import type { SceneObject, SurfaceContent } from './types';

export const TEMPLATES = [
  { key: 'headline', label: 'Headline', note: 'Event name, line and date' },
  { key: 'logo', label: 'Logo lock-up', note: 'Logo above the event name' },
  { key: 'split', label: 'Photo split', note: 'Photo on one side, words on the other' },
  { key: 'agenda', label: 'Agenda', note: 'Times and sessions, one per line' },
  { key: 'sponsors', label: 'Sponsor wall', note: 'Repeating names or logos' },
  { key: 'speaker', label: 'Speaker', note: 'Photo, name and title' },
  { key: 'photo', label: 'Full-bleed photo', note: 'Photo with a title over it' },
] as const;
export type TemplateKey = (typeof TEMPLATES)[number]['key'];

export const FONTS = { sans: 'Segoe UI, Helvetica Neue, Arial, sans-serif', serif: 'Georgia, Garamond, Times New Roman, serif', display: 'Impact, Arial Black, Haettenschweiler, sans-serif' } as const;

/** Surfaces that can carry content. */
export const hasSurface = (o: SceneObject) => o.type === 'led_screen' || o.type === 'sign' || o.type === 'booth' || (o.type === 'stage' && !!o.spec?.fascia && o.spec.fascia !== 'none');

/** The content of a surface, reading older projects' `text` / `imageUrl` too. */
export function contentOf(o: SceneObject): SurfaceContent {
  if (o.content) return o.content;
  if (o.imageUrl) return { mode: 'media', mediaUrl: o.imageUrl, mediaKind: 'image', fit: 'cover' };
  return { mode: 'design', template: 'headline', title: o.text?.content || o.name, subtitle: o.text?.sub || '', bg: o.type === 'booth' ? '#FFFFFF' : o.color || '#0E2A4A', fg: o.text?.color || '#FFFFFF', accent: o.text?.accent || '#C9A227', font: 'sans' };
}

/** The face of a surface in metres, and the pixels it can really show (LED) or should be printed at. */
export function surfaceFace(o: SceneObject): { w: number; h: number; px: [number, number]; kind: 'led' | 'print' | 'screen'; note: string } {
  const [W, H] = o.size;
  if (o.type === 'led_screen') {
    const pitch = Number(o.spec?.pitchMm) || pitchOf(o.variant);
    const px: [number, number] = [Math.round((W * 1000) / pitch), Math.round((H * 1000) / pitch)];
    return { w: W, h: H, px, kind: 'led', note: `Native ${px[0]} × ${px[1]} px at ${pitch} mm pitch — design at exactly this size` };
  }
  if (o.type === 'stage') {
    // the stage front: a printed skirt panel, or an LED fascia strip (3.9 mm)
    const w = W, h = Math.max(0.1, H - 0.04);
    if (o.spec?.fascia === 'led') { const px: [number, number] = [Math.round((w * 1000) / 3.9), Math.round((h * 1000) / 3.9)]; return { w, h, px, kind: 'led', note: `LED fascia · ${px[0]} × ${px[1]} px — a long, slim artwork` }; }
    const px: [number, number] = [Math.round((w / 0.0254) * 72), Math.round((h / 0.0254) * 72)];
    return { w, h, px, kind: 'print', note: `Printed stage skirt ${w.toFixed(2)} × ${h.toFixed(2)} m · ${px[0]} × ${px[1]} px` };
  }
  const f = displayFace(o);
  if (o.type === 'sign' && o.variant === 'tv') return { ...f, px: [3840, 2160], kind: 'screen', note: '4K screen · 3840 × 2160 px' };
  const dpi = f.w * f.h > 4 ? 72 : 150, px: [number, number] = [Math.round((f.w / 0.0254) * dpi), Math.round((f.h / 0.0254) * dpi)];
  return { ...f, px, kind: 'print', note: `Print ${f.w.toFixed(2)} × ${f.h.toFixed(2)} m · supply ${px[0]} × ${px[1]} px (${dpi} dpi)` };
}
const PITCH: Record<string, number> = { 'p1-9-indoor': 1.9, 'p2-6-indoor': 2.6, 'p3-9-indoor': 3.9, 'p4-8-outdoor': 4.8, 'p6-25-floor': 6.25, 'p10-outdoor': 10 };
const pitchOf = (v?: string) => PITCH[v || ''] || 3.9;

/** The printed / screen face of each display variant (see Display.tsx). */
export function displayFace(o: SceneObject): { w: number; h: number } {
  const [W, H] = o.size;
  switch (o.type === 'booth' ? 'booth' : o.variant || defaultDisplay(o)) {
    case 'easel': return { w: W - 0.06, h: Math.max(0.3, H - 0.82) };
    case 'rollup': return { w: W - 0.02, h: H - 0.13 };
    case 'backdrop': return { w: W, h: H - 0.03 };
    case 'media-wall': return { w: W - 0.05, h: H - 0.1 };
    case 'hanging': return { w: W, h: H };
    case 'tv': return { w: W - 0.04, h: (W - 0.04) * (9 / 16) };
    case 'booth': return { w: W - 0.1, h: H - 0.15 };
    default: return { w: W, h: H };
  }
}
export const defaultDisplay = (o: SceneObject) => (o.size[0] >= 2.5 ? 'backdrop' : 'easel');

// ---------- drawing a design ----------
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  const src = /^(data:|blob:|https?:)/.test(url) ? url : fileUrl(url);
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  return imgCache.get(src)!;
}
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, contain = false) {
  const k = (contain ? Math.min : Math.max)(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); g.restore();
}
function fitText(g: CanvasRenderingContext2D, text: string, weight: string, font: string, max: number, maxW: number) {
  let s = max;
  g.font = `${weight} ${s}px ${font}`;
  while (s > 8 && g.measureText(text).width > maxW) { s *= 0.92; g.font = `${weight} ${s}px ${font}`; }
  return s;
}
function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return `#${c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt))).getHexString()}`;
}

/** Draws a design onto a canvas of the given pixel size. */
export async function drawDesign(c: SurfaceContent, w: number, h: number, canvas = document.createElement('canvas')) {
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d')!;
  const bg = c.bg || '#0E2A4A', fg = c.fg || '#FFFFFF', accent = c.accent || '#C9A227', font = FONTS[c.font || 'sans'];
  const u = Math.min(w, h), pad = u * 0.08, left = c.align === 'left';
  const [logo, photo] = await Promise.all([loadImage(c.logoUrl), loadImage(c.imageUrl)]);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, bg); grad.addColorStop(1, shade(bg, -0.18));
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.textBaseline = 'middle';
  const text = (s: string, x: number, y: number, size: number, weight = '700', color = fg, maxW = w - pad * 2, align: CanvasTextAlign = left ? 'left' : 'center') => {
    if (!s) return 0;
    g.fillStyle = color; g.textAlign = align;
    const k = fitText(g, s, weight, font, size, maxW);
    g.fillText(s, x, y);
    return k;
  };
  const tx = left ? pad : w / 2;
  const title = c.title || '', sub = c.subtitle || '', lines = (c.body || '').split('\n').map((s) => s.trim()).filter(Boolean);

  switch (c.template || 'headline') {
    case 'photo': {
      if (photo) cover(g, photo, 0, 0, w, h);
      const shadeH = h * 0.42, sh = g.createLinearGradient(0, h - shadeH, 0, h);
      sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, `rgba(0,0,0,${c.overlay ?? 0.65})`);
      g.fillStyle = sh; g.fillRect(0, h - shadeH, w, shadeH);
      text(title, tx, h - pad - u * 0.16, u * 0.14);
      text(sub, tx, h - pad - u * 0.04, u * 0.06, '500', accent);
      break;
    }
    case 'split': {
      const pw = w * 0.5;
      if (photo) cover(g, photo, 0, 0, pw, h); else { g.fillStyle = shade(bg, 0.12); g.fillRect(0, 0, pw, h); }
      g.fillStyle = accent; g.fillRect(pw, 0, u * 0.012, h);
      const cx = pw + (w - pw) / 2;
      if (logo) cover(g, logo, cx - u * 0.15, h * 0.18, u * 0.3, u * 0.16, true);
      text(title, cx, h * 0.5, u * 0.11, '700', fg, w - pw - pad * 2, 'center');
      text(sub, cx, h * 0.5 + u * 0.12, u * 0.05, '500', accent, w - pw - pad * 2, 'center');
      break;
    }
    case 'logo': {
      if (logo) cover(g, logo, w / 2 - u * 0.3, h * 0.12, u * 0.6, h * 0.36, true);
      text(title, w / 2, h * 0.64, u * 0.11, '700', fg, w - pad * 2, 'center');
      g.fillStyle = accent; g.fillRect(w / 2 - u * 0.12, h * 0.64 + u * 0.08, u * 0.24, Math.max(2, u * 0.006));
      text(sub, w / 2, h * 0.64 + u * 0.15, u * 0.05, '500', fg, w - pad * 2, 'center');
      break;
    }
    case 'agenda': {
      text(title || 'Programme', tx, pad + u * 0.07, u * 0.09);
      g.fillStyle = accent; g.fillRect(left ? pad : w / 2 - u * 0.1, pad + u * 0.14, u * 0.2, Math.max(2, u * 0.006));
      const top = pad + u * 0.24, row = Math.min(u * 0.1, (h - top - pad) / Math.max(1, lines.length));
      lines.forEach((l, i) => {
        const [time, ...rest] = l.split(/\s+[-–—|]\s+|\s{2,}/);
        const y = top + row * (i + 0.5);
        if (rest.length) { text(time, pad, y, row * 0.5, '700', accent, w * 0.22, 'left'); text(rest.join(' '), pad + w * 0.26, y, row * 0.5, '500', fg, w * 0.7 - pad, 'left'); }
        else text(l, tx, y, row * 0.5, '500');
      });
      break;
    }
    case 'sponsors': {
      text(title || 'Thank you to our partners', w / 2, pad + u * 0.06, u * 0.07, '600', fg, w - pad * 2, 'center');
      const names = lines.length ? lines : ['Partner'], cols = Math.max(1, Math.round(Math.sqrt(names.length * (w / h)))), rows = Math.ceil(names.length / cols);
      const top = pad + u * 0.16, cw = (w - pad * 2) / cols, rh = (h - top - pad) / rows;
      names.forEach((n, i) => {
        const x = pad + (i % cols) * cw, y = top + Math.floor(i / cols) * rh;
        g.strokeStyle = shade(bg, 0.15); g.lineWidth = Math.max(1, u * 0.003); g.strokeRect(x + cw * 0.06, y + rh * 0.12, cw * 0.88, rh * 0.76);
        text(n, x + cw / 2, y + rh / 2, rh * 0.3, '700', fg, cw * 0.8, 'center');
      });
      break;
    }
    case 'speaker': {
      const r = Math.min(h * 0.32, w * 0.2), cx = left ? pad + r : w * 0.3, cy = h / 2;
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
      if (photo) cover(g, photo, cx - r, cy - r, r * 2, r * 2); else { g.fillStyle = shade(bg, 0.15); g.fill(); }
      g.restore();
      g.strokeStyle = accent; g.lineWidth = Math.max(2, u * 0.01); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      const x = cx + r + pad;
      text(title, x, cy - u * 0.06, u * 0.1, '700', fg, w - x - pad, 'left');
      text(sub, x, cy + u * 0.06, u * 0.055, '500', accent, w - x - pad, 'left');
      if (logo) cover(g, logo, w - pad - u * 0.2, h - pad - u * 0.08, u * 0.2, u * 0.08, true);
      break;
    }
    default: { // headline
      if (logo) cover(g, logo, w / 2 - u * 0.12, pad * 1.2, u * 0.24, u * 0.12, true);
      text(title, tx, sub ? h / 2 - u * 0.05 : h / 2, u * 0.16);
      text(sub, tx, h / 2 + u * 0.1, u * 0.065, '500', accent);
      if (lines[0]) text(lines[0], tx, h / 2 + u * 0.2, u * 0.045, '400', fg);
    }
  }
  return canvas;
}

/** Pixel size to draw a design at: the surface's own proportions, capped for the browser. */
export function drawSize(o: SceneObject, max = 2048): [number, number] {
  const f = surfaceFace(o), k = Math.min(1, max / Math.max(f.px[0], f.px[1]));
  return [Math.max(64, Math.round(f.px[0] * k)), Math.max(64, Math.round(f.px[1] * k))];
}

// ---------- textures for the 3D view ----------
const videoCache = new Map<string, HTMLVideoElement>();
function videoElement(url: string) {
  let v = videoCache.get(url);
  if (!v) {
    v = document.createElement('video');
    Object.assign(v, { src: fileUrl(url), crossOrigin: 'anonymous', loop: true, muted: true, playsInline: true, autoplay: true });
    v.play().catch(() => undefined);
    videoCache.set(url, v);
  }
  return v;
}

/** A texture showing a surface's content (design, image or looping video), or null while it loads. */
export function useSurfaceTexture(o: SceneObject): THREE.Texture | null {
  const c = contentOf(o);
  const [w, h] = drawSize(o);
  const key = JSON.stringify([c, w, h]);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on what the surface shows
  const content = useMemo(() => c, [key]);
  useEffect(() => {
    let live = true, made: THREE.Texture | null = null;
    (async () => {
      if (content.mode === 'media' && content.mediaUrl && content.mediaKind === 'video') {
        made = new THREE.VideoTexture(videoElement(content.mediaUrl));
      } else if (content.mode === 'media' && content.mediaUrl) {
        const img = await loadImage(content.mediaUrl);
        if (!img) return;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const g = canvas.getContext('2d')!;
        g.fillStyle = content.mediaBg || '#000000'; g.fillRect(0, 0, w, h);
        cover(g, img, 0, 0, w, h, content.fit === 'contain');
        made = new THREE.CanvasTexture(canvas);
      } else {
        made = new THREE.CanvasTexture(await drawDesign(content, w, h));
      }
      if (!live) { made.dispose(); return; }
      made.colorSpace = THREE.SRGBColorSpace; made.anisotropy = 8;
      setTex(made);
    })();
    return () => { live = false; made?.dispose(); };
  }, [content, w, h]);
  return tex;
}
