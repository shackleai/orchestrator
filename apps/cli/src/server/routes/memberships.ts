/**
 * Company membership, invite & join-request routes
 *
 * Mounted at /api/companies — routes include /:id/ prefix.
 * All mutating endpoints require human JWT auth via humanAuth middleware.
 * Public endpoints: GET /api/invites/:token (invite details)
 */

import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type {
  CompanyMembership,
  CompanyInvite,
  JoinRequest,
  User,
} from '@shackleai/shared'
import {
  CreateInviteInput,
  CreateJoinRequestInput,
  UpdateMemberRoleInput,
} from '@shackleai/shared'
import {
  MembershipRole,
  MembershipRoleWeight,
  JoinRequestStatus,
  INVITE_TTL_MS,
} from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { humanAuth, type HumanAuthVariables } from '../middleware/human-auth.js'

type Variables = CompanyScopeVariables & HumanAuthVariables

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if `actor` role outranks `target` role. */
function outranks(actorRole: string, targetRole: string): boolean {
  const a = MembershipRoleWeight[actorRole as MembershipRole] ?? 0
  const t = MembershipRoleWeight[targetRole as MembershipRole] ?? 0
  return a > t
}

/** Returns true if `role` is admin or owner. */
function isAdminOrAbove(role: string): boolean {
  const w = MembershipRoleWeight[role as MembershipRole] ?? 0
  return w >= MembershipRoleWeight[MembershipRole.Admin]
}

