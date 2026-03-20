/**
 * Battle Test — Asset Management (#286)
 *
 * Full coverage of the assets API routes and LocalDiskProvider.
 * Uses a real PGlite database and a real LocalDiskProvider with a temp directory.
 * No mocks.
 *
 * Routes under test:
 *   GET    /api/companies/:id/assets         — list assets (paginated)
 *   POST   /api/companies/:id/assets         — upload file (multipart/form-data)
 *   DELETE /api/companies/:id/assets/:assetId — delete asset
 *   GET    /api/assets/:assetId              — serve file content
 *
 * Architecture notes:
 *   - MAX_ASSET_SIZE_BYTES = 10 MB
 *   - ALLOWED_ASSET_MIME_TYPES: images, PDFs, text, JSON, archives, Office docs
 *   - Storage key: assets/<companyId>/<uuid>-<filename>
 *   - DELETE: removes DB record, then best-effort deletes from storage
 *   - Serve route: returns raw file bytes with Content-Type header
 *   - Routes are only mounted when storage is provided to createApp
 *
 * Happy Path:
 *   1. Upload a valid PNG file → 201, correct metadata
 *   2. Upload a valid PDF → 201
 *   3. Upload a text/plain file → 201
 *   4. List assets for company → returns all uploaded assets
 *   5. List assets — pagination (limit/offset)
 *   6. Serve uploaded asset → correct bytes and Content-Type header
 *   7. Delete asset → 200, subsequent GET returns 404
 *   8. uploaded_by field is stored and returned
 *   9. Large file at exact size limit (10 MB) — accepted
 *
 * Edge Cases:
 *  10. Disallowed MIME type → 415
 *  11. Oversized file (> 10 MB) → 413
 *  12. Missing file field → 400
 *  13. Delete non-existent asset → 404
 *  14. Serve non-existent asset → 404
 *  15. Delete wrong company's asset → 404 (asset isolation)
 *
 * Multi-Tenant:
 *  16. Company A assets not visible to company B
 *  17. Company B cannot delete company A's asset
 *
 * Storage:
 *  18. File persists on disk after upload (LocalDiskProvider.exists)
 *  19. File removed from disk after delete
 *  20. Path traversal key rejected by LocalDiskProvider
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { LocalDiskProvider } from '@shackleai/core'
import { MAX_ASSET_SIZE_BYTES, ALLOWED_ASSET_MIME_TYPES } from '@shackleai/shared'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

type CompanyRow = { id: string; name: string; issue_prefix: string }

type AssetRow = {
  id: string
  company_id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_key: string
  uploaded_by: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a multipart/form-data body for file upload. */
function buildMultipart(
  filename: string,
  mimeType: string,
  content: Buffer | string,
  uploadedBy?: string,
): { body: FormData; } {
  const form = new FormData()
  const buf = typeof content === 'string' ? Buffer.from(content) : content
  const blob = new Blob([buf], { type: mimeType })
  form.append('file', blob, filename)
  if (uploadedBy) form.append('uploaded_by', uploadedBy)
  return { body: form }
}

async function createCompany(app: App, prefix: string): Promise<CompanyRow> {
  const suffix = randomBytes(4).toString('hex')
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `AssetBattle-${prefix}-${suffix}`,
      issue_prefix: prefix.slice(0, 4).toUpperCase(),
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: CompanyRow }
  return body.data
}

