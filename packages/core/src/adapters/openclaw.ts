/**
 * OpenClawAdapter — spawns a Python OpenClaw agent as a subprocess.
 *
 * Constructs a CLI invocation of a Python entrypoint with a JSON task payload,
 * injects SHACKLEAI_* env vars, enforces a configurable timeout with graceful
 * SIGTERM -> SIGKILL escalation, and parses structured output for token usage
 * and session state.
 *
 * Cross-platform: on Windows, `python3` is typically just `python`.
 */

import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'
import { getSafeEnv } from './env.js'

const IS_WIN = process.platform === 'win32'
const DEFAULT_PYTHON = IS_WIN ? 'python' : 'python3'

/** Default timeout in milliseconds (300 seconds). */
const DEFAULT_TIMEOUT_MS = 300_000

/** Grace period between SIGTERM and SIGKILL in milliseconds. */
const KILL_GRACE_MS = 10_000

/** Maximum stdout buffer size in bytes (10 MB). */
const MAX_STDOUT_BYTES = 10 * 1024 * 1024

/** Marker for structured result JSON in stdout. */
const RESULT_MARKER = '__shackleai_result__'

interface ShackleAIResult {
  session_id_after?: string | null
  usage?: {
    inputTokens: number
    outputTokens: number
    costCents: number
    model: string
    provider: string
  }
}

/**
 * Parse the `__shackleai_result__` JSON block from stdout.
 * Expected format in stdout:
 *   __shackleai_result__{"session_id_after":"...","usage":{...}}__shackleai_result__
 */
function parseResultBlock(stdout: string): ShackleAIResult | null {
  const startIdx = stdout.indexOf(RESULT_MARKER)
  if (startIdx === -1) return null

  const jsonStart = startIdx + RESULT_MARKER.length
  const endIdx = stdout.indexOf(RESULT_MARKER, jsonStart)
  if (endIdx === -1) return null

  const jsonStr = stdout.slice(jsonStart, endIdx).trim()
  try {
    return JSON.parse(jsonStr) as ShackleAIResult
  } catch {
    return null
  }
}

export class OpenClawAdapter implements AdapterModule {
  readonly type = 'openclaw'
  readonly label = 'OpenClaw Agent'

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const entrypoint = ctx.adapterConfig.entrypoint as string | undefined
    if (!entrypoint) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'adapterConfig.entrypoint is required for openclaw adapter',
      }
    }

    // Validate entrypoint file exists before spawning
    try {
      await access(entrypoint, constants.R_OK)
    } catch {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Entrypoint not found or not readable: ${entrypoint}`,
      }
    }

    const pythonPath = (ctx.adapterConfig.pythonPath as string) ?? DEFAULT_PYTHON
    const timeoutMs =
      typeof ctx.adapterConfig.timeout === 'number'
        ? ctx.adapterConfig.timeout * 1000
        : DEFAULT_TIMEOUT_MS

    // Build the JSON task payload
    const taskPayload = JSON.stringify({
      task: ctx.task ?? '',
      agentId: ctx.agentId,
      companyId: ctx.companyId,
      heartbeatRunId: ctx.heartbeatRunId,
      sessionState: ctx.sessionState ?? null,
      ancestry: ctx.ancestry ?? null,
    })

    const sessionId = ctx.sessionState ?? ctx.heartbeatRunId

    const args = [entrypoint, '--task', taskPayload, '--session', sessionId]

    // Build environment: inject SHACKLEAI_* vars
    // Note: adapterConfig.envFile is supported for documentation purposes but
    // env file parsing is not implemented — users should set env vars directly.
    const shackleEnv: Record<string, string> = {
      ...ctx.env,
      SHACKLEAI_RUN_ID: ctx.heartbeatRunId,
      SHACKLEAI_AGENT_ID: ctx.agentId,
      SHACKLEAI_API_URL: (ctx.env.SHACKLEAI_API_URL as string) ?? '',
    }

    const env: Record<string, string> = getSafeEnv(shackleEnv)

    if (ctx.task) {
      env.SHACKLEAI_TASK_ID = ctx.task
    }

    if (ctx.sessionState) {
      env.SHACKLEAI_SESSION_STATE = ctx.sessionState
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
        if (stdoutTruncated) return
        stdoutBytes += chunk.length
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          stdoutTruncated = true
          // Keep what we have, but stop accumulating
          const overflow = stdoutBytes - MAX_STDOUT_BYTES
          const trimmed = chunk.subarray(0, chunk.length - overflow)
          if (trimmed.length > 0) {
            stdoutChunks.push(trimmed)
          }
        } else {
          stdoutChunks.push(chunk)
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

        let stdout = Buffer.concat(stdoutChunks).toString('utf-8')
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')

        if (stdoutTruncated) {
          stdout += `\n[WARNING] stdout truncated at ${MAX_STDOUT_BYTES} bytes (10 MB limit)`
        }

        // Parse structured result block for usage and session state
        const result = parseResultBlock(stdout)
        const sessionState = result?.session_id_after ?? null
        const usage = result?.usage ?? undefined

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
          stderr: `Failed to spawn OpenClaw process: ${err.message}`,
        })
      })
    })
  }

  async testEnvironment(): Promise<{ ok: boolean; error?: string }> {
    const pythonPath = DEFAULT_PYTHON

    // Step 1: Check if Python is available
    const pythonCheck = await this.spawnCheck(pythonPath, ['--version'])
    if (!pythonCheck.ok) {
      return {
        ok: false,
        error: `Python not found (tried '${pythonPath}'): ${pythonCheck.error}`,
      }
    }

    // Step 2: Check if OpenClaw is installed
    const openclawCheck = await this.spawnCheck(pythonPath, [
      '-c',
      'import openclaw; print(openclaw.__version__)',
    ])
    if (!openclawCheck.ok) {
      return {
        ok: false,
        error: `OpenClaw not installed: ${openclawCheck.error}`,
      }
    }

    return { ok: true }
  }

  private spawnCheck(
    command: string,
    args: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const stderrChunks: Buffer[] = []
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ ok: false, error: 'Timed out checking environment' })
      }, 10_000)

      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve({ ok: true })
        } else {
          const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
          resolve({ ok: false, error: stderr || `Exit code ${code}` })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ ok: false, error: err.message })
      })
    })
  }
}
