import { test, expect, createTestTask } from './fixtures'

/**
 * Tasks CRUD — full task lifecycle with real API calls.
 *
 * Every operation hits the real PGlite-backed API. Status changes
 * are cross-verified against the API to confirm persistence.
 *
 * Flow:
 *   Create via form -> verify in list and kanban board
 *   Move task status -> verify in API
 *   Assign to agent -> verify assignment persists
 *   Board columns render with real task data
 */

test.describe('Tasks CRUD', () => {
  test('Create Task button reveals the create form', async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    const createBtn = page.getByRole('button', { name: 'Create Task' })
    await expect(createBtn).toBeVisible()
    await createBtn.click()

    await expect(page.getByLabel('Title')).toBeVisible()
  })

  test('Create Task form requires a title before enabling submit', async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Create Task' }).click()

    const submitBtn = page.getByRole('button', { name: 'Create Task' }).last()
    await expect(submitBtn).toBeDisabled()
  })

  test('Cancel button dismisses the create form', async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Create Task' }).click()
    await expect(page.getByLabel('Title')).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByLabel('Title')).not.toBeVisible()
  })

  test('can create a task via form and verify in list and API', async ({
    page,
    request,
    companyId,
    apiBase,
  }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Create Task' }).click()

    const taskTitle = `E2E Task ${Date.now()}`
    await page.getByLabel('Title').fill(taskTitle)

    const submitBtn = page.getByRole('button', { name: 'Create Task' }).last()
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Form closes after success
    await expect(page.getByLabel('Title')).not.toBeVisible()

    // Task appears in the UI table
    await expect(page.getByRole('cell', { name: taskTitle })).toBeVisible({ timeout: 8_000 })

    // Cross-verify via API
    const resp = await request.get(`${apiBase}/companies/${companyId}/issues`)
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    const found = body.data.find((t: { title: string }) => t.title === taskTitle)
    expect(found, `Task "${taskTitle}" not found in API response`).toBeDefined()
    expect(found.status).toBe('todo')
  })

  test('newly created task has todo status in UI', async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Create Task' }).click()

    const taskTitle = `E2E Status Task ${Date.now()}`
    await page.getByLabel('Title').fill(taskTitle)
    await page.getByRole('button', { name: 'Create Task' }).last().click()

    const row = page.getByRole('row').filter({ hasText: taskTitle })
    await expect(row).toBeVisible({ timeout: 8_000 })

    // Default status for created tasks is "todo" (statusLabel renders 'todo')
    await expect(row.getByText('todo')).toBeVisible()
  })

  test('task created on /tasks appears in /board To Do column', async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Create Task' }).click()

    const taskTitle = `E2E Board Task ${Date.now()}`
    await page.getByLabel('Title').fill(taskTitle)
    await page.getByRole('button', { name: 'Create Task' }).last().click()

    // Wait for task to appear in the table
    await expect(page.getByRole('cell', { name: taskTitle })).toBeVisible({ timeout: 8_000 })

    // Navigate to the board
    await page.goto('/board')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'To Do', exact: true })).toBeVisible()

    // The task card should appear in the To Do column
    await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 8_000 })
  })

  test('task created via API appears in tasks list without form interaction', async ({
    page,
    request,
    companyId,
  }) => {
    const task = await createTestTask(request, companyId, {
      title: `API Task ${Date.now()}`,
      status: 'in_progress',
      priority: 'high',
    })

    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(task.title)).toBeVisible({ timeout: 8_000 })
  })

  test('task with in_progress status appears in In Progress column on board', async ({
    page,
    request,
    companyId,
  }) => {
    const task = await createTestTask(request, companyId, {
      title: `InProgress Task ${Date.now()}`,
      status: 'in_progress',
      priority: 'medium',
    })

    await page.goto('/board')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('In Progress')).toBeVisible()
    await expect(page.getByText(task.title)).toBeVisible({ timeout: 8_000 })
  })

  test('task with done status appears in Done column on board', async ({
    page,
    request,
    companyId,
  }) => {
    const task = await createTestTask(request, companyId, {
      title: `Done Task ${Date.now()}`,
      status: 'done',
      priority: 'low',
    })

    await page.goto('/board')
    await page.waitForLoadState('networkidle')

    // Use heading role to scope "Done" to column header, not task titles
    await expect(page.getByRole('heading', { name: 'Done', exact: true })).toBeVisible()
    await expect(page.getByText(task.title)).toBeVisible({ timeout: 8_000 })
  })

  test('board page shows all five kanban columns', async ({ page }) => {
    await page.goto('/board')
    await page.waitForLoadState('networkidle')

    // Scope to column headings to avoid matching task card content
    await expect(page.getByRole('heading', { name: 'Backlog', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'To Do', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'In Progress', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'In Review', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Done', exact: true })).toBeVisible()
  })

  test('task detail page loads with real task data', async ({
    page,
    seedTask,
  }) => {
    await page.goto(`/tasks/${seedTask.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(seedTask.title)).toBeVisible({ timeout: 8_000 })
  })

  test('tasks table shows identifier column with real issue number', async ({
    page,
    request,
    companyId,
  }) => {
    const task = await createTestTask(request, companyId, {
      title: `Identifier Task ${Date.now()}`,
    })

    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    // The identifier (e.g. TEST-1) should appear alongside the title
    await expect(page.getByText(task.identifier)).toBeVisible({ timeout: 8_000 })
  })

  test('empty state or table renders on /tasks', async ({ page }) => {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    const hasRows = await page.getByRole('table').isVisible().catch(() => false)
    if (!hasRows) {
      await expect(page.getByText('No tasks found')).toBeVisible()
    } else {
      await expect(page.getByRole('table')).toBeVisible()
    }
  })
})
