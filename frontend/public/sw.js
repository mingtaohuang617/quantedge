// QuantEdge Service Worker — H5 升级版
// - 静态资源 cache-first
// - HTML network-first + 离线兜底
// - /api/yahoo stale-while-revalidate（即刻返回缓存 + 后台刷新，命中率↑速度↑）
// 版本号变化会触发新 SW 安装 → 自动清理旧缓存
const VERSION = "v2";
const CACHE = `quantedge-${VERSION}`;
const API_CACHE = `quantedge-api-${VERSION}`;
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
      // 清理旧版本，但保留当前版本的 API cache
      await Promise.all(
        keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// 监听 client 触发的消息（例如让 SW 立即激活）
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// 策略:
//  - 同源 GET: 静态资源 cache-first, HTML network-first(带离线兜底)
//  - /api/yahoo: stale-while-revalidate（行情可短暂陈旧）
//  - 跨域 / 其他 API: 直接 network, 不缓存
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 让跨域请求自己走

  // /api/yahoo: stale-while-revalidate
  if (url.pathname.startsWith("/api/yahoo")) {
    event.respondWith(
      caches.open(API_CACHE).then((c) =>
        c.match(request).then((cached) => {
          // 后台刷新（不阻塞）
          const fetchPromise = fetch(request).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              c.put(request, copy);
            }
            return res;
          }).catch(() => cached); // 网络失败时回退缓存
          // 立即返回缓存，没有缓存就等网络
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

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
