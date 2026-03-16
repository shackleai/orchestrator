import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'

describe('start command — Hono server routes', () => {
  const app = new Hono()

  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', version: '0.1.0' })
  })

  it('GET /api/health should return status ok', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as { status: string; version: string }
    expect(body.status).toBe('ok')
    expect(body.version).toBe('0.1.0')
  })

  it('GET /unknown should return 404', async () => {
    const res = await app.request('/unknown')
    expect(res.status).toBe(404)
  })
})
