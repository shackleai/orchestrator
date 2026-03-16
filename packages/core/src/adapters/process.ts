/**
 * ProcessAdapter — spawns a child process to execute an agent heartbeat.
 *
 * Reads `command` and `args` from adapterConfig, injects SHACKLEAI_* env vars,
 * captures stdout/stderr, and enforces a configurable timeout with graceful
 * SIGTERM → SIGKILL escalation.
 */

import { spawn } from 'node:child_process'
import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'

/** Default timeout in milliseconds (300 seconds). */
const DEFAULT_TIMEOUT_MS = 300_000

/** Grace period between SIGTERM and SIGKILL in milliseconds. */
const KILL_GRACE_MS = 5_000

export class ProcessAdapter implements AdapterModule {
  readonly type = 'process'
  readonly label = 'Child Process'

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

    const env: Record<string, string> = {
      ...process.env,
      ...ctx.env,
      SHACKLEAI_RUN_ID: ctx.heartbeatRunId,
      SHACKLEAI_AGENT_ID: ctx.agentId,
    }

    if (ctx.task) {
      env.SHACKLEAI_TASK_ID = ctx.task
    }

    if (ctx.env.SHACKLEAI_API_KEY) {
      env.SHACKLEAI_API_KEY = ctx.env.SHACKLEAI_API_KEY
    }

    if (ctx.sessionState) {
      env.SHACKLEAI_SESSION_STATE = ctx.sessionState
    }

    return new Promise<AdapterResult>((resolve) => {
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let killed = false
      let killTimer: ReturnType<typeof setTimeout> | undefined

      const child = spawn(command, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
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

        resolve({
          exitCode: 127,
          stdout: '',
          stderr: `Failed to spawn process: ${err.message}`,
        })
      })
    })
  }

  async testEnvironment(): Promise<{ ok: boolean; error?: string }> {
    // Basic check — Node.js can always spawn processes
    return { ok: true }
  }
}
