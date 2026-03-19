/**
 * CLI error handling — user-friendly error messages with optional verbose mode.
 *
 * Catches unhandled errors from command actions and displays clean,
 * categorized messages instead of raw stack traces.
 */

import pc from 'picocolors'

/** Whether --verbose was passed globally */
let verbose = false

export function setVerbose(v: boolean): void {
  verbose = v
}

export function isVerbose(): boolean {
  return verbose
}

/**
 * Categorize an error and return a user-friendly message + hint.
 */
function categorizeError(err: Error): { message: string; hint?: string } {
  const msg = err.message ?? String(err)
  const code = (err as NodeJS.ErrnoException).code

  // Network / connection errors
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED')
  ) {
    return {
      message: 'Could not connect to the orchestrator server.',
      hint: 'Is the server running? Start it with: shackleai start',
    }
  }

  if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT')) {
    return {
      message: 'Request timed out.',
      hint: 'The server may be overloaded. Try again in a moment.',
    }
  }

  // File / permission errors
  if (code === 'ENOENT') {
    return {
      message: `File or directory not found: ${(err as NodeJS.ErrnoException).path ?? 'unknown'}`,
      hint: 'Have you run `shackleai init` yet?',
    }
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return {
      message: 'Permission denied.',
      hint: 'Check file permissions or run with appropriate privileges.',
    }
  }

  // Database errors
  if (
    (msg.includes('relation') && msg.includes('does not exist')) ||
    (msg.includes('database') && msg.includes('does not exist'))
  ) {
    return {
      message: 'Database is not set up correctly.',
      hint: 'Run `shackleai init` to initialize the database.',
    }
  }

  if (msg.includes('unique') || msg.includes('duplicate key')) {
    return {
      message: 'A record with that value already exists.',
      hint: 'Use a different name or ID.',
    }
  }

  if (
    (msg.includes('ECONNREFUSED') && msg.includes('5432')) ||
    (msg.includes('connect ECONNREFUSED') && msg.includes('postgres'))
  ) {
    return {
      message: 'Could not connect to the database.',
      hint: 'Check that PostgreSQL is running and DATABASE_URL is correct.',
    }
  }

  // Validation errors (Zod or manual)
  if (msg.includes('ZodError') || msg.includes('Validation') || msg.includes('validation')) {
    return {
      message: 'Invalid input.',
      hint: msg,
    }
  }

  // Auth errors
  if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('unauthorized')) {
    return {
      message: 'Authentication failed.',
      hint: 'Check your credentials or run `shackleai init` again.',
    }
  }

  if (msg.includes('403') || msg.includes('Forbidden') || msg.includes('forbidden')) {
    return {
      message: 'Access denied.',
      hint: 'You do not have permission to perform this action.',
    }
  }

  // JSON parse errors
  if (msg.includes('JSON') && (msg.includes('parse') || msg.includes('Unexpected token'))) {
    return {
      message: 'Received an invalid response from the server.',
      hint: 'The server may be misconfigured or returning HTML instead of JSON.',
    }
  }

  // Fallback — show the error message without the stack trace
  return { message: msg }
}

/**
 * Format and print an error to stderr.
 * In verbose mode, the full stack trace is appended.
 */
export function handleError(err: unknown): never {
  const error = err instanceof Error ? err : new Error(String(err))
  const { message, hint } = categorizeError(error)

  console.error('')
  console.error(pc.red(`  Error: ${message}`))

  if (hint) {
    console.error(pc.yellow(`  Hint:  ${hint}`))
  }

  if (verbose && error.stack) {
    console.error('')
    console.error(pc.dim('  Stack trace:'))
    const stackLines = error.stack.split('\n').slice(1)
    for (const line of stackLines) {
      console.error(pc.dim(`  ${line.trim()}`))
    }
  }

  console.error('')
  process.exit(1)
}
