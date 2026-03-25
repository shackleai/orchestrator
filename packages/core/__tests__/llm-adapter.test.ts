import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LlmAdapter } from '../src/adapters/llm.js'
import type { AdapterContext } from '../src/adapters/adapter.js'

/** Helper to create a minimal AdapterContext. */
function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    agentId: 'agent-001',
    companyId: 'company-001',
    heartbeatRunId: 'run-001',
    adapterConfig: {},
    env: {},
    ...overrides,
  }
}

/** Mock fetch globally. */
function mockFetch(response: {
  ok?: boolean
  status?: number
  statusText?: string
  body: unknown
}): void {
  const { ok = true, status = 200, statusText = 'OK', body } = response
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    }),
  )
}

describe('LlmAdapter', () => {
  let adapter: LlmAdapter

  beforeEach(() => {
    adapter = new LlmAdapter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has correct type and label', () => {
    expect(adapter.type).toBe('llm')
    expect(adapter.label).toBe('LLM API (Provider-Agnostic)')
  })

  // -----------------------------------------------------------------------
  // Validation errors
  // -----------------------------------------------------------------------

  it('returns error when provider is missing', async () => {
    const ctx = makeCtx({ adapterConfig: { model: 'gpt-4o' } })
    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.provider')
  })

  it('returns error when model is missing', async () => {
    const ctx = makeCtx({ adapterConfig: { provider: 'openai' } })
    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.provider')
  })

  it('returns error for unsupported provider', async () => {
    const ctx = makeCtx({
      adapterConfig: { provider: 'not-a-provider', model: 'test' },
    })
    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.provider')
  })

  it('returns error when API key is not set', async () => {
    const ctx = makeCtx({
      adapterConfig: { provider: 'openai', model: 'gpt-4o' },
      env: {},
    })
    // Ensure process.env doesn't have it either
    const original = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const result = await adapter.execute(ctx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('OPENAI_API_KEY')
    } finally {
      if (original !== undefined) process.env.OPENAI_API_KEY = original
    }
  })

  it('uses custom api_key_env', async () => {
    mockFetch({
      body: {
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: 'gpt-4o',
      },
    })

    const ctx = makeCtx({
      adapterConfig: {
        provider: 'openai',
        model: 'gpt-4o',
        api_key_env: 'MY_CUSTOM_KEY',
      },
      env: { MY_CUSTOM_KEY: 'sk-custom-key' },
      task: 'Do something',
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello')
  })

  // -----------------------------------------------------------------------
  // OpenAI provider
  // -----------------------------------------------------------------------

  describe('OpenAI provider', () => {
    it('sends correct request and parses response', async () => {
      mockFetch({
        body: {
          choices: [{ message: { content: 'The answer is 42.' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'gpt-4o',
        },
      })

      const ctx = makeCtx({
        adapterConfig: {
          provider: 'openai',
          model: 'gpt-4o',
          temperature: 0.7,
          max_tokens: 2048,
        },
        env: { OPENAI_API_KEY: 'sk-test-key' },
        task: 'Calculate 6 * 7',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('The answer is 42.')
      expect(result.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        costCents: expect.any(Number),
        model: 'gpt-4o',
        provider: 'openai',
      })

      // Verify fetch was called with correct URL and headers
      const fetchMock = vi.mocked(fetch)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.openai.com/v1/chat/completions')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk-test-key')

      // Verify body
      const body = JSON.parse(init?.body as string) as Record<string, unknown>
      expect(body.model).toBe('gpt-4o')
      expect(body.temperature).toBe(0.7)
      expect(body.max_tokens).toBe(2048)
      const messages = body.messages as Array<Record<string, string>>
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('system')
      expect(messages[1].role).toBe('user')
    })

    it('parses tool calls', async () => {
      mockFetch({
        body: {
          choices: [
            {
              message: {
                content: 'I will look that up.',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search',
                      arguments: '{"query":"weather today"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20 },
          model: 'gpt-4o',
        },
      })

      const ctx = makeCtx({
        adapterConfig: {
          provider: 'openai',
          model: 'gpt-4o',
          tools: [
            {
              name: 'search',
              description: 'Search the web',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          ],
        },
        env: { OPENAI_API_KEY: 'sk-test-key' },
        task: 'Search for weather',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('I will look that up.')
      expect(result.stdout).toContain('--- Tool Calls ---')
      expect(result.stdout).toContain('[search]')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls![0].toolName).toBe('search')
      expect(result.toolCalls![0].toolInput).toEqual({ query: 'weather today' })
    })
  })

  // -----------------------------------------------------------------------
  // Anthropic provider
  // -----------------------------------------------------------------------

  describe('Anthropic provider', () => {
    it('sends correct request and parses response', async () => {
      mockFetch({
        body: {
          content: [{ type: 'text', text: 'Claude says hello.' }],
          usage: { input_tokens: 80, output_tokens: 30 },
          model: 'claude-sonnet-4-20250514',
        },
      })

      const ctx = makeCtx({
        adapterConfig: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        },
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        task: 'Greet me',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Claude says hello.')
      expect(result.usage?.provider).toBe('anthropic')
      expect(result.usage?.inputTokens).toBe(80)
      expect(result.usage?.outputTokens).toBe(30)

      // Verify Anthropic-specific headers
      const fetchMock = vi.mocked(fetch)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      const headers = init?.headers as Record<string, string>
      expect(headers['x-api-key']).toBe('sk-ant-test')
      expect(headers['anthropic-version']).toBe('2023-06-01')

      // Verify body uses Anthropic format
      const body = JSON.parse(init?.body as string) as Record<string, unknown>
      expect(body.system).toBeDefined()
      expect(body.messages).toHaveLength(1)
    })

    it('parses tool_use blocks', async () => {
      mockFetch({
        body: {
          content: [
            { type: 'text', text: 'Let me search.' },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'web_search',
              input: { query: 'test' },
            },
          ],
          usage: { input_tokens: 40, output_tokens: 20 },
          model: 'claude-sonnet-4-20250514',
        },
      })

      const ctx = makeCtx({
        adapterConfig: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          tools: [
            {
              name: 'web_search',
              description: 'Search the web',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          ],
        },
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        task: 'Search',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(0)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls![0].toolName).toBe('web_search')
      expect(result.toolCalls![0].toolInput).toEqual({ query: 'test' })
    })
  })

  // -----------------------------------------------------------------------
  // Gemini provider
  // -----------------------------------------------------------------------

  describe('Gemini provider', () => {
    it('sends correct request and parses response', async () => {
      mockFetch({
        body: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Gemini response here.' }],
                role: 'model',
              },
            },
          ],
          usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 25 },
        },
      })

      const ctx = makeCtx({
        adapterConfig: {
          provider: 'gemini',
          model: 'gemini-2.0-flash',
        },
        env: { GEMINI_API_KEY: 'gem-test-key' },
        task: 'Summarize this',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Gemini response here.')
      expect(result.usage?.provider).toBe('gemini')
      expect(result.usage?.inputTokens).toBe(60)
      expect(result.usage?.outputTokens).toBe(25)

      // Verify Gemini URL format with API key in query param
      const fetchMock = vi.mocked(fetch)
      const [url] = fetchMock.mock.calls[0]
      expect(url).toContain('generativelanguage.googleapis.com')
      expect(url).toContain('gemini-2.0-flash')
      expect(url).toContain('key=gem-test-key')
    })

    it('parses functionCall parts', async () => {
      mockFetch({
        body: {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Calling function.' },
                  {
                    functionCall: {
                      name: 'get_weather',
                      args: { location: 'London' },
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
          usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 15 },
        },
      })

      const ctx = makeCtx({
        adapterConfig: {
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          tools: [
            {
              name: 'get_weather',
              description: 'Get weather',
              parameters: { type: 'object', properties: { location: { type: 'string' } } },
            },
          ],
        },
        env: { GEMINI_API_KEY: 'gem-test-key' },
        task: 'Get weather',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(0)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls![0].toolName).toBe('get_weather')
      expect(result.toolCalls![0].toolInput).toEqual({ location: 'London' })
    })
  })

  // -----------------------------------------------------------------------
  // DeepSeek provider (OpenAI-compatible)
  // -----------------------------------------------------------------------

  describe('DeepSeek provider', () => {
    it('sends to DeepSeek endpoint with OpenAI format', async () => {
      mockFetch({
        body: {
          choices: [{ message: { content: 'DeepSeek response.' } }],
          usage: { prompt_tokens: 40, completion_tokens: 15 },
          model: 'deepseek-chat',
        },
      })

      const ctx = makeCtx({
        adapterConfig: {
          provider: 'deepseek',
          model: 'deepseek-chat',
        },
        env: { DEEPSEEK_API_KEY: 'ds-test-key' },
        task: 'Hello from DeepSeek',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('DeepSeek response.')
      expect(result.usage?.provider).toBe('deepseek')

      const fetchMock = vi.mocked(fetch)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer ds-test-key')
    })
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('handles HTTP error responses', async () => {
      mockFetch({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        body: '{"error": "rate_limit_exceeded"}',
      })

      const ctx = makeCtx({
        adapterConfig: { provider: 'openai', model: 'gpt-4o' },
        env: { OPENAI_API_KEY: 'sk-test' },
        task: 'Test',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('HTTP 429')
      expect(result.stderr).toContain('rate_limit_exceeded')
    })

    it('handles network errors', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      )

      const ctx = makeCtx({
        adapterConfig: { provider: 'openai', model: 'gpt-4o' },
        env: { OPENAI_API_KEY: 'sk-test' },
        task: 'Test',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ECONNREFUSED')
    })

    it('handles timeout (abort)', async () => {
      // Create a fetch that never resolves until aborted
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          return new Promise((_resolve, reject) => {
            const signal = init.signal as AbortSignal
            if (signal) {
              signal.addEventListener('abort', () => {
                const err = new DOMException('The operation was aborted.', 'AbortError')
                reject(err)
              })
            }
          })
        }),
      )

      const ctx = makeCtx({
        adapterConfig: {
          provider: 'openai',
          model: 'gpt-4o',
          timeout: 0.1, // 100ms timeout
        },
        env: { OPENAI_API_KEY: 'sk-test' },
        task: 'Test',
      })

      const result = await adapter.execute(ctx)

      expect(result.exitCode).toBe(124)
      expect(result.stderr).toContain('timed out')
    })
  })

  // -----------------------------------------------------------------------
  // Token usage / cost estimation
  // -----------------------------------------------------------------------

  describe('cost estimation', () => {
    it('calculates cost for known models', async () => {
      mockFetch({
        body: {
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
          model: 'gpt-4o',
        },
      })

      const ctx = makeCtx({
        adapterConfig: { provider: 'openai', model: 'gpt-4o' },
        env: { OPENAI_API_KEY: 'sk-test' },
        task: 'Test',
      })

      const result = await adapter.execute(ctx)

      // gpt-4o: input=0.25c/1K, output=1.0c/1K
      // 1000 input tokens = 0.25c, 500 output tokens = 0.5c => 0.75c
      expect(result.usage?.costCents).toBeCloseTo(0.75, 2)
    })

    it('returns 0 cost for unknown models', async () => {
      mockFetch({
        body: {
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'some-custom-model',
        },
      })

      const ctx = makeCtx({
        adapterConfig: { provider: 'openai', model: 'some-custom-model' },
        env: { OPENAI_API_KEY: 'sk-test' },
        task: 'Test',
      })

      const result = await adapter.execute(ctx)
      expect(result.usage?.costCents).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // testEnvironment
  // -----------------------------------------------------------------------

  describe('testEnvironment', () => {
    it('returns ok:true when an API key is available', async () => {
      const original = process.env.OPENAI_API_KEY
      process.env.OPENAI_API_KEY = 'sk-test'
      try {
        const result = await adapter.testEnvironment()
        expect(result.ok).toBe(true)
      } finally {
        if (original !== undefined) process.env.OPENAI_API_KEY = original
        else delete process.env.OPENAI_API_KEY
      }
    })

    it('returns ok:false when no API keys are available', async () => {
      const keys = [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'GEMINI_API_KEY',
        'DEEPSEEK_API_KEY',
      ]
      const originals: Record<string, string | undefined> = {}
      for (const k of keys) {
        originals[k] = process.env[k]
        delete process.env[k]
      }
      try {
        const result = await adapter.testEnvironment()
        expect(result.ok).toBe(false)
        expect(result.error).toContain('No LLM API key found')
      } finally {
        for (const k of keys) {
          if (originals[k] !== undefined) process.env[k] = originals[k]
        }
      }
    })
  })

  // -----------------------------------------------------------------------
  // AdapterRegistry integration
  // -----------------------------------------------------------------------

  describe('AdapterRegistry integration', () => {
    it('is registered in AdapterRegistry', async () => {
      const { AdapterRegistry } = await import('../src/adapters/index.js')
      const registry = new AdapterRegistry()
      expect(registry.has('llm')).toBe(true)
      const llm = registry.get('llm')
      expect(llm?.label).toBe('LLM API (Provider-Agnostic)')
    })
  })
})
