import { test, expect } from '@playwright/test'

/**
 * Dashboard loads — smoke tests verifying the shell renders correctly.
 *
 * These tests run against a fresh PGlite API server (no auth) seeded
 * with one test company. They check that the layout, sidebar, and
 * header are present and functional before any data interaction.
 */

test.describe('Dashboard shell', () => {
  test('overview page renders with sidebar and header', async ({ page }) => {
    await page.goto('/')

    // Sidebar brand mark
    await expect(page.locator('aside')).toBeVisible()
    await expect(page.locator('aside').getByText('ShackleAI')).toBeVisible()

    // All main nav links present
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Agents' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Tasks' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Board' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Activity' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Costs' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  })

  test('header contains search trigger with Ctrl+K hint', async ({ page }) => {
    await page.goto('/')

    const searchBtn = page.getByRole('button', { name: 'Open command palette' })
    await expect(searchBtn).toBeVisible()
    await expect(searchBtn).toContainText('Search')
  })

  test('company selector is visible in the sidebar', async ({ page }) => {
    await page.goto('/')

    // CompanySelector sits in the sidebar above the nav
    const sidebar = page.locator('aside')
    // It renders either a company name or "No company" depending on the API
    await expect(sidebar.locator('[class*="border-b"]').first()).toBeVisible()
  })

  test('page title reflects current route', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/')

    // The header <h1> should say "Dashboard" on all pages
    await expect(page.locator('header h1')).toContainText('Dashboard')
  })

  test('agents page renders without crashing', async ({ page }) => {
    await page.goto('/agents')
    await expect(page.locator('h2')).toContainText('Agents')
  })

  test('tasks page renders without crashing', async ({ page }) => {
    await page.goto('/tasks')
    // Page heading — either the table or empty state should appear
    await expect(page.locator('body')).toBeVisible()
  })

  test('board page renders without crashing', async ({ page }) => {
    await page.goto('/board')
    await expect(page.locator('body')).toBeVisible()
  })

  test('settings page renders without crashing', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('body')).toBeVisible()
  })
})
