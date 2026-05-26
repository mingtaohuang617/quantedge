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
  // vitest 用 rolldown 而 plugin-react 的 esbuild JSX 配置被忽略；
  // 显式给 oxc 加 JSX automatic，让 .jsx 测试文件能解析
  oxc: { jsx: { runtime: 'automatic' } },
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
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // C2: 关掉 lazy chunk 的 modulepreload — 让 recharts/各 page chunk 真正按需加载
    // 否则 <link rel="modulepreload"> 会让浏览器在首屏就把它们拉下来，违背懒加载初衷
    //
    // LAZY_PAGES 与 quant-platform.jsx 顶端 lazy() 列表保持一致。新增 lazy page
    // 时把名字加进来，否则它会被默默预加载，浪费首屏带宽。
    modulePreload: {
      resolveDependencies: (filename, deps) => {
        const LAZY_PAGES = [
          'Journal', 'Monitor', 'BacktestEngine', 'ScoringDashboard',
          'MacroDashboard', 'Screener10x', 'MiningAlpha', 'StockGene',
          'SmartBeta', 'CompoundPower',
        ];
        // 仅保留主壳依赖（quant-platform / icons-vendor / react-vendor）
        return deps.filter(d => {
          if (d.includes('recharts-vendor') || d.includes('/stats-')) return false;
          return !LAZY_PAGES.some(name => d.includes(`/${name}-`));
        });
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
  // H6: vitest 排除 Playwright E2E 目录（避免 vitest 误跑 .spec.ts）
  test: {
    exclude: ['node_modules', 'dist', 'tests-e2e/**'],
    // 组件渲染测试在文件顶部用 `// @vitest-environment jsdom` 注释切换
    // （vitest 4 移除了 environmentMatchGlobs；setupFile 仍在全局 setup jest-dom matchers）
    setupFiles: ['./src/test-setup.js'],
  },
}));
