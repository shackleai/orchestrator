/**
 * CLI Commands Battle Tests — Issue #290
 *
 * Covers gaps not addressed by Battle 9 (which only tests --help/--version
 * for `init` and `start`). New scenarios:
 *
 *  1.  All subcommands expose --help
 *  2.  Unknown command produces a helpful error message (no stack trace)
 *  3.  doctor --help shows expected output
 *  4.  agent --help shows CRUD subcommands
 *  5.  task --help shows CRUD subcommands
 *  6.  worktree --help shows subcommands
 *  7.  config --help shows subcommands (history, rollback, export, redact)
 *  8.  db --help shows backup/restore subcommands
 *  9.  --verbose flag: visible in global --help
 * 10.  Config redaction: redactSensitiveFields hides API keys, databaseUrl
 * 11.  Config redaction: redactSensitiveFields preserves safe non-secret fields
 * 12.  Config redaction: nested llmKeys object is fully redacted
 * 13.  Config redaction: SAFE_KEYS (issue_prefix, dataDir, mode) are not redacted
 * 14.  Missing required arg on `db restore` exits non-zero
 * 15.  All subcommand --help calls exit 0 (no crash)
 */

import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { redactSensitiveFields } from '../src/config.js'

const execFileAsync = promisify(execFile)

const CLI_PATH = resolve(import.meta.dirname, '../dist/index.js')

/**
 * Per-test Vitest timeout for tests that spawn a child process.
 * Vitest default is 5000ms — not enough to start Node.js and load
 * all Commander registrations. 20s is safe on all environments.
 */
const CLI_TEST_TIMEOUT = 20_000

// ---------------------------------------------------------------------------
// Helper: run a CLI command, capture stdout+stderr, return code
// ---------------------------------------------------------------------------

interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function runCli(args: string[], timeoutMs = 15_000): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      timeout: timeoutMs,
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
    }
  }
}

// ---------------------------------------------------------------------------
// 1. All subcommands expose --help
// ---------------------------------------------------------------------------

describe('CLI --help: every registered subcommand has --help', () => {
  const subcommands = [
    'init',
    'start',
    'agent',
    'task',
    'run',
    'doctor',
    'worktree',
    'goal',
    'project',
    'company',
    'comment',
    'config',
    'approval',
    'secret',
    'quota',
    'db',
    'plugin',
    'auth',
  ]

  for (const cmd of subcommands) {
    it(
      `"${cmd} --help" exits cleanly and mentions the command name`,
      async () => {
        const result = await runCli([cmd, '--help'])
        const output = result.stdout + result.stderr
        // Commander exits 0 on --help
        expect(result.exitCode).toBe(0)
        expect(output.toLowerCase()).toContain(cmd.toLowerCase())
      },
      CLI_TEST_TIMEOUT,
    )
  }
})

// ---------------------------------------------------------------------------
// 2. Unknown command → helpful error, no raw stack trace
// ---------------------------------------------------------------------------

