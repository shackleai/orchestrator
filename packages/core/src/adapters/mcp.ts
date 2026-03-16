/**
 * McpAdapter — connects to an MCP server and calls a tool to execute a heartbeat.
 *
 * Uses @modelcontextprotocol/sdk Client + StreamableHTTPClientTransport to
 * connect to an HTTP-based MCP server. Reads `url`, `toolName`, `toolParams`,
 * and `timeout` from adapterConfig.
 */

import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'

/** Default timeout in seconds. */
const DEFAULT_TIMEOUT_SECONDS = 300

export class McpAdapter implements AdapterModule {
  readonly type = 'mcp'
  readonly label = 'MCP Server Tool'

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const url = ctx.adapterConfig.url as string | undefined
    if (!url) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'adapterConfig.url is required for mcp adapter',
      }
    }

    const toolName = ctx.adapterConfig.toolName as string | undefined
    if (!toolName) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'adapterConfig.toolName is required for mcp adapter',
      }
    }

    const toolParams = (ctx.adapterConfig.toolParams as Record<string, unknown>) ?? {}
    const timeoutSeconds =
      typeof ctx.adapterConfig.timeout === 'number'
        ? ctx.adapterConfig.timeout
        : DEFAULT_TIMEOUT_SECONDS

    // Dynamically import MCP SDK to keep it optional at load time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Client: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let StreamableHTTPClientTransport: any

    try {
      const clientMod = await import('@modelcontextprotocol/sdk/client/index.js')
      Client = clientMod.Client
      const transportMod = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
      StreamableHTTPClientTransport = transportMod.StreamableHTTPClientTransport
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Failed to load @modelcontextprotocol/sdk: ${message}. Install it with: pnpm add @modelcontextprotocol/sdk`,
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any

    try {
      const transport = new StreamableHTTPClientTransport(new URL(url))

      client = new Client({
        name: 'shackleai-orchestrator',
        version: '1.0.0',
      })

      await client.connect(transport)

      // Enrich tool params with context
      const enrichedParams = {
        ...toolParams,
        _shackleai: {
          agentId: ctx.agentId,
          companyId: ctx.companyId,
          heartbeatRunId: ctx.heartbeatRunId,
          task: ctx.task ?? null,
          sessionState: ctx.sessionState ?? null,
        },
      }

      const timeoutMs = timeoutSeconds * 1000
      const result = await Promise.race([
        client.callTool({
          name: toolName,
          arguments: enrichedParams,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('MCP call timed out')),
            timeoutMs,
          ),
        ),
      ])

      const content = result.content as Array<{ type: string; text?: string }> | undefined
      const textParts = (content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)

      const stdout = textParts.join('\n')

      // Try to parse __shackleai_result__ from output
      let sessionState: string | null = null
      let usage: AdapterResult['usage'] = undefined

      for (const text of textParts) {
        try {
          const json = JSON.parse(text) as Record<string, unknown>
          const shackleResult = json.__shackleai_result__ as Record<string, unknown> | undefined
          if (shackleResult) {
            if (typeof shackleResult.sessionState === 'string') {
              sessionState = shackleResult.sessionState
            }
            if (shackleResult.usage && typeof shackleResult.usage === 'object') {
              const u = shackleResult.usage as Record<string, unknown>
              usage = {
                inputTokens: (u.inputTokens as number) ?? 0,
                outputTokens: (u.outputTokens as number) ?? 0,
                costCents: (u.costCents as number) ?? 0,
                model: (u.model as string) ?? 'unknown',
                provider: (u.provider as string) ?? 'unknown',
              }
            }
            break
          }
        } catch {
          // Not JSON, continue
        }
      }

      return {
        exitCode: result.isError ? 1 : 0,
        stdout,
        stderr: result.isError ? stdout : '',
        sessionState,
        usage,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      // Check for our Promise.race timeout
      if (message === 'MCP call timed out') {
        return {
          exitCode: 124,
          stdout: '',
          stderr: `MCP request timed out after ${timeoutSeconds}s`,
        }
      }

      return {
        exitCode: 1,
        stdout: '',
        stderr: `MCP tool call failed: ${message}`,
      }
    } finally {
      try {
        await client?.close()
      } catch {
        // Ignore close errors
      }
    }
  }

  async testEnvironment(): Promise<{ ok: boolean; error?: string }> {
    try {
      await import('@modelcontextprotocol/sdk/client/index.js' as string)
      return { ok: true }
    } catch {
      return {
        ok: false,
        error: '@modelcontextprotocol/sdk is not installed',
      }
    }
  }
}
