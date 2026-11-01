// Minimal IndexedDB KV (trimmed from threads-intake/queue.js).
// auth.js caches the Graph token via kvSet. 01/11/2026: incoming Android shares
// (image/audio) wait in their own DB below; no capture queue in this app.

const DB_NAME = "alma-home";
const DB_VER = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("kv", "readwrite");
    t.objectStore("kv").put(value, key);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export async function kvGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Incoming Android share_target payloads, written by sw.js (same open logic there).
// A separate DB, not a version bump of "alma-home": an upgrade would wait on every
// open token connection, and the share POST waits on the upgrade.
function openSharesDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("alma-home-shares", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("shares")) db.createObjectStore("shares", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Read and clear in one transaction, so a share is handed out once.
export async function takeShares() {
  const db = await openSharesDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("shares", "readwrite");
    const s = t.objectStore("shares");
    const r = s.getAll();
    r.onsuccess = () => s.clear();
    t.oncomplete = () => { db.close(); resolve(r.result || []); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}
