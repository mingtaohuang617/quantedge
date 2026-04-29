// H6: Playwright E2E 配置
// - 默认对 vite preview server (http://localhost:4173) 测试
// - CI 中先 npm run build 再 npm run preview，本配置自动启动 preview
// - 仅 Chromium，CI 时间从 ~2 分钟压到 ~30 秒
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests-e2e',
  // CI 串行更稳定（避免本机端口冲突）；本地可并发
  fullyParallel: !isCI,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // 仅当未指定 E2E_BASE_URL 时才本地启动 preview server
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run preview -- --port ' + PORT + ' --strictPort',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
