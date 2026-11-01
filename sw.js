// Service worker: app-shell cache + Android share_target intake.
// Never intercepts auth/Graph traffic (cross-origin) - those must always hit the
// network. No sensitive data is ever cached: the brief and threads are fetched
// live per session and rendered in memory. A shared image/audio waits in
// IndexedDB only until the capture tab takes it into the open envelope.

const CACHE = "ah-shell-v54"; // 01/11/2026: share_target is POST with files - images and audio join the open envelope
// v53 (25/10/2026): valid_on at display time, past events, demo loads once with phase-1 fields
// v52 (25/10/2026): "הוכן לך" gets a reply line and "כן, להפעיל"; partial-refresh label
// v51 (22/10/2026): gigs box shows what the scanner left out (errors)
// v48 (15/10/2026): brief "הוכן לך" section (answers the executor wrote into threads)
// 16/08/2026: counter.js נוסף ב-175db9b ומעולם לא נכנס לרשימה כאן, כלומר אופליין
// הדלפק לא נטען כלל. domains.js חדש. שניהם נכנסים, והגרסה עולה כדי שהמטמון הישן
// לא ישרוד ויגיש קליפה חסרה.
const SHELL = [
  "./", "./index.html", "./app.css", "./tokens.css", "./manifest.webmanifest",
  "./app.js", "./auth.js", "./graph.js", "./config.js", "./queue.js", "./domains.js",
  "./brief.js", "./threads.js", "./capture.js", "./questions.js", "./actions.js", "./engine.js", "./answer.js", "./counter.js", "./ui.js", "./brief-sample.json", "./gigs-sample.json", "./engine-board-sample.json",
  "./read-aloud-neural.js",
  "./alma-enso.jpg", "./icon-192.png", "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// --- share_target intake (01/11/2026, pattern from threads-intake/sw.js) ---
// Same DB and store as takeShares in queue.js; a classic SW can't import it.
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

async function storeShare(payload) {
  const db = await openSharesDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("shares", "readwrite");
    payload.createdAt = Date.now();
    t.objectStore("shares").add(payload);
    t.oncomplete = () => { db.close(); resolve(); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

// No postMessage to open windows: the redirect below navigates the window that
// receives the share, and its capture tab takes the share on load.
async function handleShare(request) {
  try {
    const form = await request.formData();
    await storeShare({
      title: form.get("title") || "",
      text: form.get("text") || "",
      url: form.get("url") || "",
      // every shared image/audio becomes a part of the same open envelope (capture.js)
      files: form.getAll("media").filter((f) => f && f.size).map((f) => ({ blob: f, type: f.type, name: f.name })),
    });
  } catch { /* a share that can't be read still lands on the capture tab */ }
  return Response.redirect("./?share=1", 303);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.origin === self.location.origin && url.pathname.endsWith("/share-target/")) {
    e.respondWith(handleShare(e.request));
    return;
  }

  if (e.request.method !== "GET") return;
  // Only serve same-origin shell from cache. Auth (login.microsoftonline.com)
  // and Graph (graph.microsoft.com) are cross-origin -> always network.
  if (url.origin !== self.location.origin) return;

  // NETWORK-FIRST for the same-origin shell (fix 30/06). The old cache-first
  // strategy + register-and-forget froze installed PWAs on stale code, so deploys
  // never reached the phone (and the pre-responsive CSS kept causing sideways
  // scroll). Online -> always the latest; offline -> fall back to cache.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
