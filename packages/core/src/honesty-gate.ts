/**
 * Honesty Gate — verifies an issue's checklist is fully checked before
 * allowing status transition to "done".
 *
 * Used by both the heartbeat executor (agent-driven completion) and the
 * API route (manual/external completion).
 */

import type { DatabaseProvider } from '@shackleai/db'

export interface HonestyChecklistItem {
  label: string
  checked: boolean
}

export interface HonestyGateResult {
  passed: boolean
  /** Present when the gate blocks completion. */
  reason?: string
  /** Unchecked items, if any. */
  uncheckedItems?: string[]
}

/**
 * Check whether an issue passes the honesty gate for completion.
 *
 * Rules:
 * 1. If the issue has an explicit honesty_checklist, ALL items must be checked.
 * 2. If the issue has no checklist, fall back to the company's default_honesty_checklist.
 *    If a company default exists, it is auto-applied (all items unchecked) and the gate blocks.
 * 3. If neither exists, the gate passes (no checklist configured).
 */
export async function checkHonestyGate(
  db: DatabaseProvider,
  issueId: string,
  companyId: string,
): Promise<HonestyGateResult> {
  // Load the issue's checklist
  const issueResult = await db.query<{ honesty_checklist: HonestyChecklistItem[] | null }>(
    `SELECT honesty_checklist FROM issues WHERE id = $1 AND company_id = $2`,
    [issueId, companyId],
  )

  if (issueResult.rows.length === 0) {
    return { passed: false, reason: 'Issue not found' }
  }

  let checklist = issueResult.rows[0].honesty_checklist

  // Parse if stored as string (JSONB should auto-parse, but safety net)
  if (typeof checklist === 'string') {
    try {
      checklist = JSON.parse(checklist) as HonestyChecklistItem[]
    } catch {
      return { passed: false, reason: 'Invalid honesty_checklist format on issue' }
    }
  }

  // If no issue-level checklist, check company defaults
  if (!checklist || checklist.length === 0) {
    const companyResult = await db.query<{ default_honesty_checklist: string[] | null }>(
      `SELECT default_honesty_checklist FROM companies WHERE id = $1`,
      [companyId],
    )

    const companyDefaults = companyResult.rows[0]?.default_honesty_checklist

    // Parse if stored as string
    let defaults: string[] | null = null
    if (typeof companyDefaults === 'string') {
      try {
        defaults = JSON.parse(companyDefaults) as string[]
      } catch {
        defaults = null
      }
    } else {
      defaults = companyDefaults
    }

    if (!defaults || defaults.length === 0) {
      // No checklist configured anywhere — gate passes
      return { passed: true }
    }

    // Auto-apply company defaults to the issue (all unchecked)
    const defaultChecklist: HonestyChecklistItem[] = defaults.map((label) => ({
      label,
      checked: false,
    }))

    await db.query(
      `UPDATE issues SET honesty_checklist = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(defaultChecklist), issueId],
    )

    return {
      passed: false,
      reason: 'Honesty checklist not completed — company defaults applied',
      uncheckedItems: defaults,
    }
  }

  // Verify all items are checked
  const unchecked = checklist.filter((item) => !item.checked)
  if (unchecked.length > 0) {
    return {
      passed: false,
      reason: `Honesty checklist incomplete: ${unchecked.length} item(s) unchecked`,
      uncheckedItems: unchecked.map((item) => item.label),
    }
  }

  return { passed: true }
}
