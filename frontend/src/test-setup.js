// vitest setup — 为 jsdom 环境的组件测试加 @testing-library/jest-dom 扩展
// （toBeInTheDocument / toHaveTextContent 等 matcher）
import '@testing-library/jest-dom/vitest';

// recharts 的 ResponsiveContainer 用 ResizeObserver；jsdom 没实现。
// 给它一个 no-op stub，让图表渲染时不抛 ReferenceError。
// （图表的实际尺寸是 0×0，但我们的测试只验证 DOM 文本/结构，不验证可视尺寸。）
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
