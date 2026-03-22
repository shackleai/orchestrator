# Custom Adapter Development Guide

An **Adapter** is the execution layer between the orchestrator and your agent logic. Every time a heartbeat fires, the orchestrator calls your adapter's `execute()` method, passing a rich context object that includes the agent's task, environment variables, session state from the previous run, and the full goal hierarchy from company mission down to the current task. Your adapter does the work and returns a structured result.

This guide walks you through building a custom adapter from scratch.

---

## When to write a custom adapter

Built-in adapters cover common cases:

| Built-in | Use when |
|---|---|
| `process` | Any subprocess: shell scripts, Python, Node.js, Go, etc. |
| `http` | Your agent runs behind an HTTP endpoint |
| `claude` | You use the Claude Code CLI directly |
| `mcp` | Your agent exposes an MCP-compatible tool server |
| `openclaw` | You use the OpenClaw agent framework |
| `crewai` | You use a CrewAI crew |

Write a custom adapter when you need to:

- Integrate a framework not covered by built-ins (LangChain, AutoGen, custom LLM SDK)
- Add pre/post-processing around an existing adapter
- Build a mock adapter for testing
- Enforce custom retry or circuit-breaker logic at the execution layer

---

## The AdapterModule interface

Every adapter implements three required fields and one optional method:

```typescript
// packages/core/src/adapters/adapter.ts

export interface AdapterModule {
  /** Unique key used in the agent's adapter_type column. */
  type: string

  /** Human-readable name shown in the dashboard and CLI output. */
  label: string

  /** Execute a single heartbeat. Called once per heartbeat run. */
  execute(ctx: AdapterContext): Promise<AdapterResult>

  /** Optional: verify the runtime environment before the first run. */
  testEnvironment?(): Promise<{ ok: boolean; error?: string }>

  /** Optional: abort an in-progress execution (e.g. user-triggered stop). */
  abort?(): void
}
```

