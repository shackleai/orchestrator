/**
 * ClaudeAdapter — invokes the Claude Code CLI to execute a heartbeat.
 *
 * Spawns `claude` with `--print` flag via child_process.spawn.
 * Reads `prompt`, `model`, and `timeout` from adapterConfig.
 * Parses stdout for `__shackleai_result__` JSON block containing
 * usage/session data. Injects SHACKLEAI_* env vars and CLAUDE_MODEL.
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'
import { getSafeEnv } from './env.js'
import { gracefulKill, KILL_GRACE_MS } from './kill.js'

const IS_WIN = process.platform === 'win32'

/** Default timeout in milliseconds (300 seconds). */
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Try to extract a __shackleai_result__ JSON block from output text.
 * Looks for `{"__shackleai_result__": ...}` anywhere in the output.
 */
function parseShackleResult(
  text: string,
): { sessionState?: string; usage?: AdapterResult['usage'] } | null {
  const marker = '__shackleai_result__'
  const idx = text.indexOf(marker)
  if (idx === -1) return null

  // Walk backwards to find the opening brace
  const braceStart = text.lastIndexOf('{', idx)
  if (braceStart === -1) return null

  // Walk forward from braceStart to find the matching closing brace
  let depth = 0
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
    if (depth === 0) {
      try {
        const json = JSON.parse(text.slice(braceStart, i + 1)) as Record<string, unknown>
        const result = json[marker] as Record<string, unknown> | undefined
        if (!result) return null

        const parsed: { sessionState?: string; usage?: AdapterResult['usage'] } = {}

        if (typeof result.sessionState === 'string') {
          parsed.sessionState = result.sessionState
        }

        if (result.usage && typeof result.usage === 'object') {
          const u = result.usage as Record<string, unknown>
          parsed.usage = {
            inputTokens: (u.inputTokens as number) ?? 0,
            outputTokens: (u.outputTokens as number) ?? 0,
            costCents: (u.costCents as number) ?? 0,
            model: (u.model as string) ?? 'unknown',
            provider: (u.provider as string) ?? 'unknown',
          }
        }

        return parsed
      } catch {
        return null
      }
    }
  }

  return null
}

export class ClaudeAdapter implements AdapterModule {
  readonly type = 'claude'
  readonly label = 'Claude Code CLI'

  private activeChild: ChildProcess | null = null
  private abortKillTimer: ReturnType<typeof setTimeout> | null = null

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const prompt = ctx.adapterConfig.prompt as string | undefined
    if (!prompt) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'adapterConfig.prompt is required for claude adapter',
      }
    }

    // Build full prompt: agent role + assigned task
    let fullPrompt = prompt

    // Include assigned tasks if available
    if (ctx.assignedTasks && ctx.assignedTasks.length > 0) {
      const taskList = ctx.assignedTasks
        .map((t: { title: string; description?: string | null }) =>
          `- ${t.title}${t.description ? ': ' + t.description : ''}`)
        .join('\n')
      fullPrompt = `${prompt}\n\nYour assigned task:\n${taskList}`
    }

    if (ctx.ancestry) {
      const parts: string[] = []
      if (ctx.ancestry.mission) parts.push(`Mission: ${ctx.ancestry.mission}`)
      if (ctx.ancestry.project) parts.push(`Project: ${ctx.ancestry.project.name}`)
      if (ctx.ancestry.goal) parts.push(`Goal: ${ctx.ancestry.goal.name}`)
      if (parts.length > 0) {
        fullPrompt = `Context: ${parts.join(' | ')}\n\n${fullPrompt}`
      }
    }

    const model = ctx.adapterConfig.model as string | undefined
    const timeoutMs =
      typeof ctx.adapterConfig.timeout === 'number'
        ? ctx.adapterConfig.timeout * 1000
        : DEFAULT_TIMEOUT_MS

    const shackleEnv: Record<string, string> = {
      ...ctx.env,
      SHACKLEAI_RUN_ID: ctx.heartbeatRunId,
      SHACKLEAI_AGENT_ID: ctx.agentId,
    }

    const env: Record<string, string> = getSafeEnv(shackleEnv)

    if (ctx.task) {
      env.SHACKLEAI_TASK_ID = ctx.task
    }

    if (ctx.ancestry?.mission) {
      env.SHACKLEAI_MISSION = ctx.ancestry.mission
    }
    if (ctx.ancestry?.project) {
      env.SHACKLEAI_PROJECT = ctx.ancestry.project.name
    }
    if (ctx.ancestry?.goal) {
      env.SHACKLEAI_GOAL = ctx.ancestry.goal.name
    }

    if (ctx.env.SHACKLEAI_API_KEY) {
      env.SHACKLEAI_API_KEY = ctx.env.SHACKLEAI_API_KEY
    }

    if (ctx.sessionState) {
      env.SHACKLEAI_SESSION_STATE = ctx.sessionState
    }

    if (model) {
      env.CLAUDE_MODEL = model
    }

    const args = ['--print', fullPrompt]
    if (model) {
      args.unshift('--model', model)
    }

    return new Promise<AdapterResult>((resolve) => {
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let killed = false
      let killTimer: ReturnType<typeof setTimeout> | undefined

      // Run in temp directory to avoid picking up CLAUDE.md from working directory
      const cwd = ctx.adapterConfig.cwd as string | undefined ?? (IS_WIN ? process.env.TEMP || 'C:\\Windows\\Temp' : '/tmp')

      const child = spawn(IS_WIN ? 'claude.cmd' : 'claude', args, {
        env,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !IS_WIN,
        shell: IS_WIN,
      })

      this.activeChild = child

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      const timeoutId = setTimeout(() => {
        killed = true
        killTimer = gracefulKill(child, KILL_GRACE_MS)
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        if (killTimer) clearTimeout(killTimer)
        this.clearActiveChild(child)

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')

        // Parse __shackleai_result__ from stdout
        const parsed = parseShackleResult(stdout)

        resolve({
          exitCode: killed ? 124 : (code ?? 1),
          stdout,
          stderr: killed ? `Claude CLI killed after ${timeoutMs}ms timeout\n${stderr}` : stderr,
          sessionState: parsed?.sessionState ?? null,
          usage: parsed?.usage,
        })
      })

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        if (killTimer) clearTimeout(killTimer)
        this.clearActiveChild(child)

        resolve({
          exitCode: 127,
          stdout: '',
          stderr: `Failed to spawn claude CLI: ${err.message}`,
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
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const child = spawn(IS_WIN ? 'claude.cmd' : 'claude', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: IS_WIN,
      })

      child.stdout.on('data', () => {
        // Drain stdout — we only care about exit code
      })

      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        resolve({ ok: false, error: 'claude --version timed out' })
      }, 10_000)

      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve({ ok: true })
        } else {
          resolve({ ok: false, error: `claude --version exited with code ${code}` })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ ok: false, error: `claude CLI not found: ${err.message}` })
      })
    })
  }

  private clearActiveChild(child: ChildProcess): void {
    if (this.activeChild === child) this.activeChild = null
    if (this.abortKillTimer) { clearTimeout(this.abortKillTimer); this.abortKillTimer = null }
  }
}
