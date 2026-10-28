import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4150').replace(/\/$/, '');
const TOKEN_KEY = 'novira.token';

let token: string | null = null;
export async function loadToken() {
  token = await AsyncStorage.getItem(TOKEN_KEY);
  return token;
}
/** The signed-in user's token, for connections that can't send headers (the live channel). */
export const authToken = () => token;
export async function setToken(t: string | null) {
  token = t;
  if (t) await AsyncStorage.setItem(TOKEN_KEY, t);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

// Server stores file links as /uploads/...; turn them into full URLs.
export const fileUrl = (u?: string | null) => (!u ? '' : /^https?:|^data:|^blob:/.test(u) ? u : `${API_URL}${u}`);

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// keepalive: the request survives the page closing (used to save on refresh / tab close)
export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: any;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, keepalive: opts.keepalive });
  } catch {
    throw new ApiError(`Can't reach the Novira server at ${API_URL}. Is it running?`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

// Upload with progress (XHR), used for large venue files.
export function upload<T = any>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || `Upload failed (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection.', 0));
    xhr.send(form);
  });
}

export const timeAgo = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const formatBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`);
