# Adapters

An **Adapter** is how the orchestrator executes an agent heartbeat. When a heartbeat fires — by cron schedule or on-demand — the adapter takes over: it runs a subprocess, calls a webhook, invokes Claude, or connects to an MCP server. Every adapter returns a standardized `AdapterResult`.

---

## Adapter interface

Every adapter implements:

```typescript
interface AdapterModule {
  type: string                       // e.g. 'process', 'claude'
  label: string                      // Display label
  execute(ctx: AdapterContext): Promise<AdapterResult>
  testEnvironment?(): Promise<{ ok: boolean; error?: string }>
}
```

The `AdapterContext` passed to `execute` contains:

| Field | Description |
|---|---|
| `agentId` | UUID of the agent |
| `companyId` | UUID of the company |
| `heartbeatRunId` | UUID of this run — useful for callback |
| `task` | Optional task ID if the agent was given one |
| `adapterConfig` | The adapter-specific config from the agent record |
| `env` | Environment variables to inject |
| `sessionState` | Optional carry-over session state from previous run |

The `AdapterResult` returned:

| Field | Description |
|---|---|
| `exitCode` | 0 = success, non-zero = failure, 124 = timeout |
| `stdout` | Captured standard output |
| `stderr` | Captured standard error |
| `sessionState` | Optional state to carry forward to next run |
| `usage` | Optional token usage: `inputTokens`, `outputTokens`, `costCents`, `model`, `provider` |

---

## Process adapter

**Type:** `process`

Spawns any executable as a subprocess. The simplest adapter — use it for shell scripts, Python programs, or any language runtime.

**Config:**

| Key | Required | Description |
|---|---|---|
| `command` | Yes | Executable to run (e.g. `python3`, `node`, `./my-agent.sh`) |
| `args` | No | Array of arguments |
| `timeout` | No | Timeout in seconds (default: 300) |
| `cron` | No | Cron expression for scheduled runs |

**Injected environment variables:**

| Variable | Value |
|---|---|
| `SHACKLEAI_RUN_ID` | Heartbeat run UUID |
| `SHACKLEAI_AGENT_ID` | Agent UUID |
| `SHACKLEAI_TASK_ID` | Task ID (if assigned) |
| `SHACKLEAI_API_KEY` | Agent API key (if present in env) |
| `SHACKLEAI_SESSION_STATE` | Session state from previous run (if any) |

**Example config:**

```json
{
  "adapter_type": "process",
  "adapter_config": {
    "command": "python3",
    "args": ["/home/user/agents/my-agent.py"],
    "timeout": 120,
    "cron": "*/10 * * * *"
  }
}
```

**Create via API:**

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "data-agent",
    "role": "worker",
    "adapter_type": "process",
    "adapter_config": {
      "command": "python3",
      "args": ["/path/to/agent.py"],
      "cron": "0 * * * *"
    }
  }'
