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

import type { ChildProcess } from 'node:child_process'
import { spawn, execSync } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'
import { getSafeEnv } from './env.js'
import { gracefulKill, KILL_GRACE_MS } from './kill.js'

const IS_WIN = process.platform === 'win32'
const DEFAULT_PYTHON = IS_WIN ? 'python' : 'python3'

/** Default timeout in milliseconds (300 seconds). */
const DEFAULT_TIMEOUT_MS = 300_000

/** Maximum stdout buffer size in bytes (10 MB). */
const MAX_STDOUT_BYTES = 10 * 1024 * 1024

/** Marker for structured result JSON in stdout. */
const RESULT_MARKER = '__shackleai_result__'

interface ShackleAIResult {
  session_id_after?: string | null
  taskStatus?: 'done' | 'in_review' | 'in_progress'
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

/**
 * Well-known LLM provider API key environment variable names.
 * Maps standard env var names to possible secret name variations
 * that users might store in SecretsManager.
 */
const LLM_API_KEY_MAP: ReadonlyArray<{
  envVar: string
  secretNames: readonly string[]
}> = [
  {
    envVar: 'OPENAI_API_KEY',
    secretNames: ['OPENAI_API_KEY', 'openai_api_key', 'openai-api-key'],
  },
  {
    envVar: 'ANTHROPIC_API_KEY',
    secretNames: ['ANTHROPIC_API_KEY', 'anthropic_api_key', 'anthropic-api-key'],
  },
  {
    envVar: 'GOOGLE_API_KEY',
    secretNames: ['GOOGLE_API_KEY', 'google_api_key', 'google-api-key'],
  },
  {
    envVar: 'DEEPSEEK_API_KEY',
    secretNames: ['DEEPSEEK_API_KEY', 'deepseek_api_key', 'deepseek-api-key'],
  },
]

/**
 * Resolve LLM API keys from the adapter context env (populated by SecretsManager)
 * and return them mapped to standard environment variable names.
 *
 * Only sets a key if:
 * 1. A matching secret exists in ctx.env
 * 2. The target env var is not already set in the current env
 *
 * This ensures SecretsManager is the single source of truth while
 * allowing fallback to OpenClaw's own config or host env vars.
 */
function resolveLlmApiKeys(
  ctxEnv: Record<string, string>,
  currentEnv: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {}

  for (const mapping of LLM_API_KEY_MAP) {
    // Skip if the env var is already set (don't override existing values)
    if (currentEnv[mapping.envVar]) continue

    // Try each possible secret name variation
    for (const secretName of mapping.secretNames) {
      if (ctxEnv[secretName]) {
        resolved[mapping.envVar] = ctxEnv[secretName]
        break
      }
    }
  }

  return resolved
}

export class OpenClawAdapter implements AdapterModule {
  readonly type = 'openclaw'
  readonly label = 'OpenClaw Agent'

  private activeChild: ChildProcess | null = null
  private abortKillTimer: ReturnType<typeof setTimeout> | null = null

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const entrypoint = ctx.adapterConfig.entrypoint as string | undefined
    const agentName = (ctx.adapterConfig.agent as string) ?? 'main'
    const useCli = !entrypoint

    const timeoutMs =
      typeof ctx.adapterConfig.timeout === 'number'
        ? ctx.adapterConfig.timeout * 1000
        : DEFAULT_TIMEOUT_MS

    // Build environment: inject SHACKLEAI_* vars
    const shackleEnv: Record<string, string> = {
      ...ctx.env,
      SHACKLEAI_RUN_ID: ctx.heartbeatRunId,
      SHACKLEAI_AGENT_ID: ctx.agentId,
      SHACKLEAI_API_URL: (ctx.env.SHACKLEAI_API_URL as string) ?? '',
    }

    const env: Record<string, string> = getSafeEnv(shackleEnv)

    // Inject LLM API keys from SecretsManager (via ctx.env) into the
    // child process environment. Only sets keys that are not already present,
    // allowing OpenClaw to fall back to its own config or host env vars.
    const llmKeys = resolveLlmApiKeys(ctx.env, env)
    Object.assign(env, llmKeys)

