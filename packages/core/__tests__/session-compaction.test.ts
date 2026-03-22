/**
 * Session compaction test (#261)
 *
 * Tests the compactSession() function that truncates oversized session state.
 */

import { describe, it, expect } from 'vitest'
import { compactSession } from '../src/adapters/session.js'

describe('compactSession (#261)', () => {
  it('returns null for null input', () => {
    expect(compactSession(null)).toBeNull()
  })

  it('returns session unchanged when under the limit', () => {
    const small = JSON.stringify({ messages: ['hello'] })
    expect(compactSession(small, 100_000)).toBe(small)
  })

  it('truncates a large top-level array', () => {
    // Create a large array that exceeds a small token limit
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message number ${i}: ${'x'.repeat(200)}`,
    }))
    const large = JSON.stringify(messages)

    // Use a small limit (e.g., 500 tokens = ~2000 chars)
    const compacted = compactSession(large, 500)
    expect(compacted).not.toBeNull()

    const parsed = JSON.parse(compacted!) as unknown[]
    // Should have fewer messages than the original
    expect(parsed.length).toBeLessThan(messages.length)
    expect(parsed.length).toBeGreaterThan(0)

    // Should keep the most recent messages (last entries)
    const lastOriginal = messages[messages.length - 1]
    const lastCompacted = parsed[parsed.length - 1] as Record<string, unknown>
    expect(lastCompacted.content).toBe(lastOriginal.content)
  })

  it('truncates an object with messages array', () => {
    const session = {
      version: 1,
      agentId: 'test-agent',
      messages: Array.from({ length: 50 }, (_, i) => ({
        role: 'user',
        content: `Entry ${i}: ${'y'.repeat(300)}`,
      })),
    }
    const large = JSON.stringify(session)

    const compacted = compactSession(large, 500)
    expect(compacted).not.toBeNull()

    const parsed = JSON.parse(compacted!) as {
      version: number
      agentId: string
      messages: unknown[]
    }
    // Metadata should be preserved
    expect(parsed.version).toBe(1)
    expect(parsed.agentId).toBe('test-agent')
    // Messages should be trimmed
    expect(parsed.messages.length).toBeLessThan(session.messages.length)
    expect(parsed.messages.length).toBeGreaterThan(0)
  })

  it('truncates raw string from the front when not valid JSON', () => {
    // Create a large non-JSON string
    const large = 'a'.repeat(10_000)

    // Limit to 500 tokens = 2000 chars
    const compacted = compactSession(large, 500)
    expect(compacted).not.toBeNull()
    expect(compacted!.length).toBeLessThanOrEqual(2000)
    // Should keep the tail (most recent content)
    expect(compacted!.endsWith('aaa')).toBe(true)
  })

  it('respects custom context_limit', () => {
    const messages = Array.from({ length: 20 }, (_, i) => `msg-${i}-${'z'.repeat(100)}`)
    const large = JSON.stringify(messages)

    // Very tight limit
    const compacted = compactSession(large, 100)
    expect(compacted).not.toBeNull()

    const parsed = JSON.parse(compacted!) as string[]
    expect(parsed.length).toBeLessThan(20)
  })

  it('keeps at least one entry when array is huge', () => {
    const messages = [{ content: 'x'.repeat(10_000) }]
    const large = JSON.stringify(messages)

    // Even with a tiny limit, we keep at least 1 element
    const compacted = compactSession(large, 1)
    expect(compacted).not.toBeNull()

    const parsed = JSON.parse(compacted!) as unknown[]
    expect(parsed.length).toBe(1)
  })
})
