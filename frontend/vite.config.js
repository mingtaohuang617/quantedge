import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ─── Yahoo Finance Proxy: 服务端 Cookie 管理 ──────────────────
// vite dev proxy 在服务端发请求，可跨域维护 cookie 会话
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const yahooCookies = { value: '' };

function mergeSetCookies(setCookieHeaders) {
  if (!setCookieHeaders) return;
  const items = (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders])
    .map(c => c.split(';')[0]);
  const existing = yahooCookies.value ? yahooCookies.value.split('; ') : [];
  const map = new Map();
  [...existing, ...items].forEach(c => {
    const eq = c.indexOf('=');
    if (eq > 0) map.set(c.slice(0, eq).trim(), c);
  });
  yahooCookies.value = [...map.values()].join('; ');
}

function configureYahooProxy(proxy) {
  proxy.on('proxyRes', (proxyRes) => mergeSetCookies(proxyRes.headers['set-cookie']));
  proxy.on('proxyReq', (proxyReq) => {
    if (yahooCookies.value) proxyReq.setHeader('Cookie', yahooCookies.value);
    proxyReq.setHeader('User-Agent', YAHOO_UA);
  });
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? './' : '/',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      // Yahoo consent 页面 — 用于获取初始 cookies
      '/yahoo-consent': {
        target: 'https://fc.yahoo.com',
        changeOrigin: true,
        rewrite: () => '/',
        configure: configureYahooProxy,
      },
      // Yahoo Finance API 代理
      '/yahoo-api': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yahoo-api/, ''),
        configure: configureYahooProxy,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'esnext',
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1500,
    // C2: 关掉 lazy chunk 的 modulepreload — 让 recharts/各 page chunk 真正按需加载
    // 否则 <link rel="modulepreload"> 会让浏览器在首屏就把它们拉下来，违背懒加载初衷
    modulePreload: {
      resolveDependencies: (filename, deps) => {
        // 仅保留主壳依赖（quant-platform / icons-vendor / react-vendor）
        // 过滤掉 page chunks 和 recharts-vendor，让它们随 dynamic import 才加载
        return deps.filter(d =>
          !d.includes('recharts-vendor') &&
          !d.includes('/Journal-') &&
          !d.includes('/Monitor-') &&
          !d.includes('/BacktestEngine-') &&
          !d.includes('/ScoringDashboard-') &&
          !d.includes('/stats-')
        );
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'recharts-vendor': ['recharts'],
          'icons-vendor': ['lucide-react'],
        },
      },
    },
  },
}));
