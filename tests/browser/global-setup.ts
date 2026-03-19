/**
 * Playwright global setup — runs once before all test files.
 *
 * Responsibilities:
 *   1. Verify the API server is healthy (webServer config already started it)
 *   2. Verify the dashboard dev server is reachable
 *   3. Log the company ID so test runs can be traced
 *
 * The actual seeding of Acme Corp data is done by dev-server.ts when
 * SHACKLEAI_SEED=1 is set. This setup just confirms it worked.
 */

import { chromium, request as createRequest } from '@playwright/test'

const API_BASE = `http://localhost:${process.env.SHACKLEAI_PORT ?? '4321'}/api`

export default async function globalSetup() {
  console.log('\n[global-setup] Verifying test environment...')

  // --- 1. Check API health ---
  const apiContext = await createRequest.newContext()
  const healthResp = await apiContext.get(`${API_BASE}/health`)
  if (!healthResp.ok()) {
    throw new Error(`[global-setup] API health check failed: ${healthResp.status()}`)
  }
  const health = await healthResp.json()
  console.log(`[global-setup] API healthy — version ${health.version}`)

  // --- 2. Check company exists ---
  const companiesResp = await apiContext.get(`${API_BASE}/companies`)
  if (!companiesResp.ok()) {
    throw new Error(`[global-setup] Could not fetch companies: ${companiesResp.status()}`)
  }
  const companies = await companiesResp.json()
  if (!companies.data || companies.data.length === 0) {
    throw new Error('[global-setup] No companies found — dev-server seed failed')
  }
  const company = companies.data[0]
  console.log(`[global-setup] Company ready: "${company.name}" (${company.id})`)

  // --- 3. Verify dashboard is reachable ---
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const dashboardResp = await page.goto('http://localhost:5173', { timeout: 30_000 })
  if (!dashboardResp || !dashboardResp.ok()) {
    await browser.close()
    throw new Error(`[global-setup] Dashboard not reachable: ${dashboardResp?.status()}`)
  }
  console.log('[global-setup] Dashboard reachable at http://localhost:5173')
  await browser.close()
  await apiContext.dispose()

  console.log('[global-setup] Environment ready.\n')
}
