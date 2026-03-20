/**
 * Battle Test — Company Memberships (#273)
 *
 * Comprehensive E2E coverage for membership, invite, and join-request flows.
 * Uses a real PGlite database and real HTTP requests — NO MOCKS.
 *
 * Routes under test (all mounted at /api/companies or /api/invites):
 *   GET    /:id/members                      — list members
 *   POST   /:id/invites                      — create invite (admin+)
 *   GET    /:id/invites                      — list invites (admin+)
 *   GET    /api/invites/:token               — get invite details (public)
 *   POST   /api/invites/:token/accept        — accept invite (JWT)
 *   POST   /:id/join-requests                — submit join request
 *   GET    /:id/join-requests                — list join requests (admin+)
 *   PUT    /:id/join-requests/:reqId/approve — approve join request
 *   PUT    /:id/join-requests/:reqId/deny    — deny join request
 *   PUT    /:id/members/:userId/role         — change member role
 *   DELETE /:id/members/:userId             — remove member
 *
 * Happy Path:
 *   A. Full invite flow: owner invites → accept → member in list
 *   B. Join request flow: user submits request → admin approves → member
 *   C. Join request deny: admin denies request
 *   D. Role hierarchy: member → admin → member (round-trip)
 *   E. Member self-removal (leave company)
 *   F. Admin removes member below their rank
 *   G. List invites and join requests as admin
 *   H. Public invite details endpoint (no auth)
 *
 * Edge Cases:
 *   I.  Accept invite with matching email — already a member marks accepted
 *   J.  Role change: member → admin, then admin → viewer
 *   K.  Owner can change admin's role
 *   L.  Admin cannot change owner's role
 *   M.  Admin cannot promote member above admin (owner-only)
 *   N.  Duplicate join request → 409
 *   O.  Already-a-member join request → 409
 *   P.  Double-action on join request → 409
 *
 * Error Cases:
 *   Q.  Non-member attempts invite → 403
 *   R.  Member (non-admin) attempts invite → 403
 *   S.  Viewer (non-admin) attempts invite → 403
 *   T.  Invite with owner role → 400
 *   U.  Duplicate invite (same email, same company, pending) → 409
 *   V.  Accept expired invite → 410
 *   W.  Accept already-accepted invite → 410
 *   X.  Accept invite with wrong email → 403
 *   Y.  Accept invite — no auth header → 401
 *   Z.  Remove the company owner → 403
 *   AA. Member cannot change another member's role → 403
 *   AB. Cannot change your own role → 400
 *   AC. Cannot assign owner role via role-change endpoint → 400
 *   AD. Invalid action on join-request → 400
 *   AE. Non-existent join request → 404
 *   AF. Remove non-existent member → 404
 *   AG. List members — non-member → 403
 *   AH. List invites — member → 403
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { MembershipRole } from '@shackleai/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

type UserInfo = {
  id: string
  email: string
  name: string
  token: string
}

type CompanyInfo = {
  id: string
  name: string
}

type InviteRow = {
  id: string
  company_id: string
  email: string
  role: string
  token: string
  invited_by: string
  expires_at: string
  accepted_at: string | null
}

type MemberRow = {
  id: string
  company_id: string
  user_id: string
  role: string
  user_name: string
  user_email: string
}

type JoinRequestRow = {
  id: string
  company_id: string
  user_id: string
  message: string | null
  status: string
  decided_by: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register a new user and return their id, email, name, and JWT. */
async function registerUser(app: App, nameSuffix?: string): Promise<UserInfo> {
  const suffix = nameSuffix ?? randomBytes(4).toString('hex')
  const email = `member-battle-${suffix}@test.shackleai.com`
  const name = `Battle User ${suffix}`
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Battle@1234!', name }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { user: { id: string }; token: string } }
  return { id: body.data.user.id, email, name, token: body.data.token }
}

/** Create a company using skipAuth app (no bearer token needed for setup). */
async function createCompany(app: App, nameSuffix?: string): Promise<CompanyInfo> {
  // Always generate a fresh 8-hex-char prefix to avoid unique constraint collisions
  // across suites that share the same DB instance.
  const prefix = randomBytes(4).toString('hex').toUpperCase()
  const suffix = nameSuffix ?? randomBytes(4).toString('hex')
  const name = `MemberBattle Corp ${suffix}`
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: prefix }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string; name: string } }
  return { id: body.data.id, name: body.data.name }
}

/** Add a user as a direct member with a given role via raw DB insert. */
async function seedMembership(
  db: PGliteProvider,
  companyId: string,
  userId: string,
  role: string,
): Promise<void> {
  await db.query(
    `INSERT INTO company_memberships (company_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, user_id) DO UPDATE SET role = $3`,
    [companyId, userId, role],
  )
}

