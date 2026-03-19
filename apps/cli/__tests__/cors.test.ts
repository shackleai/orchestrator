import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

describe('CORS middleware', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
  })

  afterAll(async () => {
    await db.close()
  })

  afterEach(() => {
    delete process.env.SHACKLEAI_CORS_ORIGIN
  })

  it('allows localhost origins in development (default)', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('allows localhost without port', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost')
  })

  it('rejects non-localhost origins when no env var is set', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      headers: { Origin: 'https://evil.com' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('uses SHACKLEAI_CORS_ORIGIN env var when set', async () => {
    process.env.SHACKLEAI_CORS_ORIGIN = 'https://app.shackle.ai'
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      headers: { Origin: 'https://app.shackle.ai' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.shackle.ai')
  })

  it('supports comma-separated origins in env var', async () => {
    process.env.SHACKLEAI_CORS_ORIGIN = 'https://app.shackle.ai, https://staging.shackle.ai'
    app = createApp(db, { skipAuth: true })

    const res1 = await app.request('/api/health', {
      headers: { Origin: 'https://staging.shackle.ai' },
    })
    expect(res1.headers.get('Access-Control-Allow-Origin')).toBe('https://staging.shackle.ai')
  })

  it('responds to preflight OPTIONS with correct headers', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    })
    // Hono cors middleware returns 204 for preflight
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Total-Count')
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  it('does not add CORS headers to non-API routes', async () => {
    app = createApp(db, { skipAuth: true })
    // Non-API route — CORS middleware scoped to /api/* should not apply
    const res = await app.request('/some-page', {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
