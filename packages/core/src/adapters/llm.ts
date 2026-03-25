/**
 * LlmAdapter — Provider-Agnostic Agent Brain.
 *
 * Makes direct HTTP calls to LLM provider APIs (OpenAI, Anthropic, Gemini,
 * DeepSeek) to execute agent heartbeats. No CLI dependency — just an API key.
 *
 * Reads `provider`, `model`, `api_key_env`, `temperature`, `max_tokens`,
 * and `tools` from adapterConfig. Builds a prompt from systemContext +
 * ancestry + task description, sends it to the provider, and returns the
 * assistant response (including any tool call requests).
 *
 * Uses Node.js native fetch (available in Node 18+).
 */

import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'
import { buildFullPrompt } from './util.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LlmProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek'

interface LlmTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface LlmAdapterConfig {
  provider: LlmProvider
  model: string
  api_key_env?: string
  temperature?: number
  max_tokens?: number
  tools?: LlmTool[]
  timeout?: number
}

/** Default API key env var per provider. */
const DEFAULT_KEY_ENV: Record<LlmProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}

/** Default max_tokens per provider (provider-specific sensible defaults). */
const DEFAULT_MAX_TOKENS = 4096

/** Default timeout in seconds. */
const DEFAULT_TIMEOUT_S = 300

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

interface ProviderResponse {
  content: string
  toolCalls: Array<{
    toolName: string
    toolInput?: Record<string, unknown>
  }>
  inputTokens: number
  outputTokens: number
  model: string
}

/**
 * Build request config and parse response for OpenAI-compatible APIs
 * (OpenAI, DeepSeek).
 */
function buildOpenAIRequest(
  endpoint: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  config: LlmAdapterConfig,
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }

  if (config.temperature !== undefined) body.temperature = config.temperature
  if (config.max_tokens !== undefined) body.max_tokens = config.max_tokens
  else body.max_tokens = DEFAULT_MAX_TOKENS

  if (config.tools && config.tools.length > 0) {
    body.tools = config.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  return {
    url: endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  }
}

function parseOpenAIResponse(json: Record<string, unknown>): ProviderResponse {
  const choices = json.choices as Array<Record<string, unknown>> | undefined
  const choice = choices?.[0]
  const message = choice?.message as Record<string, unknown> | undefined

  const content = (message?.content as string) ?? ''
  const toolCalls: ProviderResponse['toolCalls'] = []

  const rawToolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined
  if (rawToolCalls) {
    for (const tc of rawToolCalls) {
      const fn = tc.function as Record<string, unknown> | undefined
      if (!fn) continue
      let args: Record<string, unknown> | undefined
      try {
        args = JSON.parse((fn.arguments as string) ?? '{}') as Record<string, unknown>
      } catch {
        args = undefined
      }
      toolCalls.push({
        toolName: (fn.name as string) ?? 'unknown',
        toolInput: args,
      })
    }
  }

  const usage = json.usage as Record<string, unknown> | undefined
  return {
    content,
    toolCalls,
    inputTokens: (usage?.prompt_tokens as number) ?? 0,
    outputTokens: (usage?.completion_tokens as number) ?? 0,
    model: (json.model as string) ?? 'unknown',
  }
}

/**
 * Build request config for Anthropic Messages API.
 */
function buildAnthropicRequest(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  config: LlmAdapterConfig,
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: config.max_tokens ?? DEFAULT_MAX_TOKENS,
  }

  if (config.temperature !== undefined) body.temperature = config.temperature

  if (config.tools && config.tools.length > 0) {
    body.tools = config.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }))
  }

  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    },
  }
}

function parseAnthropicResponse(json: Record<string, unknown>): ProviderResponse {
  const contentBlocks = json.content as Array<Record<string, unknown>> | undefined
  let content = ''
  const toolCalls: ProviderResponse['toolCalls'] = []

  if (contentBlocks) {
    for (const block of contentBlocks) {
      if (block.type === 'text') {
        content += (block.text as string) ?? ''
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          toolName: (block.name as string) ?? 'unknown',
          toolInput: (block.input as Record<string, unknown>) ?? undefined,
        })
      }
    }
  }

  const usage = json.usage as Record<string, unknown> | undefined
  return {
    content,
    toolCalls,
    inputTokens: (usage?.input_tokens as number) ?? 0,
    outputTokens: (usage?.output_tokens as number) ?? 0,
    model: (json.model as string) ?? 'unknown',
  }
}

/**
 * Build request config for Gemini generateContent API.
 */