/** Create an invite via the API and return the invite row. */
async function createInvite(
  app: App,
  companyId: string,
  actorToken: string,
  email: string,
  role: string = MembershipRole.Member,
): Promise<InviteRow> {
  const res = await app.request(`/api/companies/${companyId}/invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${actorToken}`,
    },
    body: JSON.stringify({ email, role }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: InviteRow }
  return body.data
}

/** Accept an invite token as a given user. */
async function acceptInvite(
  app: App,
  inviteToken: string,
  userJwt: string,
): Promise<Response> {
  return app.request(`/api/invites/${inviteToken}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userJwt}` },
  })
}

/** Submit a join request as a given user. */
async function submitJoinRequest(
  app: App,
  companyId: string,
  userJwt: string,
  message?: string,
): Promise<JoinRequestRow> {
  const res = await app.request(`/api/companies/${companyId}/join-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userJwt}`,
    },
    body: JSON.stringify({ message: message ?? null }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: JoinRequestRow }
  return body.data
}

/** Decide (approve/deny) a join request as an admin. */
async function decideJoinRequest(
  app: App,
  companyId: string,
  requestId: string,
  action: 'approve' | 'deny',
  actorToken: string,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/join-requests/${requestId}/${action}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${actorToken}` },
  })
}

/** List company members. */
async function listMembers(
  app: App,
  companyId: string,
  actorToken: string,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/members`, {
    headers: { Authorization: `Bearer ${actorToken}` },
  })
}

/** Change a member's role. */
async function changeRole(
  app: App,
  companyId: string,
  targetUserId: string,
  newRole: string,
  actorToken: string,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/members/${targetUserId}/role`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${actorToken}`,
    },
    body: JSON.stringify({ role: newRole }),
  })
}

