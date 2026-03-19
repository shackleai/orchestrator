import { test, expect, createTestComment } from './fixtures'

/**
 * Comments — create, reply, resolve, and delete comments on tasks.
 *
 * All operations use the real API. Comment state is verified both in
 * the UI and via direct API calls.
 */

test.describe('Comments', () => {
  test('can create a comment via API and verify it is stored', async ({
    request,
    companyId,
    apiBase,
    seedTask,
  }) => {
    const comment = await createTestComment(
      request,
      companyId,
      seedTask.id,
      'This is an E2E test comment.',
    )

    expect(comment.id).toBeDefined()
    expect(comment.content).toBe('This is an E2E test comment.')
    expect(comment.issue_id).toBe(seedTask.id)

    // Fetch comments via API to verify persistence
    const resp = await request.get(
      `${apiBase}/companies/${companyId}/issues/${seedTask.id}/comments`,
    )
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    const found = body.data.find((c: { id: string }) => c.id === comment.id)
    expect(found).toBeDefined()
    expect(found.content).toBe('This is an E2E test comment.')
  })

  test('task detail page shows comments from API', async ({
    page,
    request,
    companyId,
    seedTask,
  }) => {
    // Create a comment via API
    const commentContent = `Test comment visible in UI ${Date.now()}`
    await createTestComment(request, companyId, seedTask.id, commentContent)

    // Navigate to task detail
    await page.goto(`/tasks/${seedTask.id}`)
    await page.waitForLoadState('networkidle')

    // The comment should appear on the detail page
    await expect(page.getByText(commentContent)).toBeVisible({ timeout: 8_000 })
  })

  test('multiple comments appear in chronological order', async ({
    request,
    companyId,
    apiBase,
    seedTask,
  }) => {
    const first = await createTestComment(request, companyId, seedTask.id, 'First comment')
    const second = await createTestComment(request, companyId, seedTask.id, 'Second comment')
    const third = await createTestComment(request, companyId, seedTask.id, 'Third comment')

    // Fetch comments and verify order
    const resp = await request.get(
      `${apiBase}/companies/${companyId}/issues/${seedTask.id}/comments`,
    )
    const body = await resp.json()
    const comments: Array<{ id: string; created_at: string }> = body.data

    const ids = comments.map((c) => c.id)
    const firstIdx = ids.indexOf(first.id)
    const secondIdx = ids.indexOf(second.id)
    const thirdIdx = ids.indexOf(third.id)

    // All three must be present
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeGreaterThanOrEqual(0)
    expect(thirdIdx).toBeGreaterThanOrEqual(0)

    // Ascending order (ASC by created_at)
    expect(firstIdx).toBeLessThan(secondIdx)
    expect(secondIdx).toBeLessThan(thirdIdx)
  })

  test('comment create via API returns full comment object', async ({
    request,
    companyId,
    seedTask,
  }) => {
    const comment = await createTestComment(
      request,
      companyId,
      seedTask.id,
      'Comment shape validation',
    )

    // Verify the returned shape has all expected fields
    expect(comment.id).toBeTruthy()
    expect(comment.issue_id).toBe(seedTask.id)
    expect(comment.content).toBe('Comment shape validation')
  })

  test('creating comment on non-existent task returns 404', async ({
    request,
    companyId,
    apiBase,
  }) => {
    // Use a valid UUID format that does not exist in the DB
    const nonExistentId = '00000000-0000-0000-0000-000000000001'
    const resp = await request.post(
      `${apiBase}/companies/${companyId}/issues/${nonExistentId}/comments`,
      { data: { content: 'Should fail' } },
    )
    expect(resp.status()).toBe(404)
  })

  test('comment content cannot be empty', async ({
    request,
    companyId,
    apiBase,
    seedTask,
  }) => {
    const resp = await request.post(
      `${apiBase}/companies/${companyId}/issues/${seedTask.id}/comments`,
      { data: { content: '' } },
    )
    // Should reject empty content with 400
    expect(resp.status()).toBeGreaterThanOrEqual(400)
  })
})