```

**Graceful termination:** Process adapter sends SIGTERM first, waits 5 seconds, then sends SIGKILL. Exit code 124 means the process was killed for timeout.

---

## HTTP adapter

**Type:** `http`

Sends a POST request to a webhook URL. Use this when your agent logic lives behind an HTTP endpoint — a Lambda function, a Fly.io app, or a local service.

**Config:**

| Key | Required | Description |
|---|---|---|
| `url` | Yes | Webhook URL to POST to |
| `headers` | No | Additional HTTP headers |
| `authToken` | No | Bearer token — sent as `Authorization: Bearer <token>` |
| `timeout` | No | Timeout in seconds (default: 300) |
| `cron` | No | Cron expression |

**Request payload** (sent as JSON body):

```json
{
  "agentId": "uuid...",
  "companyId": "uuid...",
  "heartbeatRunId": "uuid...",
  "task": "task-id or null",
  "sessionState": "state string or null"
}
```

**Response:** The endpoint should return a 200 response. If it returns a JSON body with a `__shackleai_result__` key, the orchestrator extracts `sessionState` and `usage` from it:

```json
{
  "__shackleai_result__": {
    "sessionState": "optional carry-forward state",
    "usage": {
      "inputTokens": 1500,
      "outputTokens": 300,
      "costCents": 4,
      "model": "gpt-4o",
      "provider": "openai"
    }
  }
}
```

**Example config:**

```json
{
  "adapter_type": "http",
  "adapter_config": {
    "url": "https://my-agent.example.com/heartbeat",
    "authToken": "my-secret-token",
    "timeout": 60,
    "cron": "*/5 * * * *"
  }
}
```

---

## Claude adapter

**Type:** `claude`

Invokes the Claude Code CLI (`claude`) to run a prompt. The orchestrator spawns `claude --print <prompt>` and captures the output.

**Requirements:** The `claude` CLI must be installed and available in PATH. Install it from [claude.ai/code](https://claude.ai/code).

**Config:**

| Key | Required | Description |
|---|---|---|
| `prompt` | Yes | The prompt to run |
| `model` | No | Model name (e.g. `claude-opus-4-5`) — sets `CLAUDE_MODEL` env var |
| `timeout` | No | Timeout in seconds (default: 300) |
| `cron` | No | Cron expression |

**Injected environment variables** (in addition to the standard SHACKLEAI_* vars):

| Variable | Value |
|---|---|
| `CLAUDE_MODEL` | Model name from config (if set) |

**Result parsing:** The adapter looks for a `__shackleai_result__` JSON block anywhere in stdout. If found, it extracts `sessionState` and `usage`. Your Claude agent scripts can emit this block to report token usage back to the orchestrator.

**Example config:**

```json
{
  "adapter_type": "claude",
  "adapter_config": {
    "prompt": "You are a code review agent. Check the latest PR and leave a comment.",
    "model": "claude-opus-4-5",
    "timeout": 180,
    "cron": "0 9 * * 1-5"
  }
}
```

**Verify the environment:**

```bash
npx @shackleai/orchestrator doctor
# The doctor command checks if the claude CLI is reachable
```

---

## MCP adapter

**Type:** `mcp`

Connects to an HTTP-based MCP (Model Context Protocol) server and calls a named tool. Uses `@modelcontextprotocol/sdk` under the hood.

**Config:**

| Key | Required | Description |
|---|---|---|
| `url` | Yes | MCP server URL |
| `toolName` | Yes | Name of the MCP tool to call |
| `toolParams` | No | Parameters to pass to the tool |
| `timeout` | No | Timeout in seconds (default: 300) |
| `cron` | No | Cron expression |

**Context enrichment:** The adapter automatically appends a `_shackleai` object to `toolParams` containing the run context:

```json
{
  "_shackleai": {
    "agentId": "uuid...",
    "companyId": "uuid...",
    "heartbeatRunId": "uuid...",
    "task": "task-id or null",
    "sessionState": "state or null"
  }
}
```

**Example config:**

```json
{
  "adapter_type": "mcp",
  "adapter_config": {
    "url": "http://localhost:3001/mcp",
    "toolName": "run_agent_step",
    "toolParams": {
      "agent_persona": "code_reviewer"
    },
    "timeout": 120,
    "cron": "*/15 * * * *"
  }
}
```

---

## OpenClaw adapter

**Type:** `openclaw`

Integration with the OpenClaw agent framework. Configuration details are framework-specific — see the OpenClaw documentation for the expected `adapter_config` shape.

---

## CrewAI adapter

**Type:** `crewai`

Integration with CrewAI crews. Configuration details are CrewAI-specific — see the CrewAI documentation for the expected `adapter_config` shape.

---

## Adapter selection guide

| Use case | Adapter |
|---|---|
| Shell script or any language | `process` |
| Existing HTTP service | `http` |
| Claude Code CLI agent | `claude` |
| MCP-compatible tool server | `mcp` |
| OpenClaw-based agent | `openclaw` |
| CrewAI crew | `crewai` |

---

## Timeout and exit codes

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `1` | Generic failure |
| `124` | Killed by timeout (SIGTERM → SIGKILL) |
| `127` | Executable not found (process/claude adapters) |
| Any other | Subprocess-specific exit code |
