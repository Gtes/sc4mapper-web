import type { City } from "../lib/sc4mapper";

const DB_NAME = "sc4mapper-web";
const STORE = "draft";
const KEY = "map";

export type MapDraft = {
  pixels: ArrayBuffer;
  width: number;
  height: number;
  tilesX: number;
  tilesY: number;
  cities: City[];
  originalCities: City[];
  regionName: string;
  overlay: boolean;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

export async function saveDraft(draft: MapDraft): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("draft save failed"));
      tx.objectStore(STORE).put(draft, KEY);
    });
  } finally {
    db.close();
  }
}

export async function clearDraft(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("draft clear failed"));
      tx.objectStore(STORE).clear();
    });
  } finally {
    db.close();
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export async function loadDraft(): Promise<MapDraft | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as MapDraft | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("draft load failed"));
    });
  } finally {
    db.close();
  }
}
