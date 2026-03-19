import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for the ShackleAI dashboard.
 *
 * Two servers are started before tests run:
 *   - API server  : apps/cli (Hono, port 4321) — real PGlite DB, no auth
 *   - Dashboard   : apps/dashboard (Vite dev server, port 5173)
 *
 * Tests live in tests/browser/.
 *
 * Modes:
 *   pnpm test:browser          — headless CI mode
 *   pnpm test:browser:ui       — Playwright UI mode (visual test runner)
 *   pnpm test:browser:debug    — step-through debug mode (headed)
 *   pnpm test:browser:codegen  — record tests by clicking
 */

const isDebug = !!process.env.PWDEBUG || process.env.HEADED === '1'
const isUI = !!process.env.PW_UI

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: !isDebug,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : isDebug ? 1 : undefined,

  /** Reporter — rich list for local, github annotations for CI */
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    /** Dashboard base URL */
    baseURL: 'http://localhost:5173',

    /**
     * Real-time visual recording — always on for local debug/UI modes,
     * on-first-retry only in CI to save disk space.
     */
    video: process.env.CI ? 'on-first-retry' : 'on',

    /**
     * Screenshots — always on for local visual testing, failure-only in CI.
     */
    screenshot: process.env.CI ? 'only-on-failure' : 'on',

    /**
     * Trace viewer — on-first-retry everywhere. Open with:
     *   npx playwright show-trace playwright-report/trace.zip
     */
    trace: 'on-first-retry',

    /**
     * Headed mode — enabled for debug and UI modes so you can watch tests run.
     */
    headless: process.env.CI ? true : !isDebug && !isUI ? false : false,

    /** Give UI actions more time when watching in headed mode */
    actionTimeout: isDebug ? 0 : 10_000,

    /** Navigation timeout */
    navigationTimeout: 30_000,
  },

  /** Per-test timeout */
  timeout: 30_000,

  /** Global setup/teardown */
  globalSetup: './tests/browser/global-setup.ts',
  globalTeardown: './tests/browser/global-teardown.ts',

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile',
      // Mobile viewport — runs smoke tests only (auth API + page load checks).
      // Navigation and complex UI tests require desktop sidebar and are excluded.
      testMatch: ['**/auth-flow.spec.ts', '**/dashboard-loads.spec.ts'],
      use: {
        // Pixel 5 uses Chromium — no separate browser install needed
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'tablet',
      // Tablet viewport — runs auth + core UI tests.
      // Theme tests excluded: theme toggle is in sidebar drawer (off-screen on tablet).
      // Uses a Chromium-based profile to avoid requiring WebKit installation.
      testMatch: ['**/auth-flow.spec.ts', '**/dashboard-loads.spec.ts', '**/tasks-crud.spec.ts'],
      use: {
        ...devices['Galaxy Tab S4'],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],

  webServer: [
    {
      /**
       * Start the API server with a real PGlite in-memory database.
       * SHACKLEAI_SKIP_AUTH=1 disables API key auth — safe for tests only.
       * SHACKLEAI_SEED=1 triggers the seed script to populate Acme Corp data.
       */
      command: 'pnpm exec tsx apps/cli/src/dev-server.ts',
      url: 'http://localhost:4321/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        SHACKLEAI_PORT: '4321',
        SHACKLEAI_SKIP_AUTH: '1',
        SHACKLEAI_SEED: '1',
        NODE_ENV: 'test',
      },
    },
    {
      /** Start the Vite dashboard dev server */
      command: 'pnpm --filter shackleai-dashboard exec vite --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // vite.config.ts already proxies /api → localhost:4321
    },
  ],
})
