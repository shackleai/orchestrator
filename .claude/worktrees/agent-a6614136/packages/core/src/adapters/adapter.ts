/**
 * Core adapter interfaces — the extensible contract for all adapter types.
 *
 * An AdapterModule knows how to execute a single agent heartbeat and
 * return structured output. Adapters are registered in the AdapterRegistry
 * and selected at runtime based on an agent's `adapter_type` column.
 */

export interface AdapterContext {
  agentId: string
  companyId: string
  task?: string
  heartbeatRunId: string
  adapterConfig: Record<string, unknown>
  env: Record<string, string>
  sessionState?: string | null
}

export interface AdapterResult {
  exitCode: number
  stdout: string
  stderr: string
  sessionState?: string | null
  usage?: {
    inputTokens: number
    outputTokens: number
    costCents: number
    model: string
    provider: string
  }
}

export interface AdapterModule {
  /** Unique adapter type key (e.g. 'process', 'http', 'claude'). */
  type: string

  /** Human-readable label for display. */
  label: string

  /** Execute a single heartbeat and return structured output. */
  execute(ctx: AdapterContext): Promise<AdapterResult>

  /** Optional: verify that the runtime environment is ready for this adapter. */
  testEnvironment?(): Promise<{ ok: boolean; error?: string }>
}