async function uploadAsset(
  app: App,
  companyId: string,
  filename: string,
  mimeType: string,
  content: Buffer | string,
  uploadedBy?: string,
): Promise<{ status: number; body: unknown }> {
  const { body: form } = buildMultipart(filename, mimeType, content, uploadedBy)
  const res = await app.request(`/api/companies/${companyId}/assets`, {
    method: 'POST',
    body: form,
  })
  const body = await res.json()
  return { status: res.status, body }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: App
let storage: LocalDiskProvider
let storageBasePath: string
let companyA: CompanyRow
let companyB: CompanyRow

beforeAll(async () => {
  // Use a unique temp directory so parallel test runs don't collide
  const runId = randomBytes(6).toString('hex')
  storageBasePath = join(tmpdir(), `shackleai-assets-battle-${runId}`)

  const db = new PGliteProvider()
  await runMigrations(db)

  storage = new LocalDiskProvider({ basePath: storageBasePath })
  app = createApp(db, { skipAuth: true, storage })

  companyA = await createCompany(app, 'ABAT')
  companyB = await createCompany(app, 'BBAT')
})

afterAll(async () => {
  // Clean up temp storage directory
  await rm(storageBasePath, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Asset Management Battle Test (#286)', () => {

  // -------------------------------------------------------------------------
  // Happy Path
  // -------------------------------------------------------------------------

  it('1. upload valid PNG → 201 with correct metadata', async () => {
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes
    const { status, body } = await uploadAsset(
      app,
      companyA.id,
      'logo.png',
      'image/png',
      content,
    )

    expect(status).toBe(201)
    const asset = (body as { data: AssetRow }).data
    expect(asset.company_id).toBe(companyA.id)
    expect(asset.filename).toBe('logo.png')
    expect(asset.mime_type).toBe('image/png')
    expect(asset.size_bytes).toBe(content.length)
    expect(typeof asset.storage_key).toBe('string')
    expect(asset.storage_key).toContain(companyA.id)
    expect(typeof asset.id).toBe('string')
    expect(asset.uploaded_by).toBeNull()
  })

  it('2. upload valid PDF → 201', async () => {
    const content = Buffer.from('%PDF-1.4 test content')
    const { status, body } = await uploadAsset(
      app,
      companyA.id,
      'report.pdf',
      'application/pdf',
      content,
    )
    expect(status).toBe(201)
    expect((body as { data: AssetRow }).data.mime_type).toBe('application/pdf')
  })

  it('3. upload text/plain → 201', async () => {
    const { status, body } = await uploadAsset(
      app,
      companyA.id,
      'notes.txt',
      'text/plain',
      'Hello, ShackleAI!',
    )
    expect(status).toBe(201)
    expect((body as { data: AssetRow }).data.filename).toBe('notes.txt')
  })

  it('4. list assets returns all uploaded assets for the company', async () => {
    // Upload two assets in a fresh company for clean count
    const company = await createCompany(app, 'LIST')
    await uploadAsset(app, company.id, 'a.png', 'image/png', Buffer.alloc(10))
    await uploadAsset(app, company.id, 'b.txt', 'text/plain', 'hello')

    const res = await app.request(`/api/companies/${company.id}/assets`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AssetRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(2)
    // Ordered by created_at DESC — most recent first
    const filenames = body.data.map((a) => a.filename)
    expect(filenames).toContain('a.png')
    expect(filenames).toContain('b.txt')
  })

  it('5. list assets pagination — limit/offset', async () => {
    const company = await createCompany(app, 'PAGE')
    // Upload 3 assets
    for (let i = 0; i < 3; i++) {
      await uploadAsset(app, company.id, `file${i}.txt`, 'text/plain', `content ${i}`)
    }

    const res1 = await app.request(`/api/companies/${company.id}/assets?limit=2&offset=0`)
    expect(res1.status).toBe(200)
    const page1 = (await res1.json()) as { data: AssetRow[] }
    expect(page1.data.length).toBe(2)

    const res2 = await app.request(`/api/companies/${company.id}/assets?limit=2&offset=2`)
    expect(res2.status).toBe(200)
    const page2 = (await res2.json()) as { data: AssetRow[] }
    expect(page2.data.length).toBe(1)

    // No overlap
    const ids1 = page1.data.map((a) => a.id)
    const ids2 = page2.data.map((a) => a.id)
    expect(ids1.some((id) => ids2.includes(id))).toBe(false)
  })

  it('6. serve uploaded asset — correct bytes and Content-Type', async () => {
    const fileContent = Buffer.from('ShackleAI asset serve test content')
    const { status, body } = await uploadAsset(
      app,
      companyA.id,
      'serve-test.txt',
      'text/plain',
      fileContent,
    )
    expect(status).toBe(201)
    const asset = (body as { data: AssetRow }).data

    // Serve the asset
    const serveRes = await app.request(`/api/assets/${asset.id}`)
    expect(serveRes.status).toBe(200)
    expect(serveRes.headers.get('Content-Type')).toContain('text/plain')
    const served = Buffer.from(await serveRes.arrayBuffer())
    expect(served.toString()).toBe(fileContent.toString())
  })

  it('7. delete asset → 200, subsequent serve returns 404', async () => {
    const { status: uploadStatus, body: uploadBody } = await uploadAsset(
      app,
      companyA.id,
      'delete-me.txt',
      'text/plain',
      'to be deleted',
    )
    expect(uploadStatus).toBe(201)
    const asset = (uploadBody as { data: AssetRow }).data

    // Delete
    const deleteRes = await app.request(`/api/companies/${companyA.id}/assets/${asset.id}`, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
    const deleteBody = (await deleteRes.json()) as { data: { id: string } }
    expect(deleteBody.data.id).toBe(asset.id)

    // Serve should now 404
    // Give a moment for async storage delete to settle (it's best-effort/non-blocking)
    await new Promise((r) => setTimeout(r, 100))
    const serveRes = await app.request(`/api/assets/${asset.id}`)
    expect(serveRes.status).toBe(404)
  })

  it('8. uploaded_by field is stored and returned', async () => {
    const { status, body } = await uploadAsset(
      app,
      companyA.id,
      'attributed.txt',
      'text/plain',
      'content',
      'agent-abc123',
    )
    expect(status).toBe(201)
    expect((body as { data: AssetRow }).data.uploaded_by).toBe('agent-abc123')
  })

  it('9. large file at exact size limit (10 MB) is accepted', async () => {
    // Exactly MAX_ASSET_SIZE_BYTES
    const content = Buffer.alloc(MAX_ASSET_SIZE_BYTES, 0x41) // 'A' repeated
    const { status } = await uploadAsset(
      app,
      companyA.id,
      'max-size.bin',
      'application/octet-stream',
      content,
    )
    // application/octet-stream is not in ALLOWED_ASSET_MIME_TYPES, so we expect 415 here
    // Test the size check with an allowed MIME type
    const { status: status2 } = await uploadAsset(
      app,
      companyA.id,
      'max-size.txt',
      'text/plain',
      content,
    )
    expect(status2).toBe(201)
  })

  // -------------------------------------------------------------------------
  // Edge / Error Cases
  // -------------------------------------------------------------------------

  it('10. disallowed MIME type → 415', async () => {
    const { status, body } = await uploadAsset(
      app,
      companyA.id,
      'malware.exe',
      'application/x-msdownload',
      Buffer.from('MZ'),
    )
    expect(status).toBe(415)
    expect((body as { error: string }).error).toContain('Unsupported file type')
  })

  it('11. oversized file (> 10 MB) → 413', async () => {
    const oversized = Buffer.alloc(MAX_ASSET_SIZE_BYTES + 1, 0x41)
    const { status, body } = await uploadAsset(
      app,
      companyA.id,
      'too-big.txt',
      'text/plain',
      oversized,
    )
    expect(status).toBe(413)
    expect((body as { error: string }).error).toContain('File too large')
  })

  it('12. missing file field → 400', async () => {
    const res = await app.request(`/api/companies/${companyA.id}/assets`, {
      method: 'POST',
      body: new FormData(), // no file attached
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Missing file')
  })

  it('13. delete non-existent asset → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyA.id}/assets/00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })

  it('14. serve non-existent asset → 404', async () => {
    const res = await app.request('/api/assets/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('15. delete wrong company asset → 404 (asset scoped to company)', async () => {
    const { body } = await uploadAsset(
      app,
      companyA.id,
      'scoped.txt',
      'text/plain',
      'content',
    )
    const asset = (body as { data: AssetRow }).data

    // Company B tries to delete company A's asset
    const res = await app.request(
      `/api/companies/${companyB.id}/assets/${asset.id}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })

  // -------------------------------------------------------------------------
  // Multi-Tenant Isolation
  // -------------------------------------------------------------------------

  it('16. company A assets not visible to company B', async () => {
    const company1 = await createCompany(app, 'ISO1')
    const company2 = await createCompany(app, 'ISO2')

    await uploadAsset(app, company1.id, 'private.txt', 'text/plain', 'secret')

    const res = await app.request(`/api/companies/${company2.id}/assets`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AssetRow[] }
    expect(body.data.length).toBe(0)
  })

  it('17. company B cannot delete company A asset', async () => {
    const company1 = await createCompany(app, 'DEL1')
    const company2 = await createCompany(app, 'DEL2')

    const { body } = await uploadAsset(
      app,
      company1.id,
      'owned.txt',
      'text/plain',
      'owned by company1',
    )
    const asset = (body as { data: AssetRow }).data

    // Company 2 attempts deletion
    const res = await app.request(
      `/api/companies/${company2.id}/assets/${asset.id}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)

    // Asset still accessible via company 1
    const serveRes = await app.request(`/api/assets/${asset.id}`)
    expect(serveRes.status).toBe(200)
  })

  // -------------------------------------------------------------------------
  // Storage Layer
  // -------------------------------------------------------------------------

  it('18. file persists on disk after upload (LocalDiskProvider.exists)', async () => {
    const { status, body } = await uploadAsset(
      app,
      companyA.id,
      'persist-check.json',
      'application/json',
      '{"key":"value"}',
    )
    expect(status).toBe(201)
    const asset = (body as { data: AssetRow }).data

    const exists = await storage.exists(asset.storage_key)
    expect(exists).toBe(true)
  })

  it('19. file removed from disk after delete (storage cleanup)', async () => {
    const { body } = await uploadAsset(
      app,
      companyA.id,
      'cleanup-check.txt',
      'text/plain',
      'will be deleted',
    )
    const asset = (body as { data: AssetRow }).data

    await app.request(`/api/companies/${companyA.id}/assets/${asset.id}`, {
      method: 'DELETE',
    })

    // Allow async storage delete (best-effort, non-blocking)
    await new Promise((r) => setTimeout(r, 200))

    const exists = await storage.exists(asset.storage_key)
    expect(exists).toBe(false)
  })

  it('20. LocalDiskProvider rejects path traversal keys', async () => {
    await expect(storage.upload('../../../etc/passwd', Buffer.from('evil'), 'text/plain'))
      .rejects.toThrow('path traversal')
  })

  // -------------------------------------------------------------------------
  // Allowed MIME Types — spot-check each category
  // -------------------------------------------------------------------------

  it('all listed ALLOWED_ASSET_MIME_TYPES are accepted', async () => {
    const company = await createCompany(app, 'MIME')

    for (const mime of ALLOWED_ASSET_MIME_TYPES) {
      const ext = mime.split('/').pop()?.split('.').pop() ?? 'bin'
      const { status } = await uploadAsset(
        app,
        company.id,
        `test.${ext}`,
        mime,
        Buffer.from('test content for ' + mime),
      )
      expect(status, `Expected 201 for MIME: ${mime}`).toBe(201)
    }
  })
})
