import { test, expect } from '@playwright/test'

/**
 * Agents CRUD — happy-path flow for creating and managing agents.
 *
 * Flow:
 *   1. Navigate to /agents
 *   2. Click "Hire Agent" — verify form appears
 *   3. Fill in required fields and submit
 *   4. Verify new agent appears in the table
 *   5. Pause the agent — verify status badge changes
 *   6. Resume the agent — verify status badge reverts
 */

test.describe('Agents CRUD', () => {
  test('Hire Agent button reveals create form', async ({ page }) => {
    await page.goto('/agents')

    // Wait for the page heading
    await expect(page.locator('h2')).toContainText('Agents')

    // The Hire Agent button must be enabled (company is loaded)
    const hireBtn = page.getByRole('button', { name: 'Hire Agent' })
    await expect(hireBtn).toBeVisible()
    await hireBtn.click()

    // Form should now be visible
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Agent' })).toBeVisible()
  })

  test('Create Agent form validates required name field', async ({ page }) => {
    await page.goto('/agents')

    const hireBtn = page.getByRole('button', { name: 'Hire Agent' })
    await hireBtn.click()

    // Submit button is disabled until name is entered
    const submitBtn = page.getByRole('button', { name: 'Create Agent' })
    await expect(submitBtn).toBeDisabled()
  })

  test('Cancel button closes the create form', async ({ page }) => {
    await page.goto('/agents')

    await page.getByRole('button', { name: 'Hire Agent' }).click()
    await expect(page.getByLabel('Name')).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()

    // Form should be gone
    await expect(page.getByLabel('Name')).not.toBeVisible()
  })

  test('can create a new agent and see it in the list', async ({ page }) => {
    await page.goto('/agents')

    await page.getByRole('button', { name: 'Hire Agent' }).click()

    // Fill in the minimum required fields
    const agentName = `e2e-agent-${Date.now()}`
    await page.getByLabel('Name').fill(agentName)

    // Submit
    const submitBtn = page.getByRole('button', { name: 'Create Agent' })
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Form closes after success
    await expect(page.getByLabel('Name')).not.toBeVisible()

    // Agent appears in the table
    await expect(page.getByRole('cell', { name: agentName })).toBeVisible({ timeout: 5000 })
  })

  test('created agent has idle status badge', async ({ page }) => {
    await page.goto('/agents')

    await page.getByRole('button', { name: 'Hire Agent' }).click()

    const agentName = `e2e-status-${Date.now()}`
    await page.getByLabel('Name').fill(agentName)
    await page.getByRole('button', { name: 'Create Agent' }).click()

    // Wait for the row to appear
    const row = page.getByRole('row').filter({ hasText: agentName })
    await expect(row).toBeVisible({ timeout: 5000 })

    // Status badge should be "idle" for a newly created agent
    await expect(row.getByText('idle')).toBeVisible()
  })

  test('can pause and resume an agent', async ({ page }) => {
    await page.goto('/agents')

    // Create an agent first
    await page.getByRole('button', { name: 'Hire Agent' }).click()
    const agentName = `e2e-pause-${Date.now()}`
    await page.getByLabel('Name').fill(agentName)
    await page.getByRole('button', { name: 'Create Agent' }).click()

    const row = page.getByRole('row').filter({ hasText: agentName })
    await expect(row).toBeVisible({ timeout: 5000 })

    // Pause the agent
    await row.getByRole('button', { name: 'Pause agent' }).click()

    // Status badge should change to "paused"
    await expect(row.getByText('paused')).toBeVisible({ timeout: 5000 })

    // Resume the agent
    await row.getByRole('button', { name: 'Resume agent' }).click()

    // Status badge should revert to "idle"
    await expect(row.getByText('idle')).toBeVisible({ timeout: 5000 })
  })

  test('empty state renders when no agents exist', async ({ page }) => {
    await page.goto('/agents')

    // Either table rows OR empty state should be present
    const hasRows = await page.getByRole('table').isVisible().catch(() => false)
    if (!hasRows) {
      await expect(page.getByText('No agents yet')).toBeVisible()
    }
  })
})