    if (ctx.task) {
      env.SHACKLEAI_TASK_ID = ctx.task
    }

    if (ctx.sessionState) {
      env.SHACKLEAI_SESSION_STATE = ctx.sessionState
    }

    let command: string
    let args: string[]

    if (useCli) {
      // CLI mode: call `npx openclaw agent --local --agent <name> --message <task>`
      // Resolve openclaw CLI path — avoid npx spawn issues on Windows
      let openclawBin = ''
      if (IS_WIN) {
        try {
          const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim()
          openclawBin = join(globalRoot, 'openclaw', 'openclaw.mjs')
        } catch {
          // fallback below
        }
      }

      // Keep message short for spawn args — put full context in env var
      const shortMessage = ctx.task ?? 'Check assigned tasks and do the work'

      // Store full context in env var for OpenClaw to read
      if (ctx.systemContext) {
        env.SHACKLEAI_CONTEXT = ctx.systemContext
      }

      if (IS_WIN && openclawBin) {
        command = process.execPath // node
        args = [
          openclawBin, 'agent',
          '--local',
          '--agent', agentName,
          '--message', shortMessage,
          '--json',
        ]
      } else {
        command = IS_WIN ? 'npx.cmd' : 'npx'
        args = [
          'openclaw', 'agent',
          '--local',
          '--agent', agentName,
          '--message', shortMessage,
          '--json',
        ]
      }

      if (ctx.sessionState) {
        args.push('--session-id', ctx.sessionState)
      }
    } else {
      // Legacy Python entrypoint mode
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
      const taskPayload = JSON.stringify({
        task: ctx.task ?? '',
        agentId: ctx.agentId,
        companyId: ctx.companyId,
        heartbeatRunId: ctx.heartbeatRunId,
        sessionState: ctx.sessionState ?? null,
        ancestry: ctx.ancestry ?? null,
        systemContext: ctx.systemContext ?? null,
      })

      const sessionId = ctx.sessionState ?? ctx.heartbeatRunId
      command = pythonPath
      args = [entrypoint, '--task', taskPayload, '--session', sessionId]
    }

    return new Promise<AdapterResult>((resolve) => {
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutBytes = 0
      let stdoutTruncated = false
      let killed = false
      let killTimer: ReturnType<typeof setTimeout> | undefined

      const child = spawn(command, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !IS_WIN,
      })

      this.activeChild = child

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
        killTimer = gracefulKill(child, KILL_GRACE_MS)
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        if (killTimer) clearTimeout(killTimer)
        this.clearActiveChild(child)

        let stdout = Buffer.concat(stdoutChunks).toString('utf-8')
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')

        if (stdoutTruncated) {
          stdout += `\n[WARNING] stdout truncated at ${MAX_STDOUT_BYTES} bytes (10 MB limit)`
        }

        // Parse structured result block for usage, session state, and task status
        const result = parseResultBlock(stdout)
        const sessionState = result?.session_id_after ?? null
        const usage = result?.usage ?? undefined
        const taskStatus = result?.taskStatus ?? null

        resolve({
          exitCode: killed ? 124 : (code ?? 1),
          stdout,
          stderr: killed
            ? `Process killed after ${timeoutMs}ms timeout\n${stderr}`
            : stderr,
          sessionState,
          taskStatus,
          usage,
        })
      })

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        if (killTimer) clearTimeout(killTimer)
        this.clearActiveChild(child)

        resolve({
          exitCode: 127,
          stdout: '',
          stderr: `Failed to spawn OpenClaw process: ${err.message}`,
        })
      })
    })
  }

  abort(): void {
    const child = this.activeChild
    if (!child) return
    if (this.abortKillTimer) clearTimeout(this.abortKillTimer)
    this.abortKillTimer = gracefulKill(child, KILL_GRACE_MS)
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

  private clearActiveChild(child: ChildProcess): void {
    if (this.activeChild === child) this.activeChild = null
    if (this.abortKillTimer) { clearTimeout(this.abortKillTimer); this.abortKillTimer = null }
  }
}