/** Remove a member. */
async function removeMember(
  app: App,
  companyId: string,
  targetUserId: string,
  actorToken: string,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/members/${targetUserId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${actorToken}` },
  })
}

/** Directly insert an expired invite into the DB. */
async function seedExpiredInvite(
  db: PGliteProvider,
  companyId: string,
  invitedByUserId: string,
  email: string,
): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiredAt = new Date(Date.now() - 1000).toISOString() // 1 second in the past
  await db.query(
    `INSERT INTO company_invites (company_id, email, role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [companyId, email, MembershipRole.Member, token, invitedByUserId, expiredAt],
  )
  return token
}

/** Directly mark an invite as accepted in the DB. */
async function markInviteAccepted(db: PGliteProvider, inviteToken: string): Promise<void> {
  await db.query(
    `UPDATE company_invites SET accepted_at = NOW() WHERE token = $1`,
    [inviteToken],
  )
}

// ---------------------------------------------------------------------------
// Shared DB and app — all suites share one instance for speed
// ---------------------------------------------------------------------------

let db: PGliteProvider
let app: App
let setupApp: App // skipAuth for raw company creation

beforeAll(async () => {
  db = new PGliteProvider()
  await runMigrations(db)
  app = createApp(db)
  setupApp = createApp(db, { skipAuth: true })
})

afterAll(async () => {
  await db.close()
})

// ===========================================================================
// BATTLE A — Full invite flow: owner invites → accept → member in list
// ===========================================================================

describe('Battle A: full invite flow (invite → accept → member list)', () => {
  let owner: UserInfo
  let invitee: UserInfo
  let company: CompanyInfo
  let invite: InviteRow

  beforeAll(async () => {
    owner = await registerUser(app, `invA-owner-${randomBytes(3).toString('hex')}`)
    invitee = await registerUser(app, `invA-invitee-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `invA-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
  })

  it('owner can invite a user by email', async () => {
    invite = await createInvite(app, company.id, owner.token, invitee.email, MembershipRole.Member)
    // Route stores email lowercased
    expect(invite.email).toBe(invitee.email.toLowerCase())
    expect(invite.role).toBe(MembershipRole.Member)
    expect(invite.token).toBeTruthy()
    expect(invite.accepted_at).toBeNull()
    // Expiry should be ~72 hours from now
    const expiresAt = new Date(invite.expires_at).getTime()
    expect(expiresAt).toBeGreaterThan(Date.now() + 71 * 60 * 60 * 1000)
  })

  it('public invite details endpoint returns company name, email, role without auth', async () => {
    const res = await app.request(`/api/invites/${invite.token}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { company_name: string; email: string; role: string; expires_at: string } }
    expect(body.data.company_name).toBe(company.name)
    // Route stores email lowercased
    expect(body.data.email).toBe(invitee.email.toLowerCase())
    expect(body.data.role).toBe(MembershipRole.Member)
  })

  it('invitee accepts the invite with their JWT', async () => {
    const res = await acceptInvite(app, invite.token, invitee.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { message: string; company_id: string; role: string } }
    expect(body.data.message).toBe('Invite accepted')
    expect(body.data.company_id).toBe(company.id)
    expect(body.data.role).toBe(MembershipRole.Member)
  })

  it('invitee now appears in the company member list', async () => {
    const res = await listMembers(app, company.id, owner.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: MemberRow[] }
    const found = body.data.find((m) => m.user_id === invitee.id)
    expect(found).toBeDefined()
    expect(found!.role).toBe(MembershipRole.Member)
    // user_email comes from the users table; auth register route also lowercases emails
    expect(found!.user_email).toBe(invitee.email.toLowerCase())
  })

  it('admin can list company invites', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: InviteRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    const found = body.data.find((i) => i.token === invite.token)
    expect(found).toBeDefined()
    // Should show accepted_at set after accept
    expect(found!.accepted_at).not.toBeNull()
  })
})

// ===========================================================================
// BATTLE B — Join request flow: user submits → admin approves → member
// ===========================================================================

describe('Battle B: join request — approve flow', () => {
  let admin: UserInfo
  let requester: UserInfo
  let company: CompanyInfo
  let joinReq: JoinRequestRow

  beforeAll(async () => {
    admin = await registerUser(app, `jrB-admin-${randomBytes(3).toString('hex')}`)
    requester = await registerUser(app, `jrB-req-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `jrB-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
  })

  it('non-member can submit a join request with an optional message', async () => {
    joinReq = await submitJoinRequest(app, company.id, requester.token, 'Please let me in!')
    expect(joinReq.company_id).toBe(company.id)
    expect(joinReq.user_id).toBe(requester.id)
    expect(joinReq.message).toBe('Please let me in!')
    expect(joinReq.status).toBe('pending')
    expect(joinReq.decided_by).toBeNull()
  })

  it('admin can list pending join requests', async () => {
    const res = await app.request(`/api/companies/${company.id}/join-requests`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: (JoinRequestRow & { user_name: string; user_email: string })[] }
    const found = body.data.find((r) => r.id === joinReq.id)
    expect(found).toBeDefined()
    // user_email comes from the users table; auth register route lowercases emails
    expect(found!.user_email).toBe(requester.email.toLowerCase())
    expect(found!.status).toBe('pending')
  })

  it('admin approves the join request', async () => {
    const res = await decideJoinRequest(app, company.id, joinReq.id, 'approve', admin.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { message: string; request_id: string } }
    expect(body.data.message).toContain('approved')
    expect(body.data.request_id).toBe(joinReq.id)
  })

  it('requester appears in member list after approval', async () => {
    const res = await listMembers(app, company.id, admin.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: MemberRow[] }
    const found = body.data.find((m) => m.user_id === requester.id)
    expect(found).toBeDefined()
    // Join request approval always grants member role
    expect(found!.role).toBe(MembershipRole.Member)
  })
})

// ===========================================================================
// BATTLE C — Join request deny flow
// ===========================================================================

describe('Battle C: join request — deny flow', () => {
  let admin: UserInfo
  let requester: UserInfo
  let company: CompanyInfo
  let joinReq: JoinRequestRow

  beforeAll(async () => {
    admin = await registerUser(app, `jrC-admin-${randomBytes(3).toString('hex')}`)
    requester = await registerUser(app, `jrC-req-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `jrC-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
    joinReq = await submitJoinRequest(app, company.id, requester.token, 'Please deny me')
  })

  it('admin denies the join request', async () => {
    const res = await decideJoinRequest(app, company.id, joinReq.id, 'deny', admin.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { message: string } }
    expect(body.data.message).toContain('denied')
  })

  it('denied requester does NOT appear in member list', async () => {
    const res = await listMembers(app, company.id, admin.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: MemberRow[] }
    const found = body.data.find((m) => m.user_id === requester.id)
    expect(found).toBeUndefined()
  })
})

// ===========================================================================
// BATTLE D — Role hierarchy: member → admin → viewer (round-trip)
// ===========================================================================

describe('Battle D: role change round-trip (member → admin → viewer)', () => {
  let owner: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `roleD-owner-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `roleD-member-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `roleD-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('owner promotes member to admin', async () => {
    const res = await changeRole(app, company.id, member.id, MembershipRole.Admin, owner.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { role: string; user_id: string } }
    expect(body.data.role).toBe(MembershipRole.Admin)
    expect(body.data.user_id).toBe(member.id)
  })

  it('member list reflects updated role', async () => {
    const res = await listMembers(app, company.id, owner.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: MemberRow[] }
    const found = body.data.find((m) => m.user_id === member.id)
    expect(found!.role).toBe(MembershipRole.Admin)
  })

  it('owner demotes admin back to viewer', async () => {
    const res = await changeRole(app, company.id, member.id, MembershipRole.Viewer, owner.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { role: string } }
    expect(body.data.role).toBe(MembershipRole.Viewer)
  })

  it('member list reflects viewer role', async () => {
    const res = await listMembers(app, company.id, owner.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: MemberRow[] }
    const found = body.data.find((m) => m.user_id === member.id)
    expect(found!.role).toBe(MembershipRole.Viewer)
  })
})

// ===========================================================================
// BATTLE E — Member self-removal (leave company)
// ===========================================================================

describe('Battle E: member self-removal (leave company)', () => {
  let owner: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `leaveE-owner-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `leaveE-member-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `leaveE-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('member can remove themselves (leave company)', async () => {
    const res = await removeMember(app, company.id, member.id, member.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { message: string } }
    expect(body.data.message).toContain('left the company')
  })

  it('member no longer appears in member list after leaving', async () => {
    const res = await listMembers(app, company.id, owner.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: MemberRow[] }
    const found = body.data.find((m) => m.user_id === member.id)
    expect(found).toBeUndefined()
  })
})

// ===========================================================================
// BATTLE F — Admin removes a member below their rank
// ===========================================================================

describe('Battle F: admin removes a lower-rank member', () => {
  let admin: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    admin = await registerUser(app, `removeF-admin-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `removeF-member-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `removeF-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('admin can remove a member below their rank', async () => {
    const res = await removeMember(app, company.id, member.id, admin.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { message: string; user_id: string } }
    expect(body.data.user_id).toBe(member.id)
  })

  it('removed member no longer appears in the list', async () => {
    const res = await listMembers(app, company.id, admin.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: MemberRow[] }
    expect(body.data.find((m) => m.user_id === member.id)).toBeUndefined()
  })
})

// ===========================================================================
// BATTLE G — Admin invites viewer-role user (role below admin)
// ===========================================================================

describe('Battle G: admin can invite users with roles at or below admin', () => {
  let admin: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    admin = await registerUser(app, `invG-admin-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `invG-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
  })

  it('admin can invite a viewer-role user', async () => {
    const email = `viewer-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({ email, role: MembershipRole.Viewer }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: InviteRow }
    expect(body.data.role).toBe(MembershipRole.Viewer)
  })

  it('admin can invite a member-role user', async () => {
    const email = `member-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({ email, role: MembershipRole.Member }),
    })
    expect(res.status).toBe(201)
  })

  it('admin can invite an admin-role user (same level)', async () => {
    const email = `admin-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({ email, role: MembershipRole.Admin }),
    })
    expect(res.status).toBe(201)
  })
})

// ===========================================================================
// BATTLE H — Accept invite when already a member marks invite accepted
// ===========================================================================

describe('Battle H: accept invite when already a member', () => {
  let owner: UserInfo
  let user: UserInfo
  let company: CompanyInfo
  let invite: InviteRow

  beforeAll(async () => {
    owner = await registerUser(app, `alreadyH-owner-${randomBytes(3).toString('hex')}`)
    user = await registerUser(app, `alreadyH-user-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `alreadyH-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    // Seed the user as already a member before they accept the invite
    invite = await createInvite(app, company.id, owner.token, user.email)
    await seedMembership(db, company.id, user.id, MembershipRole.Member)
  })

  it('accepting invite as already-a-member returns 200 with appropriate message', async () => {
    const res = await acceptInvite(app, invite.token, user.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { message: string } }
    expect(body.data.message).toContain('Already a member')
  })
})

// ===========================================================================
// EDGE CASES
// ===========================================================================

// ---------------------------------------------------------------------------
// BATTLE I — Duplicate join request → 409
// ---------------------------------------------------------------------------

describe('Battle I: duplicate join request → 409', () => {
  let admin: UserInfo
  let requester: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    admin = await registerUser(app, `dupJR-admin-${randomBytes(3).toString('hex')}`)
    requester = await registerUser(app, `dupJR-req-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `dupJR-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
    await submitJoinRequest(app, company.id, requester.token)
  })

  it('second join request from same user returns 409', async () => {
    const res = await app.request(`/api/companies/${company.id}/join-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${requester.token}`,
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('pending join request')
  })
})

// ---------------------------------------------------------------------------
// BATTLE J — Already-a-member join request → 409
// ---------------------------------------------------------------------------

describe('Battle J: join request from existing member → 409', () => {
  let owner: UserInfo
  let existingMember: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `memberJR-owner-${randomBytes(3).toString('hex')}`)
    existingMember = await registerUser(app, `memberJR-mem-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `memberJR-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, existingMember.id, MembershipRole.Member)
  })

  it('existing member submitting join request returns 409', async () => {
    const res = await app.request(`/api/companies/${company.id}/join-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${existingMember.token}`,
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Already a member')
  })
})

// ---------------------------------------------------------------------------
// BATTLE K — Double-action on already-decided join request → 409
// ---------------------------------------------------------------------------

describe('Battle K: double-action on join request → 409', () => {
  let admin: UserInfo
  let requester: UserInfo
  let company: CompanyInfo
  let joinReq: JoinRequestRow

  beforeAll(async () => {
    admin = await registerUser(app, `doubleK-admin-${randomBytes(3).toString('hex')}`)
    requester = await registerUser(app, `doubleK-req-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `doubleK-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
    joinReq = await submitJoinRequest(app, company.id, requester.token)
    // Approve once
    await decideJoinRequest(app, company.id, joinReq.id, 'approve', admin.token)
  })

  it('approving an already-approved request returns 409', async () => {
    const res = await decideJoinRequest(app, company.id, joinReq.id, 'approve', admin.token)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('already')
  })

  it('denying an already-approved request returns 409', async () => {
    const res = await decideJoinRequest(app, company.id, joinReq.id, 'deny', admin.token)
    expect(res.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// BATTLE L — Owner can change admin's role; admin cannot change owner's role
// ---------------------------------------------------------------------------

describe('Battle L: role hierarchy enforcement on role changes', () => {
  let owner: UserInfo
  let admin: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `hierL-owner-${randomBytes(3).toString('hex')}`)
    admin = await registerUser(app, `hierL-admin-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `hierL-member-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `hierL-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('owner can change admin role to viewer', async () => {
    const res = await changeRole(app, company.id, admin.id, MembershipRole.Viewer, owner.token)
    expect(res.status).toBe(200)
    // Restore for subsequent tests
    await changeRole(app, company.id, admin.id, MembershipRole.Admin, owner.token)
  })

  it('admin cannot change owner role', async () => {
    const res = await changeRole(app, company.id, owner.id, MembershipRole.Member, admin.token)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('equal or higher rank')
  })

  it('admin cannot change peer admin role', async () => {
    // Seed a second admin
    const admin2 = await registerUser(app, `hierL-admin2-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin2.id, MembershipRole.Admin)
    const res = await changeRole(app, company.id, admin2.id, MembershipRole.Member, admin.token)
    expect(res.status).toBe(403)
  })

  it('admin can change member role to viewer', async () => {
    const res = await changeRole(app, company.id, member.id, MembershipRole.Viewer, admin.token)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// BATTLE M — Cannot assign owner role via role-change endpoint
// ---------------------------------------------------------------------------

describe('Battle M: cannot assign owner role via role-change endpoint', () => {
  let owner: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `ownerRoleM-owner-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `ownerRoleM-mem-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `ownerRoleM-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('assigning owner role returns 400', async () => {
    const res = await changeRole(app, company.id, member.id, MembershipRole.Owner, owner.token)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('owner role')
  })
})

// ---------------------------------------------------------------------------
// BATTLE N — Cannot change your own role
// ---------------------------------------------------------------------------

describe('Battle N: cannot change your own role', () => {
  let owner: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `selfRoleN-owner-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `selfRoleN-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
  })

  it('owner cannot change their own role', async () => {
    const res = await changeRole(app, company.id, owner.id, MembershipRole.Admin, owner.token)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('own role')
  })
})

// ===========================================================================
// ERROR CASES
// ===========================================================================

// ---------------------------------------------------------------------------
// BATTLE Q — Non-member attempts invite → 403
// ---------------------------------------------------------------------------

describe('Battle Q: non-member attempts invite → 403', () => {
  let outsider: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    outsider = await registerUser(app, `outsiderQ-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `outsiderQ-${randomBytes(3).toString('hex')}`)
  })

  it('non-member attempting to invite gets 403', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsider.token}`,
      },
      body: JSON.stringify({ email: 'anyone@test.com', role: MembershipRole.Member }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('admin or owner')
  })
})

// ---------------------------------------------------------------------------
// BATTLE R — Member (non-admin) attempts invite → 403
// ---------------------------------------------------------------------------

describe('Battle R: member (non-admin) attempts invite → 403', () => {
  let owner: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `memberInvR-owner-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `memberInvR-mem-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `memberInvR-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('member attempting to invite gets 403', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ email: 'anyone@test.com', role: MembershipRole.Viewer }),
    })
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// BATTLE S — Viewer (non-admin) attempts invite → 403
// ---------------------------------------------------------------------------

describe('Battle S: viewer (non-admin) attempts invite → 403', () => {
  let owner: UserInfo
  let viewer: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `viewerInvS-owner-${randomBytes(3).toString('hex')}`)
    viewer = await registerUser(app, `viewerInvS-view-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `viewerInvS-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, viewer.id, MembershipRole.Viewer)
  })

  it('viewer attempting to invite gets 403', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewer.token}`,
      },
      body: JSON.stringify({ email: 'anyone@test.com', role: MembershipRole.Viewer }),
    })
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// BATTLE T — Invite with owner role → 400
// ---------------------------------------------------------------------------

describe('Battle T: invite with owner role → 400', () => {
  let owner: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `ownerInvT-owner-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `ownerInvT-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
  })

  it('inviting with owner role returns 400', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ email: 'anyone@test.com', role: MembershipRole.Owner }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('owner role')
  })
})

