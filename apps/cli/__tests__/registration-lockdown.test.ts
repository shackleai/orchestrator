/**
 * Registration lockdown test (#263)
 *
 * Verifies that SHACKLEAI_REGISTRATION_ENABLED env var can disable registration.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

type App = ReturnType<typeof createApp>

let app: App

beforeAll(async () => {
  const db = new PGliteProvider()
  await runMigrations(db)
  // Auth routes are always available (no skipAuth needed for /api/auth/register)
  app = createApp(db)
})

afterEach(() => {
  // Clean up env var after each test
  delete process.env.SHACKLEAI_REGISTRATION_ENABLED
})

describe('Registration Lockdown (#263)', () => {
  it('allows registration when env var is not set', async () => {
    delete process.env.SHACKLEAI_REGISTRATION_ENABLED
    const email = `lockdown-open-${randomBytes(4).toString('hex')}@test.shackleai.com`

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test@1234!', name: 'Open User' }),
    })

    expect(res.status).toBe(201)
  })

  it('blocks registration when env var is "false"', async () => {
    process.env.SHACKLEAI_REGISTRATION_ENABLED = 'false'
    const email = `lockdown-blocked-${randomBytes(4).toString('hex')}@test.shackleai.com`

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test@1234!', name: 'Blocked User' }),
    })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Registration is currently disabled')
  })

  it('blocks registration when env var is "0"', async () => {
    process.env.SHACKLEAI_REGISTRATION_ENABLED = '0'
    const email = `lockdown-zero-${randomBytes(4).toString('hex')}@test.shackleai.com`

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test@1234!', name: 'Zero User' }),
    })

    expect(res.status).toBe(403)
  })

  it('allows registration when env var is "true"', async () => {
    process.env.SHACKLEAI_REGISTRATION_ENABLED = 'true'
    const email = `lockdown-true-${randomBytes(4).toString('hex')}@test.shackleai.com`

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test@1234!', name: 'True User' }),
    })

    expect(res.status).toBe(201)
  })

  it('login is not affected by registration lockdown', async () => {
    // First register a user while registration is open
    delete process.env.SHACKLEAI_REGISTRATION_ENABLED
    const email = `lockdown-login-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const password = 'Test@1234!'

    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Login User' }),
    })
    expect(regRes.status).toBe(201)

    // Now lock registration
    process.env.SHACKLEAI_REGISTRATION_ENABLED = 'false'

    // Login should still work
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(loginRes.status).toBe(200)
  })
})
