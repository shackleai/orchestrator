import { test, expect } from './fixtures'

/**
 * Theme — dark mode toggle and persistence across page navigation and refresh.
 *
 * The theme toggle stores preference in localStorage. We verify that:
 *   1. The toggle button is present
 *   2. Clicking it switches the theme class on <html>
 *   3. The preference persists after a full page reload
 *   4. The preference persists when navigating between pages
 */

test.describe('Theme toggle', () => {
  test('theme toggle button is visible in the header', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // ThemeToggle renders a button — it may have aria-label or title
    const themeBtn = page.locator('button[aria-label*="theme" i], button[title*="theme" i], button[aria-label*="dark" i], button[aria-label*="light" i]')
    await expect(themeBtn.first()).toBeVisible({ timeout: 8_000 })
  })

  test('clicking theme toggle adds/removes dark class on html element', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Record initial theme state
    const initialDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )

    // Find and click the theme toggle
    const themeBtn = page.locator('button[aria-label*="theme" i], button[title*="theme" i], button[aria-label*="dark" i], button[aria-label*="light" i]').first()
    if (!(await themeBtn.isVisible())) {
      test.skip()
      return
    }
    // Use force:true to bypass any overlay/animation that may intercept the click
    await themeBtn.click({ force: true })

    // Theme should have toggled
    const afterDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    expect(afterDark).toBe(!initialDark)
  })

  test('dark mode preference persists after page reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Force dark mode via localStorage (theme system key)
    await page.evaluate(() => {
      localStorage.setItem('shackleai-theme', 'dark')
      document.documentElement.classList.add('dark')
    })

    // Reload the page
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Dark mode should still be active
    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    expect(isDark).toBe(true)
  })

  test('light mode preference persists after page reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Force light mode
    await page.evaluate(() => {
      localStorage.setItem('shackleai-theme', 'light')
      document.documentElement.classList.remove('dark')
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    expect(isDark).toBe(false)
  })

  test('theme persists when navigating between pages', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Set dark mode
    await page.evaluate(() => {
      localStorage.setItem('shackleai-theme', 'dark')
      document.documentElement.classList.add('dark')
    })

    // Navigate to agents
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    // Dark mode should persist
    const isDarkOnAgents = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    expect(isDarkOnAgents).toBe(true)

    // Navigate to tasks
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    const isDarkOnTasks = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    expect(isDarkOnTasks).toBe(true)
  })

  test('body is visible in both light and dark mode', async ({ page }) => {
    // Test light mode
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await expect(page.locator('body')).toBeVisible()

    // Test dark mode
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await expect(page.locator('body')).toBeVisible()
  })
})
