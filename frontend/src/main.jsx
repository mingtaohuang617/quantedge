import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import QuantPlatform from '../quant-platform.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

// Recharts 在 React.StrictMode 双挂载期会产生瞬时 0 尺寸的 noisy warn，
// 图表最终渲染正确；静默该类警告以保留真实错误的信号。
{
  const _origWarn = console.warn.bind(console);
  const filteredWarn = (msg, ...rest) => {
    if (typeof msg === 'string' && (
      msg.includes('width(0) and height(0)') ||
      msg.includes('width(0)') && msg.includes('height(0)')
    )) return;
    _origWarn(msg, ...rest);
  };
  try {
    Object.defineProperty(console, 'warn', { value: filteredWarn, writable: true, configurable: true });
  } catch {
    console.warn = filteredWarn;
  }
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
