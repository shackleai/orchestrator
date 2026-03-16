/**
 * HttpAdapter — sends a POST request to a webhook URL to execute a heartbeat.
 *
 * Reads `url`, `headers`, `authToken`, and `timeout` from adapterConfig.
 * Parses response JSON for a `__shackleai_result__` key containing usage/session data.
 * Uses Node.js native fetch (available in Node 18+).
 */

import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'

/** Default timeout in seconds. */
const DEFAULT_TIMEOUT_SECONDS = 300

export class HttpAdapter implements AdapterModule {
  readonly type = 'http'
  readonly label = 'HTTP Webhook'

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const url = ctx.adapterConfig.url as string | undefined
    if (!url) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'adapterConfig.url is required for http adapter',
      }
    }

    const customHeaders = (ctx.adapterConfig.headers as Record<string, string>) ?? {}
    const authToken = ctx.adapterConfig.authToken as string | undefined
    const timeoutSeconds =
      typeof ctx.adapterConfig.timeout === 'number'
        ? ctx.adapterConfig.timeout
        : DEFAULT_TIMEOUT_SECONDS

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    }

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }

    const payload = {
      agentId: ctx.agentId,
      companyId: ctx.companyId,
      heartbeatRunId: ctx.heartbeatRunId,
      task: ctx.task ?? null,
      sessionState: ctx.sessionState ?? null,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseText = await response.text()

      if (!response.ok) {
        return {
          exitCode: 1,
          stdout: responseText,
          stderr: `HTTP ${response.status}: ${response.statusText}`,
        }
      }

      // Try to parse __shackleai_result__ from response
      let sessionState: string | null = null
      let usage: AdapterResult['usage'] = undefined

      try {
        const json = JSON.parse(responseText) as Record<string, unknown>
        const result = json.__shackleai_result__ as Record<string, unknown> | undefined
        if (result) {
          if (typeof result.sessionState === 'string') {
            sessionState = result.sessionState
          }
          if (result.usage && typeof result.usage === 'object') {
            const u = result.usage as Record<string, unknown>
            usage = {
              inputTokens: (u.inputTokens as number) ?? 0,
              outputTokens: (u.outputTokens as number) ?? 0,
              costCents: (u.costCents as number) ?? 0,
              model: (u.model as string) ?? 'unknown',
              provider: (u.provider as string) ?? 'unknown',
            }
          }
        }
      } catch {
        // Response is not JSON or doesn't have __shackleai_result__ — that's fine
      }

      return {
        exitCode: 0,
        stdout: responseText,
        stderr: '',
        sessionState,
        usage,
      }
    } catch (err) {
      clearTimeout(timeoutId)

      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          exitCode: 124,
          stdout: '',
          stderr: `HTTP request timed out after ${timeoutSeconds}s`,
        }
      }

      const message = err instanceof Error ? err.message : String(err)
      return {
        exitCode: 1,
        stdout: '',
        stderr: `HTTP request failed: ${message}`,
      }
    }
  }

  async testEnvironment(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true }
  }
}
