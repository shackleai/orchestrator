import { test, expect, createTestAgent } from './fixtures'

/**
 * Agents CRUD — full agent lifecycle with real API calls.
 *
 * Every operation (create, pause, resume, terminate) hits the real
 * PGlite-backed API. UI changes are verified against actual API state.
 *
 * Flow:
 *   Create via form → verify in list → verify in DB (via API)
 *   Pause → verify status badge changes
 *   Resume → verify status reverts
 *   Terminate → verify removed from active list
 */

test.describe('Agents CRUD', () => {
  test('Hire Agent button reveals create form', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h2')).toContainText('Agents')

    const hireBtn = page.getByRole('button', { name: 'Hire Agent' })
    await expect(hireBtn).toBeVisible()
    await hireBtn.click()

    await expect(page.locator('#agent-name')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Agent' })).toBeVisible()
  })

  test('Create Agent form requires name before enabling submit', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Hire Agent' }).click()

    const submitBtn = page.getByRole('button', { name: 'Create Agent' })
    await expect(submitBtn).toBeDisabled()
  })

  test('Cancel button closes the create form', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Hire Agent' }).click()
    await expect(page.locator('#agent-name')).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('#agent-name')).not.toBeVisible()
  })

  test('can create a new agent and verify it appears in list and API', async ({
    page,
    request,
    companyId,
    apiBase,
  }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Hire Agent' }).click()

    const agentName = `e2e-agent-${Date.now()}`
    await page.locator('#agent-name').fill(agentName)

    const submitBtn = page.getByRole('button', { name: 'Create Agent' })
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Form closes after success
    await expect(page.locator('#agent-name')).not.toBeVisible()

    // Agent appears in the UI table
    await expect(page.getByRole('cell', { name: agentName })).toBeVisible({ timeout: 12_000 })

    // Cross-verify via the API — agent must be in the database
    const resp = await request.get(`${apiBase}/companies/${companyId}/agents`)
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    const found = body.data.find((a: { name: string }) => a.name === agentName)
    expect(found, `Agent "${agentName}" not found in API response`).toBeDefined()
    expect(found.status).toBe('idle')
  })

  test('newly created agent has idle status badge', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Hire Agent' }).click()

    const agentName = `e2e-status-${Date.now()}`
    await page.locator('#agent-name').fill(agentName)
    await page.getByRole('button', { name: 'Create Agent' }).click()

    // Search for the specific agent to avoid pagination issues
    const searchInput = page.getByRole('textbox', { name: /search agents/i })
    await searchInput.fill(agentName)
    await page.waitForTimeout(300)

    // Agent rows are rendered as link elements (role=link) containing cells.
    // Use .first() since the agent name appears once but strict mode would fail
    // if sidebar or other elements accidentally match (they should not).
    const row = page.getByRole('link').filter({ hasText: agentName }).first()
    await expect(row).toBeVisible({ timeout: 12_000 })
    await expect(row.getByText(/idle/i)).toBeVisible()
  })

  test('can pause and resume an agent — status persists in API', async ({
    page,
    request,
    companyId,
    apiBase,
    seedAgent,
  }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    // Search for the specific agent to avoid pagination issues
    const searchInput = page.getByRole('textbox', { name: /search agents/i })
    await searchInput.fill(seedAgent.name)
    await page.waitForTimeout(300)

    // Agent rows are rendered as link elements (role=link) containing cells.
    const row = page.getByRole('link').filter({ hasText: seedAgent.name }).first()
    await expect(row).toBeVisible({ timeout: 12_000 })

    // Pause
    await row.getByRole('button', { name: 'Pause agent' }).click()
    await expect(row.getByText(/paused/i)).toBeVisible({ timeout: 12_000 })

    // Verify in API
    const pauseBody = await (await request.get(`${apiBase}/companies/${companyId}/agents`)).json()
    const paused = pauseBody.data.find((a: { id: string }) => a.id === seedAgent.id)
    expect(paused?.status).toBe('paused')

    // Resume
    await row.getByRole('button', { name: 'Resume agent' }).click()
    await expect(row.getByText(/idle/i)).toBeVisible({ timeout: 12_000 })

    // Verify in API
    const resumeBody = await (await request.get(`${apiBase}/companies/${companyId}/agents`)).json()
    const resumed = resumeBody.data.find((a: { id: string }) => a.id === seedAgent.id)
    expect(resumed?.status).toBe('idle')
  })

  test('agent row has pause button when idle', async ({ page, seedAgent }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    // Search for the specific agent to avoid pagination issues
    const searchInput = page.getByRole('textbox', { name: /search agents/i })
    await searchInput.fill(seedAgent.name)
    await page.waitForTimeout(300)

    // Agent rows are rendered as link elements (role=link) containing cells.
    const row = page.getByRole('link').filter({ hasText: seedAgent.name }).first()
    await expect(row).toBeVisible({ timeout: 12_000 })
    await expect(row.getByRole('button', { name: 'Pause agent' })).toBeVisible()
  })

  test('agent created via API appears in UI without form interaction', async ({
    page,
    request,
    companyId,
  }) => {
    const agent = await createTestAgent(request, companyId, {
      name: `api-created-${Date.now()}`,
      role: 'worker',
      title: 'API Test Agent',
    })

    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(agent.name)).toBeVisible({ timeout: 12_000 })
  })

  test('agent detail page loads with real agent data', async ({
    page,
    request,
    companyId,
  }) => {
    const agent = await createTestAgent(request, companyId, {
      name: `detail-agent-${Date.now()}`,
      role: 'manager',
      title: 'Detail Test Manager',
    })

    await page.goto(`/agents/${agent.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(agent.name)).toBeVisible({ timeout: 12_000 })
  })

  test('empty state or table renders on /agents', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    const hasRows = await page.getByRole('table').isVisible().catch(() => false)
    if (!hasRows) {
      await expect(page.getByText('No agents yet')).toBeVisible()
    } else {
      await expect(page.getByRole('table')).toBeVisible()
    }
  })
})
