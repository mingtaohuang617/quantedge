// QuantEdge Service Worker — H5 升级版
// - 静态资源 cache-first
// - HTML network-first + 离线兜底
// - API 始终绕过 Service Worker 缓存，由 BFF 按数据类型执行时效策略
// 版本号变化会触发新 SW 安装 → 自动清理旧缓存
const VERSION = "v5";
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
      // 清理旧版本，包括旧的 API cache，避免过期行情被继续标记为实时
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
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
//  - /api/*: 直接 network，缓存和时效边界由同源 BFF 控制
//  - 跨域 / 其他 API: 直接 network, 不缓存
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 让跨域请求自己走

  if (url.pathname.startsWith("/api/")) return;

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
        })
        // ⚠ 不要 .catch(() => caches.match("/index.html")) — 那会把 .js 的网络失败
        // 兜底成 HTML，让 module loader 拿到 HTML 解析为 JS，触发 "Failed to fetch
        // dynamically imported module"，整个 lazy tab 永久挂掉。让真实错误自然抛
        // 上去，ErrorBoundary 或 import().catch() 能正常处理。
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
