import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import QuantPlatform from './quant-platform.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

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

// PWA — 仅生产环境注册，避免 Vite dev HMR 与 SW 冲突
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
