/**
 * IndexedDB cache for generated charts (uploaded-audio path). Analysing audio is
 * comparatively expensive, so we key the result by a fingerprint of the file and
 * reuse it next time. Gems are small JSON; the audio itself is NOT stored (the
 * user re-selects the file, which is also the privacy-friendly choice).
 */
import type { Gem } from "../game/chart";

const DB_NAME = "fretstorm";
const STORE = "charts";

interface CachedChart {
  key: string;
  gems: Gem[];
  bpm: number;
  duration: number;
  title: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function fingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function getCachedChart(key: string): Promise<CachedChart | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CachedChart) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedChart(c: CachedChart): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(c);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* ignore cache failures */
  }
}

export type { CachedChart };