### Field details

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | Yes | Unique adapter key, e.g. `"my-adapter"`. Must be unique across all registered adapters. Lowercase, hyphen-separated by convention. |
| `label` | `string` | Yes | Display name, e.g. `"My Custom Adapter"`. Shown in dashboard lists. |
| `execute` | `function` | Yes | Core execution logic. Called once per heartbeat. See [AdapterContext](#adaptercontext) and [AdapterResult](#adapterresult). |
| `testEnvironment` | `function` | No | Called by `shackleai doctor` and during adapter validation. Return `{ ok: false, error: "..." }` to surface a clear error before runtime. |
| `abort` | `function` | No | Called when a user manually stops a running heartbeat. Kill any in-progress work here. |

---

## AdapterContext

The orchestrator populates `AdapterContext` before calling `execute()`. This is the full picture of what your adapter receives:

```typescript
export interface AdapterContext {
  // Identity
  agentId: string           // UUID of the agent being executed
  companyId: string         // UUID of the owning company (tenant namespace)
  heartbeatRunId: string    // UUID of this specific run — use for logging/callbacks

  // Task
  task?: string             // Task ID checked out by this agent, if any

  // Adapter-specific configuration from the agent record
  adapterConfig: Record<string, unknown>

  // Environment variables to inject — already filtered through the safe-env whitelist
  env: Record<string, string>

  // Continuity: state string returned by the previous successful run
  sessionState?: string | null

  // Live feed: up to 50 activity log entries since last heartbeat
  recentActivity?: ActivityLogEntry[]

  // Issues currently checked out by this agent (status = 'in_progress')
  assignedTasks?: Issue[]

  // Comments on this agent's tasks posted since last heartbeat
  unreadComments?: IssueComment[]

  // Full goal ancestry: mission → project → goal → task
  ancestry?: GoalAncestry

  // Delegation chain
  delegatedBy?: string      // Agent ID that delegated this task, if any
  subTasks?: Array<{ id: string; title: string; status: string }>

  // Pre-built Markdown system prompt built by ContextBuilder
  systemContext?: string
}

export interface GoalAncestry {
  mission: string | null
  project: { name: string; description: string | null } | null
  goal: { name: string; description: string | null } | null
  task: { title: string; description: string | null } | null
}
```

### Key fields explained

**`adapterConfig`** is the raw JSON from the agent's `adapter_config` column. Cast it to the shape your adapter expects:

```typescript
const apiKey = ctx.adapterConfig.apiKey as string | undefined
const model = ctx.adapterConfig.model as string ?? 'gpt-4o'
```

**`env`** contains environment variables already filtered through the orchestrator's safe-env whitelist. The whitelist allows `SHACKLEAI_*`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PATH`, `HOME`, `NODE_*`, and others. You can read any key your adapter needs from `ctx.env`.

**`sessionState`** is the string your adapter returned as `sessionState` in the previous run's `AdapterResult`. Use it for continuity — conversation thread IDs, checkpoint markers, or any state that must survive across heartbeats.

**`systemContext`** is a pre-built Markdown prompt assembled by the orchestrator's ContextBuilder. It includes the agent's system prompt, assigned tasks, goal ancestry, and recent activity. Pass it to your LLM as the system prompt.

**`ancestry`** gives you the full strategic context from company mission down to the current task title. Useful for building rich prompts without re-querying the database.

---

## AdapterResult

Return this from `execute()`:

```typescript
export interface AdapterResult {
  // Exit code: 0 = success, non-zero = failure, 124 = killed by timeout
  exitCode: number

  // Captured output (can be empty strings)
  stdout: string
  stderr: string

  // State to carry forward to the next heartbeat run
  sessionState?: string | null

  // Signal a task status change (optional — omit if no status change needed)
  taskStatus?: 'done' | 'in_review' | 'in_progress' | null

  // Token usage for cost tracking and budget enforcement
  usage?: {
    inputTokens: number
    outputTokens: number
    costCents: number   // integer — e.g. 4 means $0.04
    model: string       // e.g. "gpt-4o"
    provider: string    // e.g. "openai"
  }

  // Optional structured tool call log (for dashboard display)
  toolCalls?: Array<{
    toolName: string
    toolInput?: Record<string, unknown>
    toolOutput?: string
    durationMs?: number
    status?: 'success' | 'error'
  }>
}
```

### Field details

| Field | Required | Notes |
|---|---|---|
| `exitCode` | Yes | `0` = success. Use `1` for generic errors, `124` for timeouts, `127` for missing runtime. |
| `stdout` | Yes | Human-readable output shown in the dashboard. Can be empty. |
| `stderr` | Yes | Error messages. Can be empty. |
| `sessionState` | No | Pass any string. Common patterns: JSON blob, conversation thread ID, checkpoint key. Stored in `heartbeat_runs.session_id_after`. |
| `taskStatus` | No | If set to `'done'`, the orchestrator marks the agent's checked-out task as done. `null` means no change. |
| `usage` | No | If omitted, no cost is recorded. Provide this whenever your adapter calls a paid LLM API. `costCents` must be an integer. |
| `toolCalls` | No | Surfaced in the dashboard's run detail view. Useful for debugging. |

---

## Step-by-step tutorial: build a custom adapter

We will build `LangChainAdapter` — an adapter that calls a Python LangChain agent via a local HTTP endpoint. This is a realistic pattern for teams with existing Python agent infrastructure.

### Step 1: Create the adapter file

Create `packages/core/src/adapters/langchain.ts`:

```typescript
/**
 * LangChainAdapter — calls a local LangChain agent server via HTTP.
 *
 * Reads `url`, `apiKey`, `model`, and `timeout` from adapterConfig.
 * Parses the response body for usage data and session state.
 */

import type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'

const DEFAULT_TIMEOUT_SECONDS = 300

export class LangChainAdapter implements AdapterModule {
  readonly type = 'langchain'
  readonly label = 'LangChain Agent'

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    // 1. Validate required config
    const url = ctx.adapterConfig.url as string | undefined
    if (!url) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'adapterConfig.url is required for langchain adapter',
      }
    }

    const apiKey = ctx.adapterConfig.apiKey as string | undefined
    const model = (ctx.adapterConfig.model as string) ?? 'gpt-4o'
    const timeoutSeconds =
      typeof ctx.adapterConfig.timeout === 'number'
        ? ctx.adapterConfig.timeout
        : DEFAULT_TIMEOUT_SECONDS

    // 2. Build request headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    // 3. Build the payload — include all orchestrator context
    const payload = {
      agentId: ctx.agentId,
      heartbeatRunId: ctx.heartbeatRunId,
      task: ctx.task ?? null,
      model,
      systemContext: ctx.systemContext ?? null,
      sessionState: ctx.sessionState ?? null,
      ancestry: ctx.ancestry ?? null,
    }

    // 4. Set up timeout via AbortController
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      timeoutSeconds * 1000,
    )

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseText = await response.text()

      // 5. Handle HTTP errors
      if (!response.ok) {
        return {
          exitCode: 1,
          stdout: responseText,
          stderr: `HTTP ${response.status}: ${response.statusText}`,
        }
      }

      // 6. Parse response for session state and usage
      let sessionState: string | null = null
      let usage: AdapterResult['usage'] = undefined
      let taskStatus: AdapterResult['taskStatus'] = null

      try {
        const json = JSON.parse(responseText) as Record<string, unknown>

        if (typeof json.sessionState === 'string') {
          sessionState = json.sessionState
        }

        if (json.taskStatus === 'done' || json.taskStatus === 'in_review') {
          taskStatus = json.taskStatus
        }

        if (json.usage && typeof json.usage === 'object') {
          const u = json.usage as Record<string, unknown>
          usage = {
            inputTokens: (u.inputTokens as number) ?? 0,
            outputTokens: (u.outputTokens as number) ?? 0,
            costCents: (u.costCents as number) ?? 0,
            model: (u.model as string) ?? model,
            provider: (u.provider as string) ?? 'openai',
          }
        }
      } catch {
        // Non-JSON response — that is acceptable, just no metadata
      }

      return {
        exitCode: 0,
        stdout: responseText,
        stderr: '',
        sessionState,
        taskStatus,
        usage,
      }
    } catch (err) {
      clearTimeout(timeoutId)

      // 7. Distinguish timeout from other network errors
      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          exitCode: 124,
          stdout: '',
          stderr: `LangChain agent timed out after ${timeoutSeconds}s`,
        }
      }

      const message = err instanceof Error ? err.message : String(err)
      return {
        exitCode: 1,
        stdout: '',
        stderr: `LangChain agent request failed: ${message}`,
      }
    }
  }

  // 8. Verify the environment before the first run
  async testEnvironment(): Promise<{ ok: boolean; error?: string }> {
    const url = 'http://localhost:8000/health'
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (!response.ok) {
        return {
          ok: false,
          error: `LangChain server health check failed: HTTP ${response.status}`,
        }
      }
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        error: `LangChain server not reachable at ${url}: ${message}`,
      }
    }
  }
}
```

### Step 2: Export the adapter

Add the export to `packages/core/src/adapters/index.ts`:

```typescript
export { LangChainAdapter } from './langchain.js'
```

### Step 3: Register the adapter in AdapterRegistry

In the same `index.ts`, add the import and registration inside the `AdapterRegistry` constructor:

```typescript
import { LangChainAdapter } from './langchain.js'

export class AdapterRegistry {
  private adapters = new Map<string, AdapterModule>()

  constructor() {
    // ... existing registrations ...
    this.register(new LangChainAdapter())   // add this line
  }
  // ...
}
```

### Step 4: Create an agent using the new adapter

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "langchain-analyst",
    "title": "Data Analyst",
    "role": "worker",
    "adapter_type": "langchain",
    "adapter_config": {
      "url": "http://localhost:8000/heartbeat",
      "model": "gpt-4o",
      "timeout": 120,
      "cron": "0 * * * *"
    }
  }'
