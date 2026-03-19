/**
 * CodexAdapter — invokes the OpenAI Codex CLI to execute a heartbeat.
 *
 * Spawns `codex` with the prompt via `--prompt` argument.
 * Follows the same patterns as ClaudeAdapter: graceful kill,
 * timeout handling, __shackleai_result__ parsing, and safe env.
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'
import { getSafeEnv } from './env.js'
import { gracefulKill, KILL_GRACE_MS } from './kill.js'
import { buildFullPrompt, parseShackleResult } from './util.js'

const IS_WIN = process.platform === 'win32'
const DEFAULT_TIMEOUT_MS = 300_000

export class CodexAdapter implements AdapterModule {
  readonly type = 'codex'
  readonly label = 'OpenAI Codex CLI'

  private activeChild: ChildProcess | null = null
  private abortKillTimer: ReturnType<typeof setTimeout> | null = null

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const prompt = ctx.adapterConfig.prompt as string | undefined
    if (!prompt) {
      return { exitCode: 1, stdout: '', stderr: 'adapterConfig.prompt is required for codex adapter' }
    }

    const fullPrompt = buildFullPrompt(prompt, ctx)
    const timeoutMs = typeof ctx.adapterConfig.timeout === 'number'
      ? ctx.adapterConfig.timeout * 1000
      : DEFAULT_TIMEOUT_MS
    const env = this.buildEnv(ctx)
    const args = ['--quiet', '--prompt', fullPrompt]
    const model = ctx.adapterConfig.model as string | undefined
    if (model) args.unshift('--model', model)

    return new Promise<AdapterResult>((resolve) => {
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let killed = false
      let killTimer: ReturnType<typeof setTimeout> | undefined

      const child = spawn('codex', args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: IS_WIN,
        detached: !IS_WIN,
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
        const parsed = parseShackleResult(stdout)
        resolve({
          exitCode: killed ? 124 : (code ?? 1),
          stdout,
          stderr: killed ? `Codex CLI killed after ${timeoutMs}ms timeout\n${stderr}` : stderr,
          sessionState: parsed?.sessionState ?? null,
          usage: parsed?.usage,
        })
      })

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        if (killTimer) clearTimeout(killTimer)
        this.clearActiveChild(child)
        resolve({ exitCode: 127, stdout: '', stderr: `Failed to spawn codex CLI: ${err.message}` })
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
      const child = spawn('codex', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: IS_WIN,
      })
      child.stdout.on('data', () => { /* drain */ })
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        resolve({ ok: false, error: 'codex --version timed out' })
      }, 10_000)
      child.on('close', (code) => {
        clearTimeout(timeout)
        resolve(code === 0
          ? { ok: true }
          : { ok: false, error: `codex --version exited with code ${code}` })
      })
      child.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ ok: false, error: `codex CLI not found: ${err.message}` })
      })
    })
  }

  private buildEnv(ctx: AdapterContext): Record<string, string> {
    const shackleEnv: Record<string, string> = {
      ...ctx.env,
      SHACKLEAI_RUN_ID: ctx.heartbeatRunId,
      SHACKLEAI_AGENT_ID: ctx.agentId,
    }
    const env = getSafeEnv(shackleEnv)
    if (ctx.task) env.SHACKLEAI_TASK_ID = ctx.task
    if (ctx.ancestry?.mission) env.SHACKLEAI_MISSION = ctx.ancestry.mission
    if (ctx.ancestry?.project) env.SHACKLEAI_PROJECT = ctx.ancestry.project.name
    if (ctx.ancestry?.goal) env.SHACKLEAI_GOAL = ctx.ancestry.goal.name
    if (ctx.env.SHACKLEAI_API_KEY) env.SHACKLEAI_API_KEY = ctx.env.SHACKLEAI_API_KEY
    if (ctx.sessionState) env.SHACKLEAI_SESSION_STATE = ctx.sessionState
    return env
  }

  private clearActiveChild(child: ChildProcess): void {
    if (this.activeChild === child) this.activeChild = null
    if (this.abortKillTimer) { clearTimeout(this.abortKillTimer); this.abortKillTimer = null }
  }
}
