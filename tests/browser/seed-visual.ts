/**
 * Visual test seeder — populates a running dev-server with realistic Acme Corp data.
 *
 * Usage:
 *   pnpm test:browser:seed
 *
 * Prerequisites:
 *   The dev-server must already be running:
 *     SHACKLEAI_PORT=4321 SHACKLEAI_SKIP_AUTH=1 tsx apps/cli/src/dev-server.ts
 *
 * What it creates:
 *   - Company "Acme Corp" (if not already present from dev-server seed)
 *   - 5 agents: PM, Frontend, Backend, QA, DevOps
 *   - 10 tasks across different statuses and priorities
 *   - 5 comments on various tasks
 *   - 2 cost events per agent (simulating token usage)
 *   - 3 policies
 *   - 2 goals
 */

const API_BASE = `http://localhost:${process.env.SHACKLEAI_PORT ?? '4321'}/api`

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  const json = (await res.json()) as { data: T }
  return json.data
}

async function main() {
  console.log('[seed] Connecting to API at', API_BASE)

  // --- Resolve company ---
  const companies = await api<Array<{ id: string; name: string }>>('GET', '/companies')
  if (companies.length === 0) {
    throw new Error('[seed] No company found. Is dev-server running with SHACKLEAI_SEED=1?')
  }
  const company = companies[0]
  const cid = company.id
  console.log(`[seed] Using company: "${company.name}" (${cid})`)

  // --- Create agents ---
  const agentDefs = [
    { name: 'Alice PM', title: 'Product Manager', role: 'manager' },
    { name: 'Bob Frontend', title: 'Frontend Engineer', role: 'worker' },
    { name: 'Carol Backend', title: 'Backend Engineer', role: 'worker' },
    { name: 'Dan QA', title: 'Quality Assurance', role: 'worker' },
    { name: 'Eve DevOps', title: 'DevOps Engineer', role: 'worker' },
  ]

  const agents: Array<{ id: string; name: string }> = []
  for (const def of agentDefs) {
    const agent = await api<{ id: string; name: string }>('POST', `/companies/${cid}/agents`, {
      ...def,
      adapter_type: 'claude',
      adapter_config: {
        prompt: `You are ${def.name}, a ${def.title}.`,
        model: 'claude-sonnet-4-20250514',
        timeout: 60,
      },
      budget_monthly_cents: 50_00, // $50
    })
    agents.push(agent)
    console.log(`[seed] Created agent: ${agent.name} (${agent.id})`)
  }

  // --- Create tasks ---
  const taskDefs = [
    { title: 'Set up CI/CD pipeline', status: 'done', priority: 'high', assignee: agents[4] },
    { title: 'Design system tokens', status: 'done', priority: 'medium', assignee: agents[1] },
    { title: 'Implement auth middleware', status: 'in_review', priority: 'high', assignee: agents[2] },
    { title: 'Write Playwright E2E tests', status: 'in_review', priority: 'high', assignee: agents[3] },
    { title: 'Dashboard overview page', status: 'in_progress', priority: 'high', assignee: agents[1] },
    { title: 'Agent lifecycle API', status: 'in_progress', priority: 'critical', assignee: agents[2] },
    { title: 'Onboarding wizard UI', status: 'todo', priority: 'medium', assignee: agents[0] },
    { title: 'Cost monitoring charts', status: 'todo', priority: 'medium', assignee: agents[1] },
    { title: 'Dark mode persistence', status: 'backlog', priority: 'low', assignee: null },
    { title: 'Mobile responsive nav', status: 'backlog', priority: 'low', assignee: null },
  ]

  const tasks: Array<{ id: string; identifier: string; title: string }> = []
  for (const def of taskDefs) {
    const task = await api<{ id: string; identifier: string; title: string }>(
      'POST',
      `/companies/${cid}/issues`,
      {
        title: def.title,
        status: def.status,
        priority: def.priority,
        assignee_agent_id: def.assignee?.id ?? null,
      },
    )
    tasks.push(task)
    console.log(`[seed] Created task: [${task.identifier}] ${task.title}`)
  }

  // --- Create comments ---
  const commentDefs = [
    { taskIdx: 0, content: 'Pipeline is green across all branches.' },
    { taskIdx: 2, content: 'Auth middleware is ready for review. JWT validation looks solid.' },
    { taskIdx: 2, content: 'Left a few inline comments on error handling edge cases.' },
    { taskIdx: 4, content: 'Overview stats are rendering correctly. Chart tooltips need polish.' },
    { taskIdx: 5, content: 'Pause/resume endpoints are tested. Working on terminate flow.' },
  ]

  for (const def of commentDefs) {
    const task = tasks[def.taskIdx]
    if (!task) continue
    await api('POST', `/companies/${cid}/issues/${task.id}/comments`, {
      content: def.content,
    })
    console.log(`[seed] Created comment on task [${task.identifier}]`)
  }

  // --- Create cost events ---
  const models = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'gpt-4o']
  for (const agent of agents) {
    for (let i = 0; i < 2; i++) {
      await api('POST', `/companies/${cid}/costs`, {
        agent_id: agent.id,
        model: models[i % models.length],
        input_tokens: Math.floor(Math.random() * 10_000) + 1_000,
        output_tokens: Math.floor(Math.random() * 3_000) + 500,
        cost_cents: Math.floor(Math.random() * 200) + 10,
        occurred_at: new Date(Date.now() - i * 3_600_000).toISOString(),
      })
    }
    console.log(`[seed] Created cost events for agent: ${agent.name}`)
  }

  // --- Create policies ---
  const policies = [
    { name: 'No production deploys without approval', scope: 'company' },
    { name: 'Max $5 per single LLM call', scope: 'agent' },
    { name: 'Require 2 reviewers for critical issues', scope: 'company' },
  ]
  for (const policy of policies) {
    await api('POST', `/companies/${cid}/policies`, {
      name: policy.name,
      description: `Automatically enforced: ${policy.name}`,
      scope: policy.scope,
      rules: [],
    }).catch(() => {
      // Policies endpoint may vary — skip if not supported in this build
      console.log(`[seed] Skipped policy: ${policy.name} (endpoint may differ)`)
    })
  }

  // --- Create goals ---
  const goals = [
    { title: 'Launch v0.1.0 to npm', description: 'Public launch of the orchestrator' },
    { title: 'Reach 100 GitHub stars', description: 'Growth milestone' },
  ]
  for (const goal of goals) {
    await api('POST', `/companies/${cid}/goals`, goal).catch(() => {
      console.log(`[seed] Skipped goal: ${goal.title} (endpoint may differ)`)
    })
  }

  console.log('\n[seed] Done! Visual test environment is ready.')
  console.log(`[seed] Open http://localhost:5173 to see the seeded data.`)
  console.log(`[seed] Or run: pnpm test:browser:ui\n`)
}

main().catch((err) => {
  console.error('[seed] Failed:', err)
  process.exit(1)
})