```

Or via the CLI:

```bash
shackleai agents create \
  --name langchain-analyst \
  --adapter langchain \
  --config '{"url":"http://localhost:8000/heartbeat","model":"gpt-4o","cron":"0 * * * *"}'
```

### Step 5: Implement the server side (Python example)

Your LangChain server receives this JSON body:

```python
from flask import Flask, request, jsonify
import json

app = Flask(__name__)

@app.post("/heartbeat")
def heartbeat():
    body = request.get_json()

    agent_id = body["agentId"]
    run_id = body["heartbeatRunId"]
    task = body.get("task")
    system_context = body.get("systemContext", "")
    session_state = body.get("sessionState")  # from previous run

    # Run your LangChain agent here
    result = run_agent(
        system_prompt=system_context,
        task=task,
        prior_state=session_state,
    )

    # Return usage and session state in the response body
    return jsonify({
        "output": result["text"],
        "sessionState": result["thread_id"],
        "taskStatus": "done" if result["complete"] else None,
        "usage": {
            "inputTokens": result["input_tokens"],
            "outputTokens": result["output_tokens"],
            "costCents": result["cost_cents"],
            "model": "gpt-4o",
            "provider": "openai",
        }
    })
```

---

## Advanced topics

### Session state continuity

Session state is a free-form string persisted across heartbeat runs. Use it to maintain conversation thread IDs, track progress through multi-step workflows, or store any checkpoint data.

```typescript
// In your adapter's execute():

