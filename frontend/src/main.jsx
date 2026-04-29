import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import QuantPlatform from './quant-platform.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

// H7: Sentry 错误监控 — 仅当配置了 DSN 时启用
// 在 Vercel 控制台设置环境变量 VITE_SENTRY_DSN 即可激活
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN && import.meta.env.PROD) {
  // 异步加载，避免没启用时也带上 Sentry bundle
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION || 'quantedge@dev',
      // 性能监控采样率 — 默认 10% 节省额度
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE) || 0.1,
      // 仅捕获生产环境真实用户错误
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Non-Error promise rejection captured',
      ],
      beforeSend(event, hint) {
        // 过滤本地浏览器扩展引发的报错
        const fileName = event?.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename;
        if (fileName && (fileName.startsWith('chrome-extension://') || fileName.startsWith('moz-extension://'))) {
          return null;
        }
        return event;
      },
    });
    console.info('[QuantEdge] Sentry 错误监控已启用');
  }).catch((e) => console.warn('[QuantEdge] Sentry 加载失败：', e));
}

// Recharts 在 React.StrictMode 双挂载期会瞬时报告 0×0 尺寸 — 图表会自我修复。
// 仅 dev 环境过滤这一类 warn；生产环境不染指 console。
if (import.meta.env.DEV) {
  const origWarn = console.warn;
  console.warn = (msg, ...rest) => {
    if (typeof msg === 'string' && msg.includes('width(0)') && msg.includes('height(0)')) return;
    origWarn(msg, ...rest);
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QuantPlatform />
    </ErrorBoundary>
  </React.StrictMode>
);

// H5: PWA Service Worker — 仅生产环境注册，避免 Vite dev HMR 与 SW 冲突
// 检测到新版本 → dispatch 'quantedge:swUpdate' 事件，让 UI 显示"更新可用"
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            // 已有控制者 = 不是首装 = 真有新版本
            window.dispatchEvent(new CustomEvent('quantedge:swUpdate', { detail: { reg } }));
          }
        });
      });
      // 1 小时检查一次更新
      setInterval(() => reg.update().catch(() => {}), 3600 * 1000);
    }).catch(() => {});
    // controllerchange = 新 SW 已激活 → 刷新页面以使用新代码
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
