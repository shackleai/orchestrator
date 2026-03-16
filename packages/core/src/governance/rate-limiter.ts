/**
 * In-memory rate limiter using a sliding-window token bucket.
 *
 * Each (policyId, agentId) pair gets an independent bucket.
 * Tokens refill continuously based on max_calls_per_hour.
 *
 * Security notes:
 * - In-memory only — resets on process restart (acceptable for local orchestrator)
 * - No external state means no race conditions in single-process mode
 * - For distributed deployments, replace with Redis-backed limiter
 */

interface TokenBucket {
  tokens: number
  maxTokens: number
  lastRefill: number // epoch ms
  refillRate: number // tokens per ms
}

export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>()

  /**
   * Check whether a tool call is within the rate limit.
   *
   * @param policyId       — UUID of the governing policy
   * @param agentId        — UUID of the agent making the call
   * @param maxCallsPerHour — Maximum allowed calls per hour for this policy
   * @returns true if within limit (token consumed), false if exceeded
   */
  checkRateLimit(
    policyId: string,
    agentId: string,
    maxCallsPerHour: number,
  ): boolean {
    if (maxCallsPerHour <= 0) {
      return false
    }

    const key = `${policyId}:${agentId}`
    const now = Date.now()

    let bucket = this.buckets.get(key)

    if (!bucket) {
      // Initialize bucket with full tokens minus one (for this call)
      bucket = {
        tokens: maxCallsPerHour - 1,
        maxTokens: maxCallsPerHour,
        lastRefill: now,
        refillRate: maxCallsPerHour / (60 * 60 * 1000), // tokens per ms
      }
      this.buckets.set(key, bucket)
      return true
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill
    const refilled = elapsed * bucket.refillRate
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + refilled)
    bucket.lastRefill = now

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }

    return false
  }

  /**
   * Reset all rate limit buckets. Useful for testing.
   */
  reset(): void {
    this.buckets.clear()
  }
}