// Read prior state
const priorState = ctx.sessionState
  ? JSON.parse(ctx.sessionState) as { threadId: string; step: number }
  : null

// Do work using prior state
const threadId = priorState?.threadId ?? crypto.randomUUID()
const result = await callLLM({ threadId, step: (priorState?.step ?? 0) + 1 })

// Return new state to carry forward
return {
  exitCode: 0,
  stdout: result.text,
  stderr: '',
  sessionState: JSON.stringify({ threadId, step: result.step }),
  usage: result.usage,
}
```

The orchestrator stores session state in the `heartbeat_runs.session_id_after` column and retrieves the latest successful run's state before each heartbeat.

### Cost reporting

Reporting usage is optional but strongly recommended — it populates the budget enforcement system and the cost dashboard. `costCents` must be an integer (100 = $1.00):

```typescript
// Calculate cost from token counts
const INPUT_COST_PER_1K = 0.25   // $0.25 per 1K input tokens for gpt-4o
const OUTPUT_COST_PER_1K = 1.00  // $1.00 per 1K output tokens

const costDollars =
  (inputTokens / 1000) * INPUT_COST_PER_1K +
  (outputTokens / 1000) * OUTPUT_COST_PER_1K

const costCents = Math.round(costDollars * 100)

return {
  // ...
  usage: {
    inputTokens,
    outputTokens,
    costCents,
    model: 'gpt-4o',
    provider: 'openai',
  },
}
```

When a `usage` block is present in the result, the orchestrator:
1. Creates a `CostEvent` record
2. Increments `agents.spent_monthly_cents` and `companies.spent_monthly_cents`
3. Checks against budget limits and raises a soft alert at 80% spend

### Timeout handling

Use exit code `124` for timeout — it is the standard the orchestrator uses across all built-in adapters. Always clean up resources before returning.

```typescript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