// ---------------------------------------------------------------------------
// BATTLE U — Duplicate invite (same email, same company, pending) → 409
// ---------------------------------------------------------------------------

describe('Battle U: duplicate pending invite → 409', () => {
  let owner: UserInfo
  let company: CompanyInfo
  const targetEmail = `dup-invite-${randomBytes(4).toString('hex')}@test.shackleai.com`

  beforeAll(async () => {
    owner = await registerUser(app, `dupInvU-owner-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `dupInvU-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await createInvite(app, company.id, owner.token, targetEmail)
  })

  it('second invite to same pending email returns 409', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ email: targetEmail, role: MembershipRole.Member }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('pending invite')
  })
})

// ---------------------------------------------------------------------------
// BATTLE V — Invite already-a-member → 409
// ---------------------------------------------------------------------------

describe('Battle V: invite already-a-member → 409', () => {
  let owner: UserInfo
  let existingMember: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `invMemberV-owner-${randomBytes(3).toString('hex')}`)
    existingMember = await registerUser(app, `invMemberV-mem-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `invMemberV-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, existingMember.id, MembershipRole.Member)
  })

  it('inviting existing member returns 409', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ email: existingMember.email, role: MembershipRole.Member }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('already a member')
  })
})

// ---------------------------------------------------------------------------
// BATTLE W — Accept expired invite → 410
// ---------------------------------------------------------------------------

