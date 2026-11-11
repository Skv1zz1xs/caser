import { defineConfig } from '@playwright/test'

/**
 * e2e на локальном стеке: `npm run e2e`.
 * Сам поднимает мини-Supabase (нужен локальный Postgres, см. scripts/devstack/start.ts) и собранный клиент.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off', launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined } },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-375', use: { viewport: { width: 375, height: 780 }, hasTouch: true, isMobile: true } },
  ],
  webServer: [
    { command: 'npm run stack -- --reset', url: 'http://127.0.0.1:54321/auth/v1/user', reuseExistingServer: true, timeout: 60_000, ignoreHTTPSErrors: true },
    { command: 'npm run build:stack && npx vite preview --port 4173 --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 120_000 },
  ],
})