try {
  const result = await doWork({ signal: controller.signal })
  clearTimeout(timeoutId)
  return { exitCode: 0, stdout: result.output, stderr: '' }
} catch (err) {
  clearTimeout(timeoutId)
  if (err instanceof DOMException && err.name === 'AbortError') {
    return {
      exitCode: 124,
      stdout: '',
      stderr: `Timed out after ${timeoutMs}ms`,
    }
  }
  throw err
}
```

### Env var injection

Secrets configured on the agent's env vars are available in `ctx.env`. Read them in your adapter:

```typescript
const apiKey = ctx.env.OPENAI_API_KEY
const customSecret = ctx.env.MY_CUSTOM_SECRET
```

The orchestrator applies a safe-env whitelist before passing `ctx.env`. The whitelist allows:
- `SHACKLEAI_*` — all orchestrator-injected variables
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — LLM API keys
- `PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP`
- `NODE_*`, `LANG`, `LC_*`, `VIRTUAL_ENV`
- Windows-specific: `APPDATA`, `LOCALAPPDATA`, `COMSPEC`, `SystemRoot`

Any host env var not in this list is stripped before being passed to your adapter.

### Implementing abort()

If your adapter can be interrupted mid-run (e.g. it holds a child process or an open WebSocket), implement `abort()` so the orchestrator can clean up on user-triggered stops:

```typescript
private activeRequest: AbortController | null = null

async execute(ctx: AdapterContext): Promise<AdapterResult> {
  this.activeRequest = new AbortController()
  try {
    const result = await fetch(url, { signal: this.activeRequest.signal })
    // ...
  } finally {
    this.activeRequest = null
  }
}

abort(): void {
  this.activeRequest?.abort()
  this.activeRequest = null
}
```

### Emitting the `__shackleai_result__` marker (subprocess adapters)

If your adapter spawns a child process and you want the subprocess itself to report usage and session state back to the orchestrator, print this JSON marker to stdout:

```
__shackleai_result__{"sessionState":"...","usage":{...}}__shackleai_result__
```

The built-in process-based adapters (claude, openclaw) use this pattern. The parent adapter reads stdout, scans for the marker, and extracts the payload. Your subprocess can be in any language:

```python
# Python subprocess — emit at the end of your agent run
import json, sys

result = {
    "sessionState": thread_id,
    "taskStatus": "done",
    "usage": {
        "inputTokens": 1200,
        "outputTokens": 400,
        "costCents": 3,
        "model": "gpt-4o",
        "provider": "openai",
    }
}
marker = "__shackleai_result__"
print(f"{marker}{json.dumps(result)}{marker}", flush=True)
```

```typescript
// TypeScript subprocess — emit at the end of your agent run
const result = {
  sessionState: threadId,
  taskStatus: 'done' as const,
  usage: { inputTokens: 1200, outputTokens: 400, costCents: 3, model: 'gpt-4o', provider: 'openai' },
}
const marker = '__shackleai_result__'
process.stdout.write(`${marker}${JSON.stringify(result)}${marker}\n`)
```

---

## Testing your adapter

### Unit test with Vitest

Create `packages/core/src/adapters/__tests__/langchain.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LangChainAdapter } from '../langchain.js'
import type { AdapterContext } from '../adapter.js'

// Mock fetch globally
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makeCtx(overrides?: Partial<AdapterContext>): AdapterContext {
  return {
    agentId: 'agent-1',
    companyId: 'company-1',
    heartbeatRunId: 'run-1',
    adapterConfig: { url: 'http://localhost:8000/heartbeat' },
    env: {},
    ...overrides,
  }
}

