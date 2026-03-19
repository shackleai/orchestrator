/**
 * Playwright test fixtures for ShackleAI E2E tests.
 *
 * Design principles:
 *   - NO MOCKS — all interactions go through the real Hono API on port 4321
 *   - NO MOCK DB — PGlite runs embedded, real SQL, real migrations
 *   - Every fixture cleans up after itself via unique identifiers
 *   - The `apiBase` and `companyId` fixtures resolve values from the live server
 *
 * Usage:
 *   import { test, expect } from './fixtures'
 *
 *   test('my test', async ({ page, companyId, apiBase, seedAgent }) => { ... })
 */

import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestAgent {
  id: string
  name: string
  status: string
  role: string
}

export interface TestTask {
  id: string
  identifier: string
  title: string
  status: string
}

export interface TestComment {
  id: string
  issue_id: string
  content: string
}

// ---------------------------------------------------------------------------
// Helpers — raw API calls against the real server (no auth in test mode)
// ---------------------------------------------------------------------------

const API_PORT = process.env.SHACKLEAI_PORT ?? '4321'
export const API_BASE = `http://localhost:${API_PORT}/api`

/**
 * Fetch the first company from the running API server.
 * The dev-server always seeds at least one company (Test Company / Acme Corp).
 */
export async function resolveCompanyId(request: APIRequestContext): Promise<string> {
  const resp = await request.get(`${API_BASE}/companies`)
  expect(resp.ok(), `GET /api/companies failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const companies: Array<{ id: string }> = body.data
  if (!companies || companies.length === 0) {
    throw new Error('No companies found — dev-server seed may have failed')
  }
  return companies[0].id
}

/**
 * Create an agent via the real API and return the created record.
 */
export async function createTestAgent(
  request: APIRequestContext,
  companyId: string,
  overrides: Partial<{ name: string; role: string; title: string }> = {},
): Promise<TestAgent> {
  const name = overrides.name ?? `e2e-agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const resp = await request.post(`${API_BASE}/companies/${companyId}/agents`, {
    data: {
      name,
      role: overrides.role ?? 'worker',
      title: overrides.title ?? null,
      adapter_type: 'process',
      adapter_config: { command: 'echo hello', args: [], timeout: 30 },
      budget_monthly_cents: 1000,
    },
  })
  expect(resp.ok(), `POST /agents failed: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return body.data as TestAgent
}

/**
 * Create a task (issue) via the real API and return the created record.
 */
export async function createTestTask(
  request: APIRequestContext,
  companyId: string,
  overrides: Partial<{ title: string; status: string; priority: string; assigneeAgentId: string }> = {},
): Promise<TestTask> {
  const title = overrides.title ?? `E2E Task ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const resp = await request.post(`${API_BASE}/companies/${companyId}/issues`, {
    data: {
      title,
      status: overrides.status ?? 'todo',
      priority: overrides.priority ?? 'medium',
      assignee_agent_id: overrides.assigneeAgentId ?? null,
    },
  })
  expect(resp.ok(), `POST /issues failed: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return body.data as TestTask
}

/**
 * Create a comment on a task via the real API.
 */
export async function createTestComment(
  request: APIRequestContext,
  companyId: string,
  issueId: string,
  content: string,
): Promise<TestComment> {
  const resp = await request.post(`${API_BASE}/companies/${companyId}/issues/${issueId}/comments`, {
    data: { content },
  })
  expect(resp.ok(), `POST /comments failed: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return body.data as TestComment
}

/**
 * Navigate to the dashboard and wait for the sidebar to be visible,
 * confirming the page has fully loaded with company data.
 */
export async function waitForDashboardReady(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// Extended test fixture — extends Playwright base with shared helpers
// ---------------------------------------------------------------------------

type ShackleFixtures = {
  /** Resolved company ID from the live API — use this in all API calls */
  companyId: string
  /** Base URL for raw API calls within tests */
  apiBase: string
  /** Pre-seeded agent for tests that need one to exist already */
  seedAgent: TestAgent
  /** Pre-seeded task for tests that need one to exist already */
  seedTask: TestTask
  /** Navigate to dashboard and wait for it to be ready */
  dashboardReady: void
}

export const test = base.extend<ShackleFixtures>({
  companyId: async ({ request }, use) => {
    const id = await resolveCompanyId(request)
    await use(id)
  },

  apiBase: async ({}, use) => {
    await use(API_BASE)
  },

  seedAgent: async ({ request, companyId }, use) => {
    const agent = await createTestAgent(request, companyId, {
      name: `seed-agent-${Date.now()}`,
      role: 'worker',
      title: 'E2E Test Agent',
    })
    await use(agent)
    // No teardown needed — PGlite is in-memory and resets per server process
  },

  seedTask: async ({ request, companyId }, use) => {
    const task = await createTestTask(request, companyId, {
      title: `Seed Task ${Date.now()}`,
      status: 'todo',
      priority: 'medium',
    })
    await use(task)
  },

  dashboardReady: async ({ page }, use) => {
    await waitForDashboardReady(page)
    await use()
  },
})

export { expect }
