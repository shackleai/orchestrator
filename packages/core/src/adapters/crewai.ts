/**
 * CrewAIAdapter — spawns a Python CrewAI crew as a subprocess.
 *
 * Treats an entire CrewAI crew as a single orchestrator agent. Spawns a
 * Python entrypoint, injects SHACKLEAI_* env vars, captures stdout/stderr
 * with a 10 MB buffer limit, and parses aggregate token usage from a
 * `__shackleai_result__` JSON block in stdout.
 *
 * Default timeout is 600 seconds (crews often run 10+ minutes).
 * Graceful shutdown: SIGTERM → 10 s grace → SIGKILL.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'

/** Default timeout in milliseconds (600 seconds). */
const DEFAULT_TIMEOUT_MS = 600_000

/** Grace period between SIGTERM and SIGKILL in milliseconds. */
const KILL_GRACE_MS = 10_000

/** Maximum stdout buffer size in bytes (10 MB). */
const MAX_STDOUT_BYTES = 10 * 1024 * 1024

/** Number of trailing lines to keep in the stdout excerpt. */
const EXCERPT_LINES = 500

/** Marker used by the Python crew to emit structured results. */
const RESULT_MARKER = '__shackleai_result__'

interface CrewAIUsage {
  inputTokens: number
  outputTokens: number
  costCents: number
  model: string
  provider: string
}

/**
 * Parse the last `__shackleai_result__` JSON block from stdout.
 * Expected format in stdout:
 *   __shackleai_result__{"inputTokens":…,"outputTokens":…,…}__shackleai_result__
 */
function parseUsageFromStdout(stdout: string): CrewAIUsage | undefined {
  const regex = new RegExp(
    `${RESULT_MARKER}(\\{[^}]+\\})${RESULT_MARKER}`,
    'g',
  )

  let last: string | undefined
  let match: RegExpExecArray | null
  while ((match = regex.exec(stdout)) !== null) {
    last = match[1]
  }

  if (!last) return undefined

  try {
    const parsed: unknown = JSON.parse(last)
    if (typeof parsed !== 'object' || parsed === null) return undefined

    const obj = parsed as Record<string, unknown>
    return {
      inputTokens: typeof obj.inputTokens === 'number' ? obj.inputTokens : 0,
      outputTokens:
        typeof obj.outputTokens === 'number' ? obj.outputTokens : 0,
      costCents: typeof obj.costCents === 'number' ? obj.costCents : 0,
      model: typeof obj.model === 'string' ? obj.model : 'unknown',
      provider: typeof obj.provider === 'string' ? obj.provider : 'crewai',
    }
  } catch {
    return undefined
  }
}

/**
 * Truncate stdout to the last N lines and prepend a warning header.
 */
function truncateStdout(raw: string): string {
  const lines = raw.split('\n')
  if (lines.length <= EXCERPT_LINES) return raw

  const excerpt = lines.slice(-EXCERPT_LINES).join('\n')
  return `[ShackleAI] stdout truncated — showing last ${EXCERPT_LINES} of ${lines.length} lines\n${excerpt}`
}

export class CrewAIAdapter implements AdapterModule {
  readonly type = 'crewai'
  readonly label = 'CrewAI Crew'

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const pythonPath =
      typeof ctx.adapterConfig.pythonPath === 'string'
        ? ctx.adapterConfig.pythonPath
        : 'python3'

