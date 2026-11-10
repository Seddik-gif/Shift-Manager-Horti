/* Horti Magici service worker: push notifications, offline fallback, in-app update prompt.
   Keep this file dependency-free. Bump CACHE when the offline page changes. */
const CACHE = "hm-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  // no skipWaiting here: the app shows "new version available" and asks the page to activate us
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("hm-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Pages are never cached (they are personal and live); if the network is down, show a friendly offline page.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return;
  event.respondWith(
    fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || new Response("Offline", { status: 503 })),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Horti Magici", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Horti Magici";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "hm",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
