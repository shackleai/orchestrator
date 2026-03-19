import { test, expect } from '@playwright/test'

/**
 * Tasks CRUD — happy-path flow for creating tasks and viewing them on the board.
 *
 * Flow:
 *   1. Navigate to /tasks
 *   2. Click "Create Task" — verify form appears
 *   3. Fill in required title field and submit
 *   4. Verify new task appears in the table
 *   5. Navigate to /board — verify the task appears in the correct column
 */

test.describe('Tasks CRUD', () => {
  test('Create Task button reveals the create form', async ({ page }) => {
    await page.goto('/tasks')

    const createBtn = page.getByRole('button', { name: 'Create Task' })
    await expect(createBtn).toBeVisible()
    await createBtn.click()

    // The inline form should appear with a title field
    await expect(page.getByLabel('Title')).toBeVisible()
  })

  test('Create Task form requires a title', async ({ page }) => {
    await page.goto('/tasks')

    await page.getByRole('button', { name: 'Create Task' }).click()

    // Submit button should be disabled when title is empty
    const submitBtn = page.getByRole('button', { name: 'Create Task' }).last()
    await expect(submitBtn).toBeDisabled()
  })

  test('Cancel button dismisses the create form', async ({ page }) => {
    await page.goto('/tasks')

    await page.getByRole('button', { name: 'Create Task' }).click()
    await expect(page.getByLabel('Title')).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByLabel('Title')).not.toBeVisible()
  })

  test('can create a task and see it in the list', async ({ page }) => {
    await page.goto('/tasks')

    await page.getByRole('button', { name: 'Create Task' }).click()

    const taskTitle = `E2E Task ${Date.now()}`
    await page.getByLabel('Title').fill(taskTitle)

    // Submit using the form's own Create Task button (inside the form card)
    const submitBtn = page.getByRole('button', { name: 'Create Task' }).last()
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Form closes after success
    await expect(page.getByLabel('Title')).not.toBeVisible()

    // Task appears in the table
    await expect(page.getByRole('cell', { name: taskTitle })).toBeVisible({ timeout: 5000 })
  })

  test('newly created task has todo status', async ({ page }) => {
    await page.goto('/tasks')

    await page.getByRole('button', { name: 'Create Task' }).click()

    const taskTitle = `E2E Status Task ${Date.now()}`
    await page.getByLabel('Title').fill(taskTitle)
    await page.getByRole('button', { name: 'Create Task' }).last().click()

    const row = page.getByRole('row').filter({ hasText: taskTitle })
    await expect(row).toBeVisible({ timeout: 5000 })

    // Default status for created tasks is "todo"
    await expect(row.getByText('to do')).toBeVisible()
  })

  test('task created on /tasks appears in /board', async ({ page }) => {
    await page.goto('/tasks')

    await page.getByRole('button', { name: 'Create Task' }).click()

    const taskTitle = `E2E Board Task ${Date.now()}`
    await page.getByLabel('Title').fill(taskTitle)
    await page.getByRole('button', { name: 'Create Task' }).last().click()

    // Wait for task to appear in the table
    await expect(page.getByRole('cell', { name: taskTitle })).toBeVisible({ timeout: 5000 })

    // Navigate to the board
    await page.goto('/board')

    // All columns should be rendered
    await expect(page.getByText('To Do')).toBeVisible()

    // The task card should appear (status defaults to "todo" → "To Do" column)
    await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 5000 })
  })

  test('empty state renders when no tasks exist', async ({ page }) => {
    await page.goto('/tasks')

    const hasRows = await page.getByRole('table').isVisible().catch(() => false)
    if (!hasRows) {
      await expect(page.getByText('No tasks found')).toBeVisible()
    }
  })

  test('board page shows all kanban columns', async ({ page }) => {
    await page.goto('/board')

    // All five columns should be present as headings
    await expect(page.getByText('Backlog')).toBeVisible()
    await expect(page.getByText('To Do')).toBeVisible()
    await expect(page.getByText('In Progress')).toBeVisible()
    await expect(page.getByText('In Review')).toBeVisible()
    await expect(page.getByText('Done')).toBeVisible()
  })
})
