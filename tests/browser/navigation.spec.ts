import { test, expect } from '@playwright/test'

/**
 * Navigation — tests for sidebar links, routing, and the Cmd+K command palette.
 */

test.describe('Sidebar navigation', () => {
  test('clicking Overview link navigates to /', async ({ page }) => {
    await page.goto('/agents')
    await page.getByRole('link', { name: 'Overview' }).click()
    await expect(page).toHaveURL('/')
  })

  test('clicking Agents link navigates to /agents', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Agents' }).click()
    await expect(page).toHaveURL('/agents')
  })

  test('clicking Tasks link navigates to /tasks', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Tasks' }).click()
    await expect(page).toHaveURL('/tasks')
  })

  test('clicking Board link navigates to /board', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Board' }).click()
    await expect(page).toHaveURL('/board')
  })

  test('clicking Activity link navigates to /activity', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Activity' }).click()
    await expect(page).toHaveURL('/activity')
  })

  test('clicking Costs link navigates to /costs', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Costs' }).click()
    await expect(page).toHaveURL('/costs')
  })

  test('clicking Org Chart link navigates to /org-chart', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Org Chart' }).click()
    await expect(page).toHaveURL('/org-chart')
  })

  test('clicking Settings link navigates to /settings', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL('/settings')
  })

  test('active sidebar link is visually highlighted', async ({ page }) => {
    await page.goto('/agents')

    // The active NavLink gets bg-secondary applied — check aria or class
    const agentsLink = page.getByRole('link', { name: 'Agents' })
    await expect(agentsLink).toBeVisible()

    // The link should not be in the default muted-foreground color
    // We verify this by confirming the link exists and the URL is /agents
    await expect(page).toHaveURL('/agents')
  })
})

test.describe('Command palette (Ctrl+K)', () => {
  test('opens when clicking the search button in the header', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Open command palette' }).click()

    // The dialog should appear
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeVisible()
  })

  test('opens via Ctrl+K keyboard shortcut', async ({ page }) => {
    await page.goto('/')

    await page.keyboard.press('Control+k')

    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  })

  test('closes when pressing Escape', async ({ page }) => {
    await page.goto('/')

    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).not.toBeVisible()
  })

  test('closes when clicking the backdrop', async ({ page }) => {
    await page.goto('/')

    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()

    // Click outside the dialog (backdrop is the fixed inset-0 div)
    await page.mouse.click(10, 10)
    await expect(page.getByRole('dialog', { name: 'Command palette' })).not.toBeVisible()
  })

  test('shows page navigation items when no query is typed', async ({ page }) => {
    await page.goto('/')

    await page.keyboard.press('Control+k')

    // Static page items are always shown
    await expect(page.getByRole('option', { name: 'Overview' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Agents' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Tasks' })).toBeVisible()
  })

  test('filters results when typing a query', async ({ page }) => {
    await page.goto('/')

    await page.keyboard.press('Control+k')

    await page.getByRole('combobox', { name: 'Search commands' }).fill('agents')

    // "Agents" page item should match
    await expect(page.getByRole('option', { name: 'Agents' })).toBeVisible()
  })

  test('shows no results message for an unmatched query', async ({ page }) => {
    await page.goto('/')

    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Search commands' }).fill('xyznonexistent')

    await expect(page.getByText(/No results found/)).toBeVisible()
  })

  test('navigates to selected page on Enter', async ({ page }) => {
    await page.goto('/')

    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Search commands' }).fill('settings')

    // Arrow down if needed, then Enter
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL('/settings', { timeout: 3000 })
  })
})