function buildGeminiRequest(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  config: LlmAdapterConfig,
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
  }

  if (config.tools && config.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: config.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ]
  }

  const generationConfig: Record<string, unknown> = {}
  if (config.temperature !== undefined) generationConfig.temperature = config.temperature
  if (config.max_tokens !== undefined) generationConfig.maxOutputTokens = config.max_tokens
  else generationConfig.maxOutputTokens = DEFAULT_MAX_TOKENS

  body.generationConfig = generationConfig

  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  }
}

function parseGeminiResponse(json: Record<string, unknown>): ProviderResponse {
  const candidates = json.candidates as Array<Record<string, unknown>> | undefined
  const candidate = candidates?.[0]
  const contentObj = candidate?.content as Record<string, unknown> | undefined
  const parts = contentObj?.parts as Array<Record<string, unknown>> | undefined

  let content = ''
  const toolCalls: ProviderResponse['toolCalls'] = []

  if (parts) {
    for (const part of parts) {
      if (typeof part.text === 'string') {
        content += part.text
      }
      const fnCall = part.functionCall as Record<string, unknown> | undefined
      if (fnCall) {
        toolCalls.push({
          toolName: (fnCall.name as string) ?? 'unknown',
          toolInput: (fnCall.args as Record<string, unknown>) ?? undefined,
        })
      }
    }
  }

  const usageMeta = json.usageMetadata as Record<string, unknown> | undefined
  return {
    content,
    toolCalls,
    inputTokens: (usageMeta?.promptTokenCount as number) ?? 0,
    outputTokens: (usageMeta?.candidatesTokenCount as number) ?? 0,
    model: 'gemini',
  }
}

// ---------------------------------------------------------------------------
// Cost estimation (rough per-1K-token rates in cents)
// ---------------------------------------------------------------------------

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  'gpt-4.1': { input: 0.2, output: 0.8 },
  'gpt-4.1-mini': { input: 0.04, output: 0.16 },
  'gpt-4.1-nano': { input: 0.01, output: 0.04 },
  // Anthropic
  'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
  'claude-3-5-haiku-20241022': { input: 0.08, output: 0.4 },
  // Gemini
  'gemini-2.0-flash': { input: 0.01, output: 0.04 },
  'gemini-2.5-pro-preview-06-05': { input: 0.125, output: 0.5 },
  // DeepSeek
  'deepseek-chat': { input: 0.014, output: 0.028 },
  'deepseek-reasoner': { input: 0.055, output: 0.22 },
}

function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1K[model]
  if (!rates) return 0
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output
}

// ---------------------------------------------------------------------------
// LlmAdapter
// ---------------------------------------------------------------------------

export class LlmAdapter implements AdapterModule {
  readonly type = 'llm'
  readonly label = 'LLM API (Provider-Agnostic)'

  private abortController: AbortController | null = null

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const config = this.parseConfig(ctx.adapterConfig)
    if (!config) {
      return {
        exitCode: 1,
        stdout: '',
        stderr:
          'adapterConfig.provider and adapterConfig.model are required for llm adapter. ' +
          "Supported providers: 'openai', 'anthropic', 'gemini', 'deepseek'.",
      }
    }