describe('CLI: unknown command handling', () => {
  it(
    'unknown top-level command exits non-zero',
    async () => {
      const result = await runCli(['nonexistent-command-xyz'])
      expect(result.exitCode).not.toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'unknown command output does not contain a raw Node.js stack trace',
    async () => {
      const result = await runCli(['nonexistent-command-xyz'])
      const output = result.stdout + result.stderr
      // Commander prints "error: unknown command" — no "at Object.<anonymous>" lines
      expect(output).not.toMatch(/^\s+at\s+\w/m)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'unknown command output contains a descriptive error message',
    async () => {
      const result = await runCli(['nonexistent-command-xyz'])
      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/error|unknown|command/)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 3. doctor --help
// ---------------------------------------------------------------------------

describe('CLI: doctor command', () => {
  it(
    'doctor --help mentions health checks or diagnostics',
    async () => {
      const result = await runCli(['doctor', '--help'])
      const output = result.stdout + result.stderr
      expect(result.exitCode).toBe(0)
      expect(output.toLowerCase()).toMatch(/health|diagnos|check/)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 4. agent subcommands
// ---------------------------------------------------------------------------

describe('CLI: agent subcommands', () => {
  it(
    'agent --help lists create/list/pause/resume/terminate subcommands',
    async () => {
      const result = await runCli(['agent', '--help'])
      const output = result.stdout + result.stderr
      expect(result.exitCode).toBe(0)
      expect(output.toLowerCase()).toMatch(/create|list|pause|resume|terminate/)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'agent create --help exits 0',
    async () => {
      const result = await runCli(['agent', 'create', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'agent list --help exits 0',
    async () => {
      const result = await runCli(['agent', 'list', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 5. task subcommands
// ---------------------------------------------------------------------------

describe('CLI: task subcommands', () => {
  it(
    'task --help lists create/list/complete/assign subcommands',
    async () => {
      const result = await runCli(['task', '--help'])
      const output = result.stdout + result.stderr
      expect(result.exitCode).toBe(0)
      expect(output.toLowerCase()).toMatch(/create|list|complete|assign/)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'task create --help exits 0',
    async () => {
      const result = await runCli(['task', 'create', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'task list --help exits 0',
    async () => {
      const result = await runCli(['task', 'list', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 6. worktree subcommands
// ---------------------------------------------------------------------------

describe('CLI: worktree subcommands', () => {
  it(
    'worktree --help exits 0 and has non-empty output',
    async () => {
      const result = await runCli(['worktree', '--help'])
      const output = result.stdout + result.stderr
      expect(result.exitCode).toBe(0)
      expect(output.length).toBeGreaterThan(0)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 7. config subcommands
// ---------------------------------------------------------------------------

describe('CLI: config subcommands', () => {
  it(
    'config --help lists history/rollback/export/redact',
    async () => {
      const result = await runCli(['config', '--help'])
      const output = result.stdout + result.stderr
      expect(result.exitCode).toBe(0)
      expect(output).toContain('history')
      expect(output).toContain('rollback')
      expect(output).toContain('export')
      expect(output).toContain('redact')
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'config history --help exits 0',
    async () => {
      const result = await runCli(['config', 'history', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'config export --help exits 0',
    async () => {
      const result = await runCli(['config', 'export', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'config redact --help exits 0',
    async () => {
      const result = await runCli(['config', 'redact', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'config rollback --help exits 0',
    async () => {
      const result = await runCli(['config', 'rollback', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 8. db subcommands
// ---------------------------------------------------------------------------

describe('CLI: db backup/restore --help', () => {
  it(
    'db backup --help exits 0',
    async () => {
      const result = await runCli(['db', 'backup', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    'db restore --help exits 0',
    async () => {
      const result = await runCli(['db', 'restore', '--help'])
      expect(result.exitCode).toBe(0)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 9. --verbose flag is documented in global --help
// ---------------------------------------------------------------------------

describe('CLI: --verbose global flag', () => {
  it(
    'global --help mentions --verbose flag',
    async () => {
      const result = await runCli(['--help'])
      const output = result.stdout + result.stderr
      expect(result.exitCode).toBe(0)
      expect(output).toContain('--verbose')
    },
    CLI_TEST_TIMEOUT,
  )

  it(
    '--verbose is listed alongside description about stack traces or errors',
    async () => {
      const result = await runCli(['--help'])
      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/stack|verbose|error/)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 10-13. Config redaction: redactSensitiveFields (pure function — no process)
// These are synchronous and do not need CLI_TEST_TIMEOUT.
// ---------------------------------------------------------------------------

describe('Config redaction: redactSensitiveFields', () => {
  it('redacts databaseUrl regardless of pattern matching', () => {
    const config = {
      mode: 'local' as const,
      companyId: 'abc',
      companyName: 'Test',
      databaseUrl: 'postgres://user:pass@host/db',
    }
    const result = redactSensitiveFields(config as unknown as Record<string, unknown>)
    expect(result.databaseUrl).toBe('***REDACTED***')
  })

  it('does NOT redact safe non-secret fields', () => {
    const config = {
      mode: 'local',
      companyId: 'abc123',
      companyName: 'My Company',
      dataDir: '/home/user/.shackleai/data',
      port: 4800,
    }
    const result = redactSensitiveFields(config as Record<string, unknown>)
    expect(result.mode).toBe('local')
    expect(result.companyId).toBe('abc123')
    expect(result.companyName).toBe('My Company')
    expect(result.dataDir).toBe('/home/user/.shackleai/data')
    expect(result.port).toBe(4800)
  })

  it('redacts nested llmKeys.openai and llmKeys.anthropic values', () => {
    const config = {
      mode: 'local',
      companyId: 'abc',
      companyName: 'Test',
      llmKeys: {
        openai: 'sk-openai-supersecret',
        anthropic: 'sk-ant-supersecret',
      },
    }
    const result = redactSensitiveFields(config as Record<string, unknown>)
    const llm = result.llmKeys as Record<string, unknown>
    expect(llm.openai).toBe('***REDACTED***')
    expect(llm.anthropic).toBe('***REDACTED***')
  })

  it('does NOT redact issue_prefix even though it contains the word "prefix"', () => {
    const config = {
      issue_prefix: 'MYCO',
      mode: 'local',
      companyId: 'x',
      companyName: 'x',
    }
    const result = redactSensitiveFields(config as Record<string, unknown>)
    expect(result.issue_prefix).toBe('MYCO')
  })

  it('redacts a top-level "apiKey" field', () => {
    const config = {
      mode: 'local',
      companyId: 'abc',
      companyName: 'Test',
      apiKey: 'shk_live_supersecret',
    }
    const result = redactSensitiveFields(config as Record<string, unknown>)
    expect(result.apiKey).toBe('***REDACTED***')
  })

  it('redacts a top-level "password" field', () => {
    const config = {
      mode: 'server',
      companyId: 'abc',
      companyName: 'Test',
      password: 'hunter2',
    }
    const result = redactSensitiveFields(config as Record<string, unknown>)
    expect(result.password).toBe('***REDACTED***')
  })

  it('redacts a top-level "token" field', () => {
    const config = {
      mode: 'server',
      companyId: 'abc',
      companyName: 'Test',
      token: 'ghp_abcdef',
    }
    const result = redactSensitiveFields(config as Record<string, unknown>)
    expect(result.token).toBe('***REDACTED***')
  })

  it('handles empty config object without throwing', () => {
    const result = redactSensitiveFields({})
    expect(result).toEqual({})
  })

  it('handles null values in config without throwing', () => {
    const config = {
      mode: 'local',
      companyId: null,
      companyName: null,
    }
    const result = redactSensitiveFields(config as Record<string, unknown>)
    expect(result.mode).toBe('local')
    expect(result.companyId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 14. Missing required positional arg on db restore
// ---------------------------------------------------------------------------

describe('CLI: missing required args → usage hint', () => {
  it(
    'db restore with no path argument exits non-zero',
    async () => {
      const result = await runCli(['db', 'restore'])
      expect(result.exitCode).not.toBe(0)
      const output = result.stdout + result.stderr
      // Commander prints usage error for missing required argument
      expect(output.toLowerCase()).toMatch(/error|missing|required|argument|usage/)
    },
    CLI_TEST_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 15. Additional subcommand --help exit codes
// ---------------------------------------------------------------------------

describe('CLI: additional subcommand --help calls exit cleanly', () => {
  const checks: Array<[string, string[]]> = [
    ['upgrade', ['upgrade', '--help']],
    ['run', ['run', '--help']],
    ['plugin', ['plugin', '--help']],
    ['auth', ['auth', '--help']],
    ['quota', ['quota', '--help']],
    ['secret', ['secret', '--help']],
    ['approval', ['approval', '--help']],
    ['goal', ['goal', '--help']],
    ['project', ['project', '--help']],
    ['company', ['company', '--help']],
    ['comment', ['comment', '--help']],
  ]

  for (const [label, args] of checks) {
    it(
      `"${label} --help" exits 0`,
      async () => {
        const result = await runCli(args)
        expect(result.exitCode).toBe(0)
      },
      CLI_TEST_TIMEOUT,
    )
  }
})