    const entrypoint = ctx.adapterConfig.entrypoint as string | undefined
    if (!entrypoint) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'adapterConfig.entrypoint is required for crewai adapter',
      }
    }

    // Validate entrypoint file exists before spawning
    if (!existsSync(entrypoint)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Entrypoint file not found: ${entrypoint}`,
      }
    }

    const crewConfig = ctx.adapterConfig.crewConfig as string | undefined

    const timeoutMs =
      typeof ctx.adapterConfig.timeout === 'number'
        ? ctx.adapterConfig.timeout * 1000
        : DEFAULT_TIMEOUT_MS

    // Build task payload
    const payload = JSON.stringify({
      task: ctx.task ?? null,
      agentId: ctx.agentId,
      companyId: ctx.companyId,
      heartbeatRunId: ctx.heartbeatRunId,
      sessionState: ctx.sessionState ?? null,
    })

    // Build args
    const args: string[] = [entrypoint, '--task', payload]
    if (ctx.sessionState) {
      args.push('--session', ctx.sessionState)
    }
    if (crewConfig) {
      args.push('--config', crewConfig)
    }

    // Build env
    const env: Record<string, string> = {
      ...process.env,
      ...ctx.env,
      SHACKLEAI_RUN_ID: ctx.heartbeatRunId,
      SHACKLEAI_AGENT_ID: ctx.agentId,
    }

    if (ctx.task) {
      env.SHACKLEAI_TASK_ID = ctx.task
    }

    if (ctx.env.SHACKLEAI_API_URL) {
      env.SHACKLEAI_API_URL = ctx.env.SHACKLEAI_API_URL
    }

    return new Promise<AdapterResult>((resolve) => {
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutBytes = 0
      let stdoutTruncated = false
      let killed = false
      let killTimer: ReturnType<typeof setTimeout> | undefined

      const child = spawn(pythonPath, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length
        if (stdoutBytes <= MAX_STDOUT_BYTES) {
          stdoutChunks.push(chunk)
        } else if (!stdoutTruncated) {
          stdoutTruncated = true
          // Keep what we have — will truncate to last N lines at the end
        }
      })

      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      const timeoutId = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')

        killTimer = setTimeout(() => {
          child.kill('SIGKILL')
        }, KILL_GRACE_MS)
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        if (killTimer) clearTimeout(killTimer)

        const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8')
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')

        const usage = parseUsageFromStdout(rawStdout)

        let stdout = truncateStdout(rawStdout)
        if (stdoutTruncated) {
          stdout = `[ShackleAI] WARNING: stdout exceeded ${MAX_STDOUT_BYTES} bytes — output was truncated\n${stdout}`
        }

        // Parse session state from result block if present
        let sessionState: string | null = null
        const sessionRegex = new RegExp(
          `${RESULT_MARKER}(\\{[^}]+\\})${RESULT_MARKER}`,
          'g',
        )
        let lastSessionMatch: string | undefined
        let sessionMatch: RegExpExecArray | null
        while (
          (sessionMatch = sessionRegex.exec(rawStdout)) !== null
        ) {
          lastSessionMatch = sessionMatch[1]
        }
        if (lastSessionMatch) {
          try {
            const parsed = JSON.parse(lastSessionMatch) as Record<
              string,
              unknown
            >
            if (typeof parsed.sessionState === 'string') {
              sessionState = parsed.sessionState
            }
          } catch {
            // Ignore parse errors for session state
          }
        }

        resolve({
          exitCode: killed ? 124 : (code ?? 1),
          stdout,
          stderr: killed
            ? `Process killed after ${timeoutMs}ms timeout\n${stderr}`
            : stderr,
          sessionState,
          usage,
        })
      })

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        if (killTimer) clearTimeout(killTimer)

        resolve({
          exitCode: 127,
          stdout: '',
          stderr: `Failed to spawn process: ${err.message}`,
        })
      })
    })
  }

  async testEnvironment(): Promise<{ ok: boolean; error?: string }> {
    const pythonPath = 'python3'

    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const child = spawn(pythonPath, [
        '-c',
        'import crewai; print(crewai.__version__)',
      ])

      let _stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk: Buffer) => {
        _stdout += chunk.toString('utf-8')
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
      })

      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ ok: false, error: 'Timed out checking for CrewAI' })
      }, 15_000)

      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve({ ok: true })
        } else {
          resolve({
            ok: false,
            error: `CrewAI not available: ${stderr.trim() || 'exit code ' + String(code)}`,
          })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        resolve({
          ok: false,
          error: `Python not available: ${err.message}`,
        })
      })
    })
  }
}
