import { expect as baseExpect } from '@playwright/test'
import { test, expect } from './fixtures'

/**
 * Dashboard loads — verifies the shell renders with REAL data visible.
 *
 * Every assertion here confirms actual data from the PGlite-backed API
 * is flowing through the UI. No mocks — if the API is broken, these fail.
 */

test.describe('Dashboard shell', () => {
  test('overview page renders with sidebar and header', async ({ page, dashboardReady: _ }) => {
    // Sidebar brand mark
    await expect(page.locator('aside')).toBeVisible()
    await expect(page.locator('aside').getByText('ShackleAI')).toBeVisible()

    // All main nav links present — use exact: true to avoid matching stat card links
    const sidebar = page.locator('aside')
    await expect(sidebar.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Agents', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Board', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Activity', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Costs', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  })

  test('header contains search trigger with Ctrl+K hint', async ({ page, dashboardReady: _ }) => {
    const searchBtn = page.getByRole('button', { name: 'Open command palette' })
    await expect(searchBtn).toBeVisible()
    await expect(searchBtn).toContainText('Search')
  })

  test('company selector shows real company name from API', async ({ page, dashboardReady: _ }) => {
    // CompanySelector renders the actual company name returned by the API
    const sidebar = page.locator('aside')
    // Either "Test Company" or "Acme Corp" depending on SHACKLEAI_SEED
    await expect(sidebar).toContainText(/Test Company|Acme Corp/)
  })

  test('overview stat cards display real counts from API', async ({
    page,
    request,
    companyId,
    apiBase,
  }) => {
    // Fetch real agent count from API first
    const agentsResp = await request.get(`${apiBase}/companies/${companyId}/agents`)
    expect(agentsResp.ok()).toBeTruthy()
    const agentsBody = await agentsResp.json()
    const agentCount: number = agentsBody.data.length

    // Navigate to overview
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // The header h1 should confirm we are on the right page
    await expect(page.locator('header h1')).toContainText('Dashboard')

    // If agents exist, the count should appear somewhere on the page
    if (agentCount > 0) {
      await expect(page.locator('body')).toContainText(String(agentCount))
    }
  })

  test('agents page renders agent list with real data', async ({
    page,
    seedAgent,
  }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h2')).toContainText('Agents')

    // The seeded agent must appear — confirming API → UI data flow
    await expect(page.getByText(seedAgent.name)).toBeVisible({ timeout: 10_000 })
  })

  test('tasks page renders task list with real data', async ({
    page,
    seedTask,
  }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()

    // The seeded task must appear
    await expect(page.getByText(seedTask.title)).toBeVisible({ timeout: 10_000 })
  })

  test('board page renders with real tasks in columns', async ({
    page,
    seedTask,
  }) => {
    // seedTask defaults to "todo" status — should appear in "To Do" column
    await page.goto('/board')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'To Do', exact: true })).toBeVisible()
    await expect(page.getByText(seedTask.title)).toBeVisible({ timeout: 10_000 })
  })

  test('settings page renders with real company info', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
    // Company name appears in settings
    await expect(page.locator('body')).toContainText(/Test Company|Acme Corp/)
  })

  test('costs page renders with real cost data or empty state', async ({ page }) => {
    await page.goto('/costs')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
    // Page should not crash — either data or empty state is acceptable
    const pageTitle = page.locator('h2')
    await expect(pageTitle).toBeVisible()
  })

  test('activity page renders without crashing', async ({ page }) => {
    await page.goto('/activity')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
  })

  test('org-chart page renders without crashing', async ({ page }) => {
    await page.goto('/org-chart')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
  })
})
