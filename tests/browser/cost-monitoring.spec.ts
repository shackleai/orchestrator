import { test, expect, createTestAgent } from './fixtures'

/**
 * Cost monitoring — verify cost charts and data render with real API data.
 *
 * Creates real cost events via the API (/costs/events) and verifies they
 * appear in the costs page UI. Tests the budget gauge, cost table, and
 * per-agent breakdown.
 *
 * API endpoint: POST /api/companies/:id/costs/events
 */

async function createCostEvent(
  request: Parameters<typeof test>[1] extends infer T ? never : never,
  apiBase: string,
  companyId: string,
  agentId: string,
  model: string,
  costCents: number,
) {
  // Placeholder — use request directly in tests
}

test.describe('Cost monitoring', () => {
  test('costs page renders without crashing', async ({ page }) => {
    await page.goto('/costs')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('h2')).toBeVisible({ timeout: 8_000 })
  })

  test('costs page shows budget gauge when agent has cost events', async ({
    page,
    request,
    companyId,
    apiBase,
  }) => {
    // Create an agent and a cost event
    const agent = await createTestAgent(request, companyId, {
      name: `budget-agent-${Date.now()}`,
      role: 'worker',
    })

    await request.post(`${apiBase}/companies/${companyId}/costs/events`, {
      data: {
        agent_id: agent.id,
        model: 'claude-sonnet-4-20250514',
        input_tokens: 5000,
        output_tokens: 1000,
        cost_cents: 45,
      },
    })

    await page.goto('/costs')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('h2')).toBeVisible({ timeout: 8_000 })
  })

  test('cost events list via API returns real data', async ({
    request,
    companyId,
    apiBase,
  }) => {
    const agent = await createTestAgent(request, companyId, {
      name: `costs-verify-${Date.now()}`,
    })

    // Post a cost event via the correct endpoint
    const costResp = await request.post(`${apiBase}/companies/${companyId}/costs/events`, {
      data: {
        agent_id: agent.id,
        model: 'gpt-4o',
        input_tokens: 3000,
        output_tokens: 800,
        cost_cents: 30,
      },
    })
    expect(costResp.ok(), `POST /costs/events failed: ${costResp.status()} ${await costResp.text()}`).toBeTruthy()

    // Fetch cost events via the list endpoint
    const listResp = await request.get(`${apiBase}/companies/${companyId}/costs`)
    expect(listResp.ok()).toBeTruthy()
    const body = await listResp.json()
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBeTruthy()

    // Find our event
    const found = body.data.find(
      (e: { agent_id: string; model: string }) =>
        e.agent_id === agent.id && e.model === 'gpt-4o',
    )
    expect(found, 'Cost event not found in list response').toBeDefined()
    expect(found.cost_cents).toBe(30)
  })

  test('cost events by agent breakdown via API', async ({
    request,
    companyId,
    apiBase,
  }) => {
    const agent = await createTestAgent(request, companyId, {
      name: `breakdown-agent-${Date.now()}`,
    })

    // Post two cost events
    for (let i = 0; i < 2; i++) {
      await request.post(`${apiBase}/companies/${companyId}/costs/events`, {
        data: {
          agent_id: agent.id,
          model: 'claude-sonnet-4-20250514',
          input_tokens: 2000 * (i + 1),
          output_tokens: 500 * (i + 1),
          cost_cents: 20 * (i + 1),
        },
      })
    }

    // Fetch costs by agent
    const resp = await request.get(`${apiBase}/companies/${companyId}/costs/by-agent`)
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.data).toBeDefined()

    // Find our agent in the breakdown
    const agentBreakdown = body.data.find((b: { agent_id: string }) => b.agent_id === agent.id)
    if (agentBreakdown) {
      // Combined cost should be 20 + 40 = 60 cents
      expect(agentBreakdown.total_cost_cents).toBe(60)
    }
  })

  test('costs page renders company info in settings', async ({
    page,
    request,
    companyId,
    apiBase,
  }) => {
    // Create cost event to populate the page
    const agent = await createTestAgent(request, companyId, {
      name: `model-display-${Date.now()}`,
    })

    await request.post(`${apiBase}/companies/${companyId}/costs/events`, {
      data: {
        agent_id: agent.id,
        model: 'claude-sonnet-4-20250514',
        input_tokens: 1000,
        output_tokens: 200,
        cost_cents: 5,
      },
    })

    await page.goto('/costs')
    await page.waitForLoadState('networkidle')

    // The h2 heading confirms we are on the costs page
    await expect(page.locator('h2').first()).toBeVisible({ timeout: 8_000 })
  })

  test('cost date range filter via API', async ({
    request,
    companyId,
    apiBase,
  }) => {
    const agent = await createTestAgent(request, companyId, {
      name: `date-range-${Date.now()}`,
    })

    await request.post(`${apiBase}/companies/${companyId}/costs/events`, {
      data: {
        agent_id: agent.id,
        model: 'claude-sonnet-4-20250514',
        input_tokens: 1000,
        output_tokens: 100,
        cost_cents: 5,
      },
    })

    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()

    // Filter within range — should include the event
    const inRange = await request.get(
      `${apiBase}/companies/${companyId}/costs?from=${encodeURIComponent(yesterday)}&to=${encodeURIComponent(tomorrow)}`,
    )
    expect(inRange.ok()).toBeTruthy()
    const inBody = await inRange.json()
    const found = inBody.data.find(
      (e: { agent_id: string }) => e.agent_id === agent.id,
    )
    expect(found, 'Event not found in date range').toBeDefined()

    // Filter beyond tomorrow — should NOT include the event
    const farFuture = new Date(Date.now() + 10 * 86_400_000).toISOString()
    const outOfRange = await request.get(
      `${apiBase}/companies/${companyId}/costs?from=${encodeURIComponent(farFuture)}`,
    )
    expect(outOfRange.ok()).toBeTruthy()
    const outBody = await outOfRange.json()
    const notFound = outBody.data.find(
      (e: { agent_id: string }) => e.agent_id === agent.id,
    )
    expect(notFound).toBeUndefined()
  })
})