describe('Battle W: accept expired invite → 410', () => {
  let owner: UserInfo
  let invitee: UserInfo
  let company: CompanyInfo
  let expiredToken: string

  beforeAll(async () => {
    owner = await registerUser(app, `expiredW-owner-${randomBytes(3).toString('hex')}`)
    invitee = await registerUser(app, `expiredW-inv-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `expiredW-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    expiredToken = await seedExpiredInvite(db, company.id, owner.id, invitee.email)
  })

  it('GET /api/invites/:token returns 410 for expired invite', async () => {
    const res = await app.request(`/api/invites/${expiredToken}`)
    expect(res.status).toBe(410)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('expired')
  })

  it('POST /api/invites/:token/accept returns 410 for expired invite', async () => {
    const res = await acceptInvite(app, expiredToken, invitee.token)
    expect(res.status).toBe(410)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('expired')
  })
})

// ---------------------------------------------------------------------------
// BATTLE X — Accept already-accepted invite → 410
// ---------------------------------------------------------------------------

describe('Battle X: accept already-accepted invite → 410', () => {
  let owner: UserInfo
  let invitee: UserInfo
  let company: CompanyInfo
  let invite: InviteRow

  beforeAll(async () => {
    owner = await registerUser(app, `acceptedX-owner-${randomBytes(3).toString('hex')}`)
    invitee = await registerUser(app, `acceptedX-inv-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `acceptedX-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    invite = await createInvite(app, company.id, owner.token, invitee.email)
    await markInviteAccepted(db, invite.token)
  })

  it('GET /api/invites/:token returns 410 for already-accepted invite', async () => {
    const res = await app.request(`/api/invites/${invite.token}`)
    expect(res.status).toBe(410)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('already been accepted')
  })

  it('POST accept on already-accepted invite returns 410', async () => {
    const res = await acceptInvite(app, invite.token, invitee.token)
    expect(res.status).toBe(410)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('already been accepted')
  })
})

// ---------------------------------------------------------------------------
// BATTLE Y — Accept invite with wrong email → 403
// ---------------------------------------------------------------------------

describe('Battle Y: accept invite with wrong email → 403', () => {
  let owner: UserInfo
  let wrongUser: UserInfo
  let company: CompanyInfo
  let invite: InviteRow

  beforeAll(async () => {
    owner = await registerUser(app, `wrongEmailY-owner-${randomBytes(3).toString('hex')}`)
    wrongUser = await registerUser(app, `wrongEmailY-wrong-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `wrongEmailY-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    const targetEmail = `intended-${randomBytes(4).toString('hex')}@test.shackleai.com`
    invite = await createInvite(app, company.id, owner.token, targetEmail)
  })

  it('wrong user accepting invite returns 403', async () => {
    const res = await acceptInvite(app, invite.token, wrongUser.token)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('different email')
  })
})

// ---------------------------------------------------------------------------
// BATTLE Z — Accept invite without auth header → 401
// ---------------------------------------------------------------------------

describe('Battle Z: accept invite without auth → 401', () => {
  let owner: UserInfo
  let company: CompanyInfo
  let invite: InviteRow

  beforeAll(async () => {
    owner = await registerUser(app, `noAuthZ-owner-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `noAuthZ-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    const targetEmail = `noauth-${randomBytes(4).toString('hex')}@test.shackleai.com`
    invite = await createInvite(app, company.id, owner.token, targetEmail)
  })

  it('POST accept with no Authorization header returns 401', async () => {
    const res = await app.request(`/api/invites/${invite.token}/accept`, {
      method: 'POST',
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('login required')
  })

  it('POST accept with invalid JWT returns 401', async () => {
    const res = await app.request(`/api/invites/${invite.token}/accept`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-valid-jwt' },
    })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// BATTLE AA — Remove the company owner → 403
// ---------------------------------------------------------------------------

describe('Battle AA: cannot remove the company owner', () => {
  let owner: UserInfo
  let admin: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `removeOwnerAA-owner-${randomBytes(3).toString('hex')}`)
    admin = await registerUser(app, `removeOwnerAA-admin-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `removeOwnerAA-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
  })

  it('admin cannot remove the owner', async () => {
    const res = await removeMember(app, company.id, owner.id, admin.token)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Cannot remove the company owner')
  })

  it('owner cannot remove themselves', async () => {
    const res = await removeMember(app, company.id, owner.id, owner.token)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Cannot remove the company owner')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AB — Member cannot remove another member → 403
// ---------------------------------------------------------------------------

describe('Battle AB: member cannot remove another member → 403', () => {
  let owner: UserInfo
  let memberA: UserInfo
  let memberB: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `memRemoveAB-owner-${randomBytes(3).toString('hex')}`)
    memberA = await registerUser(app, `memRemoveAB-a-${randomBytes(3).toString('hex')}`)
    memberB = await registerUser(app, `memRemoveAB-b-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `memRemoveAB-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, memberA.id, MembershipRole.Member)
    await seedMembership(db, company.id, memberB.id, MembershipRole.Member)
  })

  it('member cannot remove another member', async () => {
    const res = await removeMember(app, company.id, memberB.id, memberA.token)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('admin or owner')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AC — Admin cannot remove an equal-rank admin → 403
// ---------------------------------------------------------------------------

describe('Battle AC: admin cannot remove equal-rank admin → 403', () => {
  let owner: UserInfo
  let adminA: UserInfo
  let adminB: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `adminRemAC-owner-${randomBytes(3).toString('hex')}`)
    adminA = await registerUser(app, `adminRemAC-a-${randomBytes(3).toString('hex')}`)
    adminB = await registerUser(app, `adminRemAC-b-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `adminRemAC-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, adminA.id, MembershipRole.Admin)
    await seedMembership(db, company.id, adminB.id, MembershipRole.Admin)
  })

  it('admin cannot remove another admin of equal rank', async () => {
    const res = await removeMember(app, company.id, adminB.id, adminA.token)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('equal or higher rank')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AD — Invalid action on join-request → 400
// ---------------------------------------------------------------------------

describe('Battle AD: invalid join-request action → 400', () => {
  let admin: UserInfo
  let requester: UserInfo
  let company: CompanyInfo
  let joinReq: JoinRequestRow

  beforeAll(async () => {
    admin = await registerUser(app, `badActionAD-admin-${randomBytes(3).toString('hex')}`)
    requester = await registerUser(app, `badActionAD-req-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `badActionAD-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
    joinReq = await submitJoinRequest(app, company.id, requester.token)
  })

  it('invalid action on join request returns 400', async () => {
    const res = await app.request(
      `/api/companies/${company.id}/join-requests/${joinReq.id}/accept`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${admin.token}` },
      },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('approve')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AE — Non-existent join request → 404
// ---------------------------------------------------------------------------

describe('Battle AE: non-existent join request → 404', () => {
  let admin: UserInfo
  let company: CompanyInfo
  const fakeId = '00000000-0000-0000-0000-000000000000'

  beforeAll(async () => {
    admin = await registerUser(app, `notFoundAE-admin-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `notFoundAE-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, admin.id, MembershipRole.Admin)
  })

  it('approving non-existent join request returns 404', async () => {
    const res = await app.request(
      `/api/companies/${company.id}/join-requests/${fakeId}/approve`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${admin.token}` },
      },
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// BATTLE AF — Remove non-existent member → 404
// ---------------------------------------------------------------------------

describe('Battle AF: remove non-existent member → 404', () => {
  let owner: UserInfo
  let company: CompanyInfo
  const fakeUserId = '00000000-0000-0000-0000-000000000000'

  beforeAll(async () => {
    owner = await registerUser(app, `notFoundAF-owner-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `notFoundAF-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
  })

  it('removing non-existent member returns 404', async () => {
    const res = await removeMember(app, company.id, fakeUserId, owner.token)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('not found')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AG — Public invite token not found → 404
// ---------------------------------------------------------------------------

describe('Battle AG: invite token not found → 404', () => {
  it('GET /api/invites/:token with unknown token returns 404', async () => {
    const fakeToken = randomBytes(32).toString('hex')
    const res = await app.request(`/api/invites/${fakeToken}`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('not found')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AH — List members as non-member → 403
// ---------------------------------------------------------------------------

describe('Battle AH: list members as non-member → 403', () => {
  let outsider: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    outsider = await registerUser(app, `outsiderAH-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `outsiderAH-${randomBytes(3).toString('hex')}`)
  })

  it('non-member listing members returns 403', async () => {
    const res = await listMembers(app, company.id, outsider.token)
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// BATTLE AI — List invites as member → 403
// ---------------------------------------------------------------------------

describe('Battle AI: list invites as member → 403', () => {
  let owner: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `invListAI-owner-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `invListAI-mem-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `invListAI-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('member listing invites returns 403', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      headers: { Authorization: `Bearer ${member.token}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('admin or owner')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AJ — List join-requests as member → 403
// ---------------------------------------------------------------------------

describe('Battle AJ: list join-requests as member → 403', () => {
  let owner: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `jrListAJ-owner-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `jrListAJ-mem-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `jrListAJ-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('member listing join-requests returns 403', async () => {
    const res = await app.request(`/api/companies/${company.id}/join-requests`, {
      headers: { Authorization: `Bearer ${member.token}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('admin or owner')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AK — Invite input validation
// ---------------------------------------------------------------------------

describe('Battle AK: invite input validation', () => {
  let owner: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `invValAK-owner-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `invValAK-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
  })

  it('invite with invalid email returns 400', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ email: 'not-an-email', role: MembershipRole.Member }),
    })
    expect(res.status).toBe(400)
  })

  it('invite with invalid role returns 400', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ email: 'valid@test.com', role: 'superadmin' }),
    })
    expect(res.status).toBe(400)
  })

  it('invite with no body returns 400', async () => {
    const res = await app.request(`/api/companies/${company.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// BATTLE AL — Role change input validation
// ---------------------------------------------------------------------------

describe('Battle AL: role change input validation', () => {
  let owner: UserInfo
  let member: UserInfo
  let company: CompanyInfo

  beforeAll(async () => {
    owner = await registerUser(app, `roleValAL-owner-${randomBytes(3).toString('hex')}`)
    member = await registerUser(app, `roleValAL-mem-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `roleValAL-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
    await seedMembership(db, company.id, member.id, MembershipRole.Member)
  })

  it('role change with invalid role value returns 400', async () => {
    const res = await changeRole(app, company.id, member.id, 'godmode', owner.token)
    expect(res.status).toBe(400)
  })

  it('role change with no body returns 400', async () => {
    const res = await app.request(`/api/companies/${company.id}/members/${member.id}/role`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// BATTLE AM — Role change on non-existent member → 404
// ---------------------------------------------------------------------------

describe('Battle AM: role change on non-existent member → 404', () => {
  let owner: UserInfo
  let company: CompanyInfo
  const fakeUserId = '00000000-0000-0000-0000-000000000000'

  beforeAll(async () => {
    owner = await registerUser(app, `notFoundAM-owner-${randomBytes(3).toString('hex')}`)
    company = await createCompany(setupApp, `notFoundAM-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, company.id, owner.id, MembershipRole.Owner)
  })

  it('changing role of non-existent member returns 404', async () => {
    const res = await changeRole(app, company.id, fakeUserId, MembershipRole.Viewer, owner.token)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('not found')
  })
})

// ---------------------------------------------------------------------------
// BATTLE AN — Multi-tenant isolation: user in company A cannot manage company B
// ---------------------------------------------------------------------------

describe('Battle AN: multi-tenant isolation', () => {
  let ownerA: UserInfo
  let ownerB: UserInfo
  let memberB: UserInfo
  let companyA: CompanyInfo
  let companyB: CompanyInfo

  beforeAll(async () => {
    ownerA = await registerUser(app, `isoAN-ownerA-${randomBytes(3).toString('hex')}`)
    ownerB = await registerUser(app, `isoAN-ownerB-${randomBytes(3).toString('hex')}`)
    memberB = await registerUser(app, `isoAN-memB-${randomBytes(3).toString('hex')}`)
    companyA = await createCompany(setupApp, `isoAN-A-${randomBytes(3).toString('hex')}`)
    companyB = await createCompany(setupApp, `isoAN-B-${randomBytes(3).toString('hex')}`)
    await seedMembership(db, companyA.id, ownerA.id, MembershipRole.Owner)
    await seedMembership(db, companyB.id, ownerB.id, MembershipRole.Owner)
    await seedMembership(db, companyB.id, memberB.id, MembershipRole.Member)
  })

  it('owner of company A cannot invite users into company B', async () => {
    const email = `iso-target-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const res = await app.request(`/api/companies/${companyB.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerA.token}`,
      },
      body: JSON.stringify({ email, role: MembershipRole.Member }),
    })
    expect(res.status).toBe(403)
  })

  it('owner of company A cannot remove members from company B', async () => {
    const res = await removeMember(app, companyB.id, memberB.id, ownerA.token)
    expect(res.status).toBe(403)
  })

  it('owner of company A cannot change roles in company B', async () => {
    const res = await changeRole(app, companyB.id, memberB.id, MembershipRole.Viewer, ownerA.token)
    expect(res.status).toBe(403)
  })

  it('owner of company A cannot list members of company B', async () => {
    const res = await listMembers(app, companyB.id, ownerA.token)
    expect(res.status).toBe(403)
  })
})
