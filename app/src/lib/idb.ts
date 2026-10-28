// A tiny key-value store on IndexedDB, for things too large for localStorage
// (the editor's undo history). Every call fails quietly: storage is a convenience.
const DB = 'novira', STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}

export async function idbSet(key: string, value: unknown) {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* private window or storage full: history just isn't kept */ }
}

/** A short fingerprint of a JSON value, the same whatever order its keys are in. */
export function fingerprint(v: unknown): string {
  const canon = (x: any): string => (x === null || typeof x !== 'object' ? JSON.stringify(x) ?? 'null'
    : Array.isArray(x) ? `[${x.map(canon).join(',')}]`
      : `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`);
  const s = canon(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}:${s.length}`;
}
