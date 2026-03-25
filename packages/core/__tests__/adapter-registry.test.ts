import { describe, it, expect } from 'vitest'
import { AdapterRegistry } from '../src/adapters/index.js'
import { ProcessAdapter } from '../src/adapters/process.js'
import { HttpAdapter } from '../src/adapters/http.js'
import { ClaudeAdapter } from '../src/adapters/claude.js'
import { McpAdapter } from '../src/adapters/mcp.js'
import type { AdapterModule } from '../src/adapters/adapter.js'

describe('AdapterRegistry', () => {
  it('pre-registers all built-in adapters on construction', () => {
    const registry = new AdapterRegistry()

    expect(registry.has('process')).toBe(true)
    expect(registry.has('http')).toBe(true)
    expect(registry.has('claude')).toBe(true)
    expect(registry.has('mcp')).toBe(true)
    expect(registry.has('openclaw')).toBe(true)
    expect(registry.has('crewai')).toBe(true)
    expect(registry.has('codex')).toBe(true)
    expect(registry.has('cursor')).toBe(true)
    expect(registry.has('gemini')).toBe(true)
    expect(registry.has('kiro')).toBe(true)
    expect(registry.has('llm')).toBe(true)

    expect(registry.get('process')).toBeInstanceOf(ProcessAdapter)
    expect(registry.get('http')).toBeInstanceOf(HttpAdapter)
    expect(registry.get('claude')).toBeInstanceOf(ClaudeAdapter)
    expect(registry.get('mcp')).toBeInstanceOf(McpAdapter)
  })

  it('returns undefined for unregistered type', () => {
    const registry = new AdapterRegistry()
    expect(registry.get('nonexistent')).toBeUndefined()
    expect(registry.has('nonexistent')).toBe(false)
  })

  it('registers a custom adapter', () => {
    const registry = new AdapterRegistry()

    const mockAdapter: AdapterModule = {
      type: 'mock',
      label: 'Mock Adapter',
      async execute() {
        return { exitCode: 0, stdout: 'mock', stderr: '' }
      },
    }

    registry.register(mockAdapter)
    expect(registry.has('mock')).toBe(true)
    expect(registry.get('mock')).toBe(mockAdapter)
  })

  it('overwrites existing adapter on re-register', () => {
    const registry = new AdapterRegistry()

    const customProcess: AdapterModule = {
      type: 'process',
      label: 'Custom Process',
      async execute() {
        return { exitCode: 0, stdout: 'custom', stderr: '' }
      },
    }

    registry.register(customProcess)
    expect(registry.get('process')?.label).toBe('Custom Process')
  })

  it('lists all registered adapters', () => {
    const registry = new AdapterRegistry()

    const mockAdapter: AdapterModule = {
      type: 'custom',
      label: 'Custom Adapter',
      async execute() {
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }

    registry.register(mockAdapter)

    const all = registry.list()
    expect(all).toHaveLength(13) // 12 built-in + 1 custom
    expect(all.map((a) => a.type).sort()).toEqual([
      'claude',
      'codex',
      'crewai',
      'cursor',
      'custom',
      'gemini',
      'http',
      'kiro',
      'llm',
      'mcp',
      'openclaw',
      'opencode',
      'process',
    ])
  })
})
