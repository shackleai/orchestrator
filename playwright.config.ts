import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for the ShackleAI dashboard.
 *
 * Two servers are started before tests run:
 *   - API server  : apps/cli (Hono, port 4321)
 *   - Dashboard   : apps/dashboard (Vite dev server, port 5173)
 *
 * Tests live in tests/browser/.
 */

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    /** Dashboard base URL */
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      /**
       * Start the API server via ts-node / tsx.
       * The server must export a startup script that binds to port 4321.
       * SHACKLEAI_SKIP_AUTH=1 disables key auth so tests can call APIs freely.
       */
      command:
        'node_modules/.bin/tsx apps/cli/src/dev-server.ts',
      url: 'http://localhost:4321/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        SHACKLEAI_PORT: '4321',
        SHACKLEAI_SKIP_AUTH: '1',
        NODE_ENV: 'test',
      },
    },
    {
      /** Start the Vite dashboard dev server */
      command: 'pnpm --filter shackleai-dashboard exec vite --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      // No extra env needed — vite.config.ts already proxies /api → localhost:4321
    },
  ],
})