describe('LangChainAdapter', () => {
  let adapter: LangChainAdapter

  beforeEach(() => {
    adapter = new LangChainAdapter()
    vi.clearAllMocks()
  })

  it('returns error when url is missing', async () => {
    const result = await adapter.execute(makeCtx({ adapterConfig: {} }))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.url is required')
  })

  it('returns exitCode 0 on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ output: 'done', sessionState: 'thread-abc' }),
    })

    const result = await adapter.execute(makeCtx())
    expect(result.exitCode).toBe(0)
    expect(result.sessionState).toBe('thread-abc')
  })

  it('returns exitCode 1 on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'server error',
    })

    const result = await adapter.execute(makeCtx())
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('HTTP 500')
  })

  it('returns exitCode 124 on timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          })
        }),
    )

    const result = await adapter.execute(
      makeCtx({ adapterConfig: { url: 'http://localhost:8000/heartbeat', timeout: 0 } }),
    )
    expect(result.exitCode).toBe(124)
  })

  it('parses usage from response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          usage: { inputTokens: 100, outputTokens: 50, costCents: 2, model: 'gpt-4o', provider: 'openai' },
        }),
    })

    const result = await adapter.execute(makeCtx())
    expect(result.usage?.costCents).toBe(2)
    expect(result.usage?.model).toBe('gpt-4o')
  })

  it('testEnvironment returns ok when health check passes', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })
    const env = await adapter.testEnvironment()
    expect(env.ok).toBe(true)
  })

  it('testEnvironment returns error when server is down', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const env = await adapter.testEnvironment()
    expect(env.ok).toBe(false)
    expect(env.error).toContain('ECONNREFUSED')
  })
})
```

Run the tests:

```bash
pnpm test --filter @shackleai/core
```

### Integration test with a real heartbeat run

```bash
# 1. Start the orchestrator
shackleai start

# 2. Create an agent with your custom adapter
shackleai agents create \
  --name test-langchain \
  --adapter langchain \
  --config '{"url":"http://localhost:8000/heartbeat"}'

# 3. Trigger a manual run
shackleai run --agent test-langchain

# 4. Inspect the result
shackleai runs list --agent test-langchain --limit 1
```

### Use testEnvironment during development

The `shackleai doctor` command calls `testEnvironment()` on all registered adapters. Add your adapter to the registry and run:

```bash
shackleai doctor
# Output:
# process  ✓ Child Process
# claude   ✓ Claude Code CLI
# langchain ✓ LangChain Agent   ← your adapter
```

---

## Exit code reference

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `1` | Generic failure |
| `124` | Killed by timeout |
| `127` | Executable not found (for subprocess-based adapters) |
| Other | Subprocess-specific exit code — propagated as-is |

---

## Reference implementations

Study these built-in adapters as reference:

| File | Pattern | What to learn |
|---|---|---|
| `packages/core/src/adapters/process.ts` | Subprocess + timeout | SIGTERM/SIGKILL escalation, context tmp file injection |
| `packages/core/src/adapters/http.ts` | HTTP webhook | `__shackleai_result__` response parsing, AbortController timeout |
| `packages/core/src/adapters/claude.ts` | CLI subprocess + result parsing | Prompt construction from ancestry + systemContext |
| `packages/core/src/adapters/openclaw.ts` | Subprocess with stdout marker | `__shackleai_result__` delimited marker format, stdout buffer limit |
| `packages/core/src/adapters/env.ts` | Safe env filtering | Which host env vars are forwarded to child processes |

---

## Checklist

Before shipping a custom adapter:

- [ ] `type` is unique — does not collide with built-in adapter keys
- [ ] `execute()` always returns an `AdapterResult` (never throws)
- [ ] Missing or invalid `adapterConfig` fields return `exitCode: 1` with a clear `stderr` message
- [ ] Timeout is handled — `exitCode: 124` when the operation exceeds the configured limit
- [ ] `sessionState` is returned when your adapter maintains stateful sessions
- [ ] `usage` is reported when your adapter calls a paid LLM API
- [ ] `testEnvironment()` is implemented and verifies all runtime dependencies
- [ ] `abort()` is implemented if your adapter holds long-lived resources
- [ ] Unit tests cover: happy path, missing config, HTTP error, timeout
- [ ] Adapter is registered in `AdapterRegistry` constructor in `packages/core/src/adapters/index.ts`
- [ ] `pnpm build && pnpm typecheck && pnpm lint` pass

Closes #260
