/**
 * IndexedDB cache for imported audio blobs. Used by the in-app Import flow so a
 * song the player loaded once stays playable across reloads WITHOUT re-importing
 * — and crucially without ever uploading the file anywhere. Everything stays in
 * the browser on the player's device.
 *
 * (The local-dev `private_audio/` folder doesn't need this — it's read straight
 * from disk by the dev server. This is for the hosted/import path.)
 */

const DB_NAME = "fretstorm-media";
const STORE = "audio";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putAudio(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // quota/full → just skip caching
    });
  } catch {
    /* ignore */
  }
}

export async function getAudio(key: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function hasAudio(key: string): Promise<boolean> {
  return (await getAudio(key)) != null;
}

/** Keys of all cached audio (to mark which catalog songs are ready). */
export async function cachedAudioKeys(): Promise<string[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