/** Look up calling user's membership in a company. */
async function getCallerMembership(
  db: DatabaseProvider,
  companyId: string,
  userId: string,
): Promise<CompanyMembership | null> {
  const result = await db.query<CompanyMembership>(
    'SELECT * FROM company_memberships WHERE company_id = $1 AND user_id = $2',
    [companyId, userId],
  )
  return result.rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Router — company-scoped membership routes
// ---------------------------------------------------------------------------

export function membershipsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // -------------------------------------------------------------------------
  // GET /:id/members — list company members (members and above only)
  // -------------------------------------------------------------------------
  app.get('/:id/members', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const userId = c.get('userId')

    // Require caller to be at least a member of the company
    const callerMembership = await getCallerMembership(db, company.id, userId)
    if (!callerMembership) {
      return c.json({ error: 'Forbidden — you must be a member of this company' }, 403)
    }

    const result = await db.query<CompanyMembership & { user_name: string; user_email: string }>(
      `SELECT cm.*, u.name as user_name, u.email as user_email
       FROM company_memberships cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.company_id = $1
       ORDER BY cm.joined_at ASC`,
      [company.id],
    )

    return c.json({ data: result.rows })
  })

  // -------------------------------------------------------------------------
  // POST /:id/invites — create an invite (admin+ only)
  // -------------------------------------------------------------------------
  app.post('/:id/invites', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const userId = c.get('userId')

    // Verify caller is admin+
    const callerMembership = await getCallerMembership(db, company.id, userId)
    if (!callerMembership || !isAdminOrAbove(callerMembership.role)) {
      return c.json({ error: 'Forbidden — admin or owner role required' }, 403)
    }

    const body = await c.req.json()
    const parsed = CreateInviteInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
    }

    const { email, role } = parsed.data

    // Cannot invite someone with a higher role than your own
    if (!outranks(callerMembership.role, role) && callerMembership.role !== role) {
      // Allow same-level (admin inviting admin) but not higher
      if (MembershipRoleWeight[role as MembershipRole] > MembershipRoleWeight[callerMembership.role as MembershipRole]) {
        return c.json({ error: 'Cannot invite a user with a role above your own' }, 403)
      }
    }

    // Owners cannot be invited — they are set at company creation
    if (role === MembershipRole.Owner) {
      return c.json({ error: 'Cannot invite with owner role' }, 400)
    }

    // Check if user is already a member
    const existingMember = await db.query(
      `SELECT cm.id FROM company_memberships cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.company_id = $1 AND u.email = $2`,
      [company.id, email.toLowerCase()],
    )
    if (existingMember.rows.length > 0) {
      return c.json({ error: 'User is already a member of this company' }, 409)
    }

    // Check for existing pending invite
    const existingInvite = await db.query(
      `SELECT id FROM company_invites
       WHERE company_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > NOW()`,
      [company.id, email.toLowerCase()],
    )
    if (existingInvite.rows.length > 0) {
      return c.json({ error: 'A pending invite already exists for this email' }, 409)
    }

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()

    const result = await db.query<CompanyInvite>(
      `INSERT INTO company_invites (company_id, email, role, token, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [company.id, email.toLowerCase(), role, token, userId, expiresAt],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // -------------------------------------------------------------------------
  // GET /:id/invites — list invites for a company (admin+ only)
  // -------------------------------------------------------------------------
  app.get('/:id/invites', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const userId = c.get('userId')

    const callerMembership = await getCallerMembership(db, company.id, userId)
    if (!callerMembership || !isAdminOrAbove(callerMembership.role)) {
      return c.json({ error: 'Forbidden — admin or owner role required' }, 403)
    }

    const result = await db.query<CompanyInvite>(
      `SELECT * FROM company_invites WHERE company_id = $1 ORDER BY created_at DESC`,
      [company.id],
    )

    return c.json({ data: result.rows })
  })

  // -------------------------------------------------------------------------
  // POST /:id/join-requests — request to join a company (any authenticated user)
  // -------------------------------------------------------------------------
  app.post('/:id/join-requests', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const userId = c.get('userId')

    const body = await c.req.json()
    const parsed = CreateJoinRequestInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
    }

    // Already a member?
    const existing = await getCallerMembership(db, company.id, userId)
    if (existing) {
      return c.json({ error: 'Already a member of this company' }, 409)
    }

    // Already have a pending request?
    const pendingReq = await db.query(
      `SELECT id FROM join_requests
       WHERE company_id = $1 AND user_id = $2 AND status = $3`,
      [company.id, userId, JoinRequestStatus.Pending],
    )
    if (pendingReq.rows.length > 0) {
      return c.json({ error: 'A pending join request already exists' }, 409)
    }

    const result = await db.query<JoinRequest>(
      `INSERT INTO join_requests (company_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [company.id, userId, parsed.data.message ?? null],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // -------------------------------------------------------------------------
  // GET /:id/join-requests — list join requests (admin+ only)
  // -------------------------------------------------------------------------
  app.get('/:id/join-requests', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const userId = c.get('userId')

    const callerMembership = await getCallerMembership(db, company.id, userId)
    if (!callerMembership || !isAdminOrAbove(callerMembership.role)) {
      return c.json({ error: 'Forbidden — admin or owner role required' }, 403)
    }

    const result = await db.query<JoinRequest & { user_name: string; user_email: string }>(
      `SELECT jr.*, u.name as user_name, u.email as user_email
       FROM join_requests jr
       JOIN users u ON u.id = jr.user_id
       WHERE jr.company_id = $1
       ORDER BY jr.created_at DESC`,
      [company.id],
    )

    return c.json({ data: result.rows })
  })

  // -------------------------------------------------------------------------
  // PUT /:id/join-requests/:requestId/:action — approve or deny (admin+ only)
  // -------------------------------------------------------------------------
  app.put('/:id/join-requests/:requestId/:action', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const userId = c.get('userId')
    const requestId = c.req.param('requestId')!
    const action = c.req.param('action')!

    if (action !== 'approve' && action !== 'deny') {
      return c.json({ error: 'Action must be "approve" or "deny"' }, 400)
    }

    const callerMembership = await getCallerMembership(db, company.id, userId)
    if (!callerMembership || !isAdminOrAbove(callerMembership.role)) {
      return c.json({ error: 'Forbidden — admin or owner role required' }, 403)
    }

    const reqResult = await db.query<JoinRequest>(
      'SELECT * FROM join_requests WHERE id = $1 AND company_id = $2',
      [requestId, company.id],
    )

    if (reqResult.rows.length === 0) {
      return c.json({ error: 'Join request not found' }, 404)
    }

    const joinReq = reqResult.rows[0]
    if (joinReq.status !== JoinRequestStatus.Pending) {
      return c.json({ error: `Join request already ${joinReq.status}` }, 409)
    }

    const newStatus = action === 'approve' ? JoinRequestStatus.Approved : JoinRequestStatus.Denied

    await db.query(
      `UPDATE join_requests SET status = $1, decided_by = $2 WHERE id = $3`,
      [newStatus, userId, requestId],
    )

    // If approved, create the membership
    if (action === 'approve') {
      await db.query(
        `INSERT INTO company_memberships (company_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, user_id) DO NOTHING`,
        [company.id, joinReq.user_id, MembershipRole.Member],
      )

      // Also set the user's company_id if not already set
      await db.query(
        `UPDATE users SET company_id = $1, updated_at = NOW() WHERE id = $2 AND company_id IS NULL`,
        [company.id, joinReq.user_id],
      )
    }

    return c.json({ data: { message: `Join request ${newStatus}`, request_id: requestId } })
  })

  // -------------------------------------------------------------------------
  // PUT /:id/members/:userId/role — change a member's role (admin+ only)
  // -------------------------------------------------------------------------
  app.put('/:id/members/:userId/role', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const callerId = c.get('userId')
    const targetUserId = c.req.param('userId')!

    const body = await c.req.json()
    const parsed = UpdateMemberRoleInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
    }

    const { role: newRole } = parsed.data

    // Cannot set owner role via this endpoint
    if (newRole === MembershipRole.Owner) {
      return c.json({ error: 'Cannot assign owner role via this endpoint' }, 400)
    }

    const callerMembership = await getCallerMembership(db, company.id, callerId)
    if (!callerMembership || !isAdminOrAbove(callerMembership.role)) {
      return c.json({ error: 'Forbidden — admin or owner role required' }, 403)
    }

    const targetMembership = await getCallerMembership(db, company.id, targetUserId)
    if (!targetMembership) {
      return c.json({ error: 'Member not found' }, 404)
    }

    // Cannot change the role of someone with equal or higher rank (unless you're owner)
    if (callerMembership.role !== MembershipRole.Owner && !outranks(callerMembership.role, targetMembership.role)) {
      return c.json({ error: 'Cannot change the role of a member with equal or higher rank' }, 403)
    }

    // Cannot demote yourself
    if (callerId === targetUserId) {
      return c.json({ error: 'Cannot change your own role' }, 400)
    }

    await db.query(
      `UPDATE company_memberships SET role = $1 WHERE company_id = $2 AND user_id = $3`,
      [newRole, company.id, targetUserId],
    )

    return c.json({ data: { message: 'Role updated', user_id: targetUserId, role: newRole } })
  })

  // -------------------------------------------------------------------------
  // DELETE /:id/members/:userId — remove a member (admin+ only, or self)
  // -------------------------------------------------------------------------
  app.delete('/:id/members/:userId', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const callerId = c.get('userId')
    const targetUserId = c.req.param('userId')!

    const targetMembership = await getCallerMembership(db, company.id, targetUserId)
    if (!targetMembership) {
      return c.json({ error: 'Member not found' }, 404)
    }

    // Cannot remove the owner
    if (targetMembership.role === MembershipRole.Owner) {
      return c.json({ error: 'Cannot remove the company owner' }, 403)
    }

    // Self-removal is always allowed (leaving the company)
    if (callerId === targetUserId) {
      await db.query(
        'DELETE FROM company_memberships WHERE company_id = $1 AND user_id = $2',
        [company.id, targetUserId],
      )
      // Clear the user's company_id if it matches
      await db.query(
        'UPDATE users SET company_id = NULL, updated_at = NOW() WHERE id = $1 AND company_id = $2',
        [targetUserId, company.id],
      )
      return c.json({ data: { message: 'You have left the company' } })
    }

    // Otherwise require admin+
    const callerMembership = await getCallerMembership(db, company.id, callerId)
    if (!callerMembership || !isAdminOrAbove(callerMembership.role)) {
      return c.json({ error: 'Forbidden — admin or owner role required' }, 403)
    }

    // Cannot remove someone with equal or higher rank (unless owner)
    if (callerMembership.role !== MembershipRole.Owner && !outranks(callerMembership.role, targetMembership.role)) {
      return c.json({ error: 'Cannot remove a member with equal or higher rank' }, 403)
    }

    await db.query(
      'DELETE FROM company_memberships WHERE company_id = $1 AND user_id = $2',
      [company.id, targetUserId],
    )

    // Clear the user's company_id if it matches
    await db.query(
      'UPDATE users SET company_id = NULL, updated_at = NOW() WHERE id = $1 AND company_id = $2',
      [targetUserId, company.id],
    )

    return c.json({ data: { message: 'Member removed', user_id: targetUserId } })
  })

  return app
}

