/**
 * Tests for CLI error handling (src/errors.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('CLI error handler', () => {
  let handleError: typeof import('../src/errors.js').handleError
  let setVerbose: typeof import('../src/errors.js').setVerbose

  const mockExit = vi.fn<(code?: number) => never>()
  const mockError = vi.fn()

  beforeEach(async () => {
    vi.stubGlobal('process', {
      ...process,
      exit: mockExit,
    })
    vi.spyOn(console, 'error').mockImplementation(mockError)

    // Fresh import each test to reset verbose state
    vi.resetModules()
    const mod = await import('../src/errors.js')
    handleError = mod.handleError
    setVerbose = mod.setVerbose
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows user-friendly message for ECONNREFUSED', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:4800') as NodeJS.ErrnoException
    err.code = 'ECONNREFUSED'

    handleError(err)

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Could not connect to the orchestrator server')
    expect(output).toContain('shackleai start')
  })

  it('shows user-friendly message for ENOENT', () => {
    const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    err.path = '/home/user/.shackleai/config.json'

    handleError(err)

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('File or directory not found')
    expect(output).toContain('shackleai init')
  })

  it('shows user-friendly message for database relation errors', () => {
    const err = new Error('relation "companies" does not exist')

    handleError(err)

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Database is not set up correctly')
    expect(output).toContain('shackleai init')
  })

  it('shows user-friendly message for duplicate key errors', () => {
    const err = new Error('duplicate key value violates unique constraint')

    handleError(err)

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('already exists')
  })

  it('shows user-friendly message for auth errors', () => {
    const err = new Error('401 Unauthorized')

    handleError(err)

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Authentication failed')
  })

  it('falls back to error message for unknown errors', () => {
    const err = new Error('Something totally unexpected happened')

    handleError(err)

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Something totally unexpected happened')
  })

  it('shows stack trace in verbose mode', () => {
    setVerbose(true)
    const err = new Error('test error')

    handleError(err)

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Stack trace')
  })

  it('hides stack trace by default', () => {
    const err = new Error('test error')

    handleError(err)

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).not.toContain('Stack trace')
  })

  it('handles non-Error values gracefully', () => {
    handleError('string error')

    const output = mockError.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('string error')
  })

  it('calls process.exit(1)', () => {
    handleError(new Error('fail'))
    expect(mockExit).toHaveBeenCalledWith(1)
  })
})
