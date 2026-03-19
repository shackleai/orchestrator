import { test, expect } from './fixtures'

/**
 * Auth flow — register, login, logout, and protected route access.
 *
 * The API server runs with SHACKLEAI_SKIP_AUTH=1 for UI tests, but the
 * /api/auth endpoints are always active and unauthenticated. These tests
 * verify the auth system works end-to-end at the API level.
 *
 * Note: The dashboard SPA does not have a login UI yet (auth is API-key
 * based for agents; human auth is for the management console). These
 * tests cover the API contract for the human auth system.
 */

test.describe('Auth API — register and login', () => {
  test('POST /api/auth/register creates a new user', async ({ request, apiBase }) => {
    const email = `e2e-${Date.now()}@test.shackleai.com`
    const resp = await request.post(`${apiBase}/auth/register`, {
      data: {
        email,
        password: 'Test@1234!',
        name: 'E2E Test User',
      },
    })

    expect(resp.ok(), `Register failed: ${resp.status()} ${await resp.text()}`).toBeTruthy()
    const body = await resp.json()
    expect(body.data).toBeDefined()
    expect(body.data.user).toBeDefined()
    expect(body.data.user.email).toBe(email)
    expect(body.data.token).toBeDefined()
    // Password must NOT be returned
    expect(body.data.user.password_hash).toBeUndefined()
  })

  test('POST /api/auth/register rejects duplicate email', async ({ request, apiBase }) => {
    const email = `dupe-${Date.now()}@test.shackleai.com`

    // First registration
    const first = await request.post(`${apiBase}/auth/register`, {
      data: { email, password: 'Test@1234!', name: 'First User' },
    })
    expect(first.ok()).toBeTruthy()

    // Duplicate
    const second = await request.post(`${apiBase}/auth/register`, {
      data: { email, password: 'AnotherPass!', name: 'Second User' },
    })
    expect(second.status()).toBe(409)
  })

  test('POST /api/auth/register rejects missing required fields', async ({ request, apiBase }) => {
    const resp = await request.post(`${apiBase}/auth/register`, {
      data: { email: 'missing-password@test.com' },
    })
    expect(resp.status()).toBeGreaterThanOrEqual(400)
    expect(resp.status()).toBeLessThan(500)
  })

  test('POST /api/auth/login returns JWT for valid credentials', async ({ request, apiBase }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `login-${uid}@test.shackleai.com`
    const password = 'Test@1234!'

    // Register first — verify it succeeded before attempting login
    const regResp = await request.post(`${apiBase}/auth/register`, {
      data: { email, password, name: 'Login Test User' },
    })
    const regText = await regResp.text()
    expect(regResp.ok(), `Register failed: ${regResp.status()} body=${regText}`).toBeTruthy()

    // Login
    const loginResp = await request.post(`${apiBase}/auth/login`, {
      data: { email, password },
    })
    const loginText = await loginResp.text()
    expect(loginResp.ok(), `Login failed: ${loginResp.status()} body=${loginText}`).toBeTruthy()
    const body = JSON.parse(loginText)
    expect(body.data.token).toBeDefined()
    expect(body.data.user.email).toBe(email)
  })

  test('POST /api/auth/login returns 401 for wrong password', async ({ request, apiBase }) => {
    const email = `wrong-pass-${Date.now()}@test.shackleai.com`

    await request.post(`${apiBase}/auth/register`, {
      data: { email, password: 'Correct@1234', name: 'Wrong Pass User' },
    })

    const resp = await request.post(`${apiBase}/auth/login`, {
      data: { email, password: 'WrongPassword!' },
    })
    expect(resp.status()).toBe(401)
  })

  test('POST /api/auth/login returns 401 for non-existent user', async ({ request, apiBase }) => {
    const resp = await request.post(`${apiBase}/auth/login`, {
      data: {
        email: `ghost-${Date.now()}@test.shackleai.com`,
        password: 'Test@1234!',
      },
    })
    expect(resp.status()).toBe(401)
  })

  test('GET /api/auth/me returns user info for valid JWT', async ({ request, apiBase }) => {
    const email = `me-${Date.now()}@test.shackleai.com`

    // Register and get token
    const regResp = await request.post(`${apiBase}/auth/register`, {
      data: { email, password: 'Test@1234!', name: 'Me User' },
    })
    const regBody = await regResp.json()
    const token: string = regBody.data.token

    // Call /me with the token
    const meResp = await request.get(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(meResp.ok()).toBeTruthy()
    const meBody = await meResp.json()
    expect(meBody.data.email).toBe(email)
  })

  test('GET /api/auth/me returns 401 without a token', async ({ request, apiBase }) => {
    const resp = await request.get(`${apiBase}/auth/me`)
    // Should be 401 — no token provided
    expect(resp.status()).toBe(401)
  })

  test('GET /api/auth/me returns 401 for invalid/tampered token', async ({ request, apiBase }) => {
    const resp = await request.get(`${apiBase}/auth/me`, {
      headers: { Authorization: 'Bearer this.is.not.a.valid.jwt' },
    })
    expect(resp.status()).toBe(401)
  })

  test('POST /api/auth/logout clears the session', async ({ request, apiBase }) => {
    const email = `logout-${Date.now()}@test.shackleai.com`

    const regResp = await request.post(`${apiBase}/auth/register`, {
      data: { email, password: 'Test@1234!', name: 'Logout User' },
    })
    const regBody = await regResp.json()
    const token: string = regBody.data.token

    // Logout
    const logoutResp = await request.post(`${apiBase}/auth/logout`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(logoutResp.ok()).toBeTruthy()
  })
})

test.describe('Protected route access (SKIP_AUTH mode)', () => {
  test('API routes are accessible with SHACKLEAI_SKIP_AUTH=1 (no token needed)', async ({
    request,
    apiBase,
    companyId,
  }) => {
    // In test mode, all API routes work without a token
    const resp = await request.get(`${apiBase}/companies/${companyId}/agents`)
    expect(resp.ok()).toBeTruthy()
  })

  test('health endpoint is always accessible', async ({ request, apiBase }) => {
    const resp = await request.get(`${apiBase}/health`)
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.status).toBe('ok')
  })

  test('dashboard SPA loads without authentication redirect', async ({ page }) => {
    // In test mode, the SPA should load directly without needing login
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Should NOT be redirected to a login page
    await expect(page).not.toHaveURL(/login|signin|auth/)
    await expect(page.locator('aside')).toBeVisible()
  })
})
