/**
 * ProcessAdapter — spawns a child process to execute an agent heartbeat.
 *
 * Reads `command` and `args` from adapterConfig, injects SHACKLEAI_* env vars,
 * captures stdout/stderr, and enforces a configurable timeout with graceful
 * SIGTERM → SIGKILL escalation.
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { WorktreeConfig } from '@shackleai/shared'
import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'
import { getSafeEnv } from './env.js'
import { gracefulKill, KILL_GRACE_MS } from './kill.js'

const IS_WIN = process.platform === 'win32'

/** Default timeout in milliseconds (300 seconds). */
const DEFAULT_TIMEOUT_MS = 300_000

export class ProcessAdapter implements AdapterModule {
  readonly type = 'process'
  readonly label = 'Child Process'

  private activeChild: ChildProcess | null = null
  private abortKillTimer: ReturnType<typeof setTimeout> | null = null

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const command = ctx.adapterConfig.command as string | undefined
    if (!command) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'adapterConfig.command is required for process adapter',
      }
    }

    const args = (ctx.adapterConfig.args as string[]) ?? []
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

    // Inject system context via env var or temp file (if > 8KB)
    let contextTmpFile: string | undefined
    if (ctx.systemContext) {
      const MAX_ENV_BYTES = 8 * 1024
      if (Buffer.byteLength(ctx.systemContext, 'utf-8') > MAX_ENV_BYTES) {
        contextTmpFile = join(tmpdir(), `shackleai-ctx-${randomUUID()}.md`)
        writeFileSync(contextTmpFile, ctx.systemContext, 'utf-8')
        env.SHACKLEAI_CONTEXT_FILE = contextTmpFile
      } else {
        env.SHACKLEAI_CONTEXT = ctx.systemContext
      }
    }

    // Worktree-aware execution: inject worktree env vars and set cwd
    const worktreeConfig = ctx.adapterConfig.worktree as
      | WorktreeConfig
      | undefined
    let cwd: string | undefined

    if (worktreeConfig?.enabled && ctx.env.SHACKLEAI_WORKTREE_PATH) {
      cwd = ctx.env.SHACKLEAI_WORKTREE_PATH
      env.SHACKLEAI_WORKTREE_PATH = ctx.env.SHACKLEAI_WORKTREE_PATH
      env.SHACKLEAI_BRANCH = ctx.env.SHACKLEAI_BRANCH ?? ''
      env.SHACKLEAI_BASE_BRANCH =
        ctx.env.SHACKLEAI_BASE_BRANCH ?? worktreeConfig.baseBranch ?? 'main'
    }

    return new Promise<AdapterResult>((resolve) => {
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let killed = false
      let killTimer: ReturnType<typeof setTimeout> | undefined

      const child = spawn(command, args, {
        env,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
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
        this.cleanupTmpFile(contextTmpFile)

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')

        resolve({
          exitCode: killed ? 124 : (code ?? 1),
          stdout,
          stderr: killed ? `Process killed after ${timeoutMs}ms timeout\n${stderr}` : stderr,
        })
      })

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        if (killTimer) clearTimeout(killTimer)
        this.cleanupTmpFile(contextTmpFile)

        resolve({
          exitCode: 127,
          stdout: '',
          stderr: `Failed to spawn process: ${err.message}`,
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
    // Basic check — Node.js can always spawn processes
    return { ok: true }
  }

  private cleanupTmpFile(filePath: string | undefined): void {
    if (!filePath) return
    try {
      unlinkSync(filePath)
    } catch {
      // Best-effort cleanup
    }
  }

  private clearActiveChild(child: ChildProcess): void {
    if (this.activeChild === child) this.activeChild = null
    if (this.abortKillTimer) { clearTimeout(this.abortKillTimer); this.abortKillTimer = null }
  }
}
