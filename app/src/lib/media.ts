// The media library on the client: pick, measure and upload images and videos.
import { api, fileUrl, upload } from './api';

export type Media = { id: number; kind: 'image' | 'video'; source: string; name: string; file_url: string; width: number | null; height: number | null; created_at: string };

export const isMediaFile = (f: File) => /^(image|video)\//.test(f.type);
export const listMedia = () => api<Media[]>('/media');
export const deleteMedia = (id: number) => api(`/media/${id}`, { method: 'DELETE' });

/** Opens the browser's file chooser. */
export function pickFile(accept = 'image/*,video/*'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

function measure(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const done = (v: { width: number; height: number } | null) => { URL.revokeObjectURL(url); resolve(v); };
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight });
      v.onerror = () => done(null);
      v.src = url;
    } else {
      const i = new Image();
      i.onload = () => done({ width: i.naturalWidth, height: i.naturalHeight });
      i.onerror = () => done(null);
      i.src = url;
    }
  });
}

export async function uploadMedia(file: File, onProgress?: (pct: number) => void): Promise<Media> {
  const form = new FormData();
  form.append('file', file);
  const size = await measure(file);
  if (size) { form.append('width', String(size.width)); form.append('height', String(size.height)); }
  return upload<Media>('/media', form, onProgress);
}

export const mediaSrc = (m: Pick<Media, 'file_url'>) => fileUrl(m.file_url);