    // Resolve API key
    const keyEnv = config.api_key_env ?? DEFAULT_KEY_ENV[config.provider]
    const apiKey = ctx.env[keyEnv] ?? process.env[keyEnv]
    if (!apiKey) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `API key not found. Set the ${keyEnv} environment variable.`,
      }
    }

    // Build prompt from context
    const basePrompt = (ctx.adapterConfig.prompt as string) ?? 'Execute the assigned task.'
    const systemPrompt = buildFullPrompt(basePrompt, ctx)

    // Build user message from task context
    const userParts: string[] = []
    if (ctx.task) userParts.push(`Task: ${ctx.task}`)
    if (ctx.assignedTasks?.length) {
      for (const t of ctx.assignedTasks) {
        userParts.push(`Issue [${t.title}]: ${t.description ?? '(no description)'}`)
      }
    }
    if (ctx.unreadComments?.length) {
      userParts.push('Recent comments:')
      for (const c of ctx.unreadComments) {
        userParts.push(`  - ${c.author_agent_id ?? 'unknown'}: ${c.content}`)
      }
    }
    if (ctx.subTasks?.length) {
      userParts.push('Sub-tasks:')
      for (const st of ctx.subTasks) {
        userParts.push(`  - [${st.status}] ${st.title}`)
      }
    }
    const userMessage = userParts.length > 0 ? userParts.join('\n') : 'Execute the current task.'

    // Build request based on provider
    let reqUrl: string
    let reqInit: RequestInit

    switch (config.provider) {
      case 'openai': {
        const r = buildOpenAIRequest(
          'https://api.openai.com/v1/chat/completions',
          apiKey, config.model, systemPrompt, userMessage, config,
        )
        reqUrl = r.url
        reqInit = r.init
        break
      }
      case 'deepseek': {
        const r = buildOpenAIRequest(
          'https://api.deepseek.com/v1/chat/completions',
          apiKey, config.model, systemPrompt, userMessage, config,
        )
        reqUrl = r.url
        reqInit = r.init
        break
      }
      case 'anthropic': {
        const r = buildAnthropicRequest(
          apiKey, config.model, systemPrompt, userMessage, config,
        )
        reqUrl = r.url
        reqInit = r.init
        break
      }
      case 'gemini': {
        const r = buildGeminiRequest(
          apiKey, config.model, systemPrompt, userMessage, config,
        )
        reqUrl = r.url
        reqInit = r.init
        break
      }
    }

    // Execute HTTP request with timeout
    const timeoutMs = (config.timeout ?? DEFAULT_TIMEOUT_S) * 1000
    this.abortController = new AbortController()
    const timeoutId = setTimeout(() => this.abortController?.abort(), timeoutMs)
    reqInit.signal = this.abortController.signal

    try {
      const response = await fetch(reqUrl, reqInit)
      clearTimeout(timeoutId)

      const responseText = await response.text()

      if (!response.ok) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `${config.provider} API error (HTTP ${response.status}): ${responseText}`,
        }
      }

      const json = JSON.parse(responseText) as Record<string, unknown>

      // Parse response based on provider
      let parsed: ProviderResponse

      switch (config.provider) {
        case 'openai':
        case 'deepseek':
          parsed = parseOpenAIResponse(json)
          break
        case 'anthropic':
          parsed = parseAnthropicResponse(json)
          break
        case 'gemini':
          parsed = parseGeminiResponse(json)
          break
      }

      // Build stdout: assistant content + tool calls summary
      let stdout = parsed.content
      if (parsed.toolCalls.length > 0) {
        stdout += '\n\n--- Tool Calls ---\n'
        for (const tc of parsed.toolCalls) {
          stdout += `\n[${tc.toolName}]\n`
          if (tc.toolInput) {
            stdout += JSON.stringify(tc.toolInput, null, 2) + '\n'
          }
        }
      }

      const costCents = estimateCostCents(config.model, parsed.inputTokens, parsed.outputTokens)

      const result: AdapterResult = {
        exitCode: 0,
        stdout,
        stderr: '',
        usage: {
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
          costCents,
          model: parsed.model !== 'unknown' ? parsed.model : config.model,
          provider: config.provider,
        },
      }

      if (parsed.toolCalls.length > 0) {
        result.toolCalls = parsed.toolCalls.map((tc) => ({
          toolName: tc.toolName,
          toolInput: tc.toolInput,
          status: 'success' as const,
        }))
      }

      return result
    } catch (err) {
      clearTimeout(timeoutId)

      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          exitCode: 124,
          stdout: '',
          stderr: `LLM API request timed out after ${timeoutMs / 1000}s`,
        }
      }

      const message = err instanceof Error ? err.message : String(err)
      return {
        exitCode: 1,
        stdout: '',
        stderr: `LLM API request failed: ${message}`,
      }
    } finally {
      this.abortController = null
    }
  }

  abort(): void {
    this.abortController?.abort()
  }

  async testEnvironment(): Promise<{ ok: boolean; error?: string }> {
    // Check if at least one provider API key is available
    const envKeys = Object.values(DEFAULT_KEY_ENV)
    const available = envKeys.filter((k) => !!process.env[k])
    if (available.length === 0) {
      return {
        ok: false,
        error:
          'No LLM API key found. Set one of: ' +
          envKeys.join(', '),
      }
    }
    return { ok: true }
  }

  private parseConfig(raw: Record<string, unknown>): LlmAdapterConfig | null {
    const provider = raw.provider as string | undefined
    const model = raw.model as string | undefined

    if (!provider || !model) return null

    const validProviders: LlmProvider[] = ['openai', 'anthropic', 'gemini', 'deepseek']
    if (!validProviders.includes(provider as LlmProvider)) return null

    return {
      provider: provider as LlmProvider,
      model,
      api_key_env: raw.api_key_env as string | undefined,
      temperature: typeof raw.temperature === 'number' ? raw.temperature : undefined,
      max_tokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : undefined,
      tools: Array.isArray(raw.tools) ? (raw.tools as LlmTool[]) : undefined,
      timeout: typeof raw.timeout === 'number' ? raw.timeout : undefined,
    }
  }
}