// ---------------------------------------------------------------------------
// Public invite routes — mounted at /api/invites (no API key required)
// ---------------------------------------------------------------------------

export function invitesPublicRouter(db: DatabaseProvider): Hono {
  const app = new Hono()

  // GET /api/invites/:token — get invite details (public, no auth)
  app.get('/:token', async (c) => {
    const token = c.req.param('token')!

    const result = await db.query<CompanyInvite & { company_name: string }>(
      `SELECT ci.*, co.name as company_name
       FROM company_invites ci
       JOIN companies co ON co.id = ci.company_id
       WHERE ci.token = $1`,
      [token],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Invite not found' }, 404)
    }

    const invite = result.rows[0]

    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      return c.json({ error: 'Invite has expired' }, 410)
    }

    // Check if already accepted
    if (invite.accepted_at) {
      return c.json({ error: 'Invite has already been accepted' }, 410)
    }

    // Return safe subset (no internal IDs exposed unnecessarily)
    return c.json({
      data: {
        company_name: invite.company_name,
        email: invite.email,
        role: invite.role,
        expires_at: invite.expires_at,
      },
    })
  })

  // POST /api/invites/:token/accept — accept invite (requires JWT auth)
  app.post('/:token/accept', async (c) => {
    // This endpoint needs human auth but is mounted outside the global API key middleware.
    // We manually verify JWT here since humanAuth middleware requires db on context.
    const { createHash } = await import('node:crypto')
    const { verifyJwt } = await import('./auth.js')

    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized — login required to accept an invite' }, 401)
    }

    const jwtToken = authHeader.slice('Bearer '.length).trim()
    const payload = verifyJwt(jwtToken)
    if (!payload) {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }

    // Verify session
    const tokenHash = createHash('sha256').update(jwtToken).digest('hex')
    const session = await db.query(
      'SELECT id FROM user_sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash],
    )
    if (session.rows.length === 0) {
      return c.json({ error: 'Session expired or invalidated' }, 401)
    }

    const userId = payload.sub
    const inviteToken = c.req.param('token')!

    const inviteResult = await db.query<CompanyInvite>(
      'SELECT * FROM company_invites WHERE token = $1',
      [inviteToken],
    )

    if (inviteResult.rows.length === 0) {
      return c.json({ error: 'Invite not found' }, 404)
    }

    const invite = inviteResult.rows[0]

    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      return c.json({ error: 'Invite has expired' }, 410)
    }

    // Check if already accepted
    if (invite.accepted_at) {
      return c.json({ error: 'Invite has already been accepted' }, 410)
    }

    // Verify the accepting user's email matches the invite
    const userResult = await db.query<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId],
    )
    if (userResult.rows.length === 0) {
      return c.json({ error: 'User not found' }, 404)
    }

    const user = userResult.rows[0]
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      return c.json({ error: 'This invite was sent to a different email address' }, 403)
    }

    // Check if already a member
    const existingMembership = await db.query(
      'SELECT id FROM company_memberships WHERE company_id = $1 AND user_id = $2',
      [invite.company_id, userId],
    )
    if (existingMembership.rows.length > 0) {
      // Mark invite as accepted anyway
      await db.query(
        'UPDATE company_invites SET accepted_at = NOW() WHERE id = $1',
        [invite.id],
      )
      return c.json({ data: { message: 'Already a member of this company' } })
    }

    // Create membership
    await db.query(
      `INSERT INTO company_memberships (company_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [invite.company_id, userId, invite.role],
    )

    // Mark invite as accepted
    await db.query(
      'UPDATE company_invites SET accepted_at = NOW() WHERE id = $1',
      [invite.id],
    )

    // Set the user's company_id if not already set
    await db.query(
      'UPDATE users SET company_id = $1, updated_at = NOW() WHERE id = $2 AND company_id IS NULL',
      [invite.company_id, userId],
    )

    return c.json({
      data: {
        message: 'Invite accepted',
        company_id: invite.company_id,
        role: invite.role,
      },
    })
  })

  return app
}
