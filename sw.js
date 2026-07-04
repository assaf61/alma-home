// Service worker: app-shell cache only.
// Never intercepts auth/Graph traffic (cross-origin) - those must always hit the
// network. No sensitive data is ever cached: the brief and threads are fetched
// live per session and rendered in memory.

const CACHE = "ah-shell-v20";
const SHELL = [
  "./", "./index.html", "./app.css", "./tokens.css", "./manifest.webmanifest",
  "./app.js", "./auth.js", "./graph.js", "./config.js", "./queue.js",
  "./brief.js", "./threads.js", "./capture.js", "./questions.js", "./actions.js", "./ui.js", "./brief-sample.json",
  "./alma-mark.png", "./icon-192.png", "./icon-512.png",
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

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
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
