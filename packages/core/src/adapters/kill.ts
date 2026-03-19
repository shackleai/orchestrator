/**
 * Cross-platform process tree kill utility.
 */

import type { ChildProcess } from 'node:child_process'
import { execSync } from 'node:child_process'

const IS_WIN = process.platform === 'win32'

export const KILL_GRACE_MS = 5_000

export function killProcessTree(
  child: ChildProcess,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
): void {
  const pid = child.pid
  if (pid === undefined) return

  if (IS_WIN) {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', timeout: 5_000 })
    } catch {
      try { child.kill(signal) } catch { /* already dead */ }
    }
  } else {
    try {
      process.kill(-pid, signal)
    } catch {
      try { child.kill(signal) } catch { /* already dead */ }
    }
  }
}

export function gracefulKill(
  child: ChildProcess,
  graceMs: number = KILL_GRACE_MS,
): ReturnType<typeof setTimeout> {
  killProcessTree(child, 'SIGTERM')
  return setTimeout(() => {
    killProcessTree(child, 'SIGKILL')
  }, graceMs)
}
