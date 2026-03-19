/**
 * QuotaManager -- time-windowed provider-level quota enforcement.
 *
 * Enforces per-provider, per-agent (or company-wide) request and token limits
 * using a sliding window over cost_events with database-backed enforcement.
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { QuotaWindow, QuotaStatus } from '@shackleai/shared'

export interface QuotaCheckResult {
  allowed: boolean
  quotaId?: string
  reason?: string
}

const DURATION_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
}

export class QuotaManager {
  private readonly db: DatabaseProvider

  constructor(db: DatabaseProvider) {
    this.db = db
  }

  async checkQuota(
    companyId: string,
    agentId: string,
    provider?: string,
  ): Promise<QuotaCheckResult> {
    const conditions = ['company_id = $1', '(agent_id = $2 OR agent_id IS NULL)']
    const params: unknown[] = [companyId, agentId]

    if (provider) {
      conditions.push('(provider = $3 OR provider IS NULL)')
      params.push(provider)
    } else {
      conditions.push('provider IS NULL')
    }

    const where = conditions.join(' AND ')
    const result = await this.db.query<QuotaWindow>(
      `SELECT * FROM quota_windows WHERE ${where}`,
      params,
    )

    if (result.rows.length === 0) {
      return { allowed: true }
    }

    for (const quota of result.rows) {
      const durationMs = DURATION_MS[quota.window_duration]
      if (!durationMs) continue

      const windowStart = new Date(Date.now() - durationMs).toISOString()
      const usage = await this.getUsageForQuota(quota, companyId, windowStart)

      if (quota.max_requests !== null && usage.request_count >= quota.max_requests) {
        const scope = quota.agent_id ? 'agent' : 'company'
        const providerLabel = quota.provider ?? 'all providers'
        return {
          allowed: false,
          quotaId: quota.id,
          reason: `Request quota exceeded: ${usage.request_count}/${quota.max_requests} requests in ${quota.window_duration} window (${scope}, ${providerLabel})`,
        }
      }

      if (quota.max_tokens !== null && usage.total_tokens >= quota.max_tokens) {
        const scope = quota.agent_id ? 'agent' : 'company'
        const providerLabel = quota.provider ?? 'all providers'
        return {
          allowed: false,
          quotaId: quota.id,
          reason: `Token quota exceeded: ${usage.total_tokens}/${quota.max_tokens} tokens in ${quota.window_duration} window (${scope}, ${providerLabel})`,
        }
      }
    }

    return { allowed: true }
  }

  async getQuotaStatus(
    companyId: string,
    agentId?: string,
  ): Promise<QuotaStatus[]> {
    const conditions = ['company_id = $1']
    const params: unknown[] = [companyId]

    if (agentId) {
      conditions.push('(agent_id = $2 OR agent_id IS NULL)')
      params.push(agentId)
    }

    const where = conditions.join(' AND ')
    const quotas = await this.db.query<QuotaWindow>(
      `SELECT * FROM quota_windows WHERE ${where} ORDER BY created_at ASC`,
      params,
    )

    const statuses: QuotaStatus[] = []

    for (const quota of quotas.rows) {
      const durationMs = DURATION_MS[quota.window_duration]
      if (!durationMs) continue

      const windowStart = new Date(Date.now() - durationMs).toISOString()
      const usage = await this.getUsageForQuota(quota, companyId, windowStart)

      const requestExceeded =
        quota.max_requests !== null && usage.request_count >= quota.max_requests
      const tokenExceeded =
        quota.max_tokens !== null && usage.total_tokens >= quota.max_tokens

      statuses.push({
        quota,
        current_requests: usage.request_count,
        current_tokens: usage.total_tokens,
        exceeded: requestExceeded || tokenExceeded,
      })
    }

    return statuses
  }

  private async getUsageForQuota(
    quota: QuotaWindow,
    companyId: string,
    windowStart: string,
  ): Promise<{ request_count: number; total_tokens: number }> {
    const usageConditions = ['company_id = $1', 'occurred_at >= $2']
    const usageParams: unknown[] = [companyId, windowStart]
    let paramIdx = 3

    if (quota.agent_id) {
      usageConditions.push(`agent_id = $${paramIdx++}`)
      usageParams.push(quota.agent_id)
    }

    if (quota.provider) {
      usageConditions.push(`provider = $${paramIdx++}`)
      usageParams.push(quota.provider)
    }

    const usageWhere = usageConditions.join(' AND ')

    const usage = await this.db.query<{
      request_count: number
      total_tokens: number
    }>(
      `SELECT
         COUNT(*)::int AS request_count,
         COALESCE(SUM(input_tokens + output_tokens), 0)::int AS total_tokens
       FROM cost_events
       WHERE ${usageWhere}`,
      usageParams,
    )

    return usage.rows[0] ?? { request_count: 0, total_tokens: 0 }
  }
}
