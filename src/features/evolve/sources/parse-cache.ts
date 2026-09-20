import type { extractSource } from "./extract";

type Parsed = Awaited<ReturnType<typeof extractSource>>;
const DB = "evolve-source-index-v1";
const MAX_ENTRIES = 16;
const TTL = 7 * 24 * 60 * 60 * 1000;

async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("解析缓存等待超时")); }, 3000);
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains("entries") ? request.transaction!.objectStore("entries") : request.result.createObjectStore("entries");
      if (!store.indexNames.contains("savedAt")) store.createIndex("savedAt", "savedAt");
    };
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error("解析缓存暂不可用")); };
  });
}

export async function parseCacheKey(name: string, mimeType: string, buffer: Uint8Array) {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer).buffer);
  return `parser-1:${JSON.stringify([name, mimeType])}:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function readParseCache(key: string): Promise<Parsed | undefined> {
  if (typeof indexedDB === "undefined") return;
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    const value = await new Promise<{ savedAt: number; parsed: Parsed } | undefined>((resolve, reject) => {
      const request = db!.transaction("entries").objectStore("entries").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value && Date.now() - value.savedAt < TTL ? value.parsed : undefined;
  } catch { return undefined; } finally { db?.close(); }
}

/** Disposable cache only. Failure/quota exhaustion must never lose the original artifact. */
export async function writeParseCache(key: string, parsed: Parsed) {
  if (typeof indexedDB === "undefined") return;
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction("entries", "readwrite");
      const store = tx.objectStore("entries");
      // Bounded count; keys include a content hash, so edits never reuse stale offsets.
      store.put({ savedAt: Date.now(), parsed }, key);
      const keys = store.index("savedAt").getAllKeys();
      keys.onsuccess = () => {
        const other = keys.result.filter(k => k !== key);
        for (const old of other.slice(0, Math.max(0, other.length + 1 - MAX_ENTRIES))) store.delete(old);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* Cache is optional; a valid parse remains usable. */ } finally { db?.close(); }
}
