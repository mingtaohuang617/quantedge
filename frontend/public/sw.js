// QuantEdge Service Worker — 最小可用版（静态资源缓存 + 离线兜底）
// 版本号变化会触发新 SW 安装 → 自动清理旧缓存
const VERSION = "v1";
const CACHE = `quantedge-${VERSION}`;
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// 策略:
//  - 同源 GET: 静态资源 cache-first, HTML network-first(带离线兜底)
//  - 跨域 / API: 直接 network, 不缓存
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 让跨域请求自己走

  const isAsset = /\.(js|css|woff2?|ttf|svg|png|jpg|webp|ico)$/i.test(url.pathname);
  if (isAsset) {
    event.respondWith(
      caches.match(request).then((hit) => hit ||
        fetch(request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }).catch(() => caches.match("/index.html"))
      )
    );
    return;
  }

  // HTML / 其他 — 网络优先, 失败回落到缓存 shell
  event.respondWith(
    fetch(request).then((res) => {
      if (res && res.ok && request.destination === "document") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/index.html", copy));
      }
      return res;
    }).catch(() => caches.match(request).then((hit) => hit || caches.match("/index.html")))
  );
});
