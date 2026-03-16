# API Reference

The ShackleAI Orchestrator exposes a local REST API on `http://localhost:4800` (or the port specified with `--port`). The API is built with [Hono](https://hono.dev) and uses JSON throughout.

---

## Base URL

```
http://localhost:4800
```

---

## Response envelope

All responses use a consistent envelope:

**Success:**

```json
{ "data": <payload> }
```

**Error:**

```json
{ "error": "Human-readable message", "details": { ... } }
```

---

## Error codes

| HTTP Status | Meaning |
|---|---|
| `400` | Validation failed — check `details` for field-level errors |
| `401` | Unauthorized — missing or invalid Bearer token |
| `404` | Resource not found |
| `409` | Conflict — e.g. task already checked out by another agent |
| `500` | Internal server error |

---

## Authentication

Most endpoints do not require authentication in the default local deployment. The `agentAuth` middleware is available for endpoints that should only be callable with an agent API key.

To generate an agent API key:

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents/${AGENT_ID}/api-keys \
  -H "Content-Type: application/json" \
  -d '{ "label": "my-agent-key" }'
```

The response includes a `key` field — this is the only time the plain key is returned. Store it securely.

To use an API key:

```
Authorization: Bearer <key>
```

---

## Health

### GET /api/health

Check if the server is running.

**Response:**

```json
{ "status": "ok", "version": "0.1.0" }
```

**Example:**

```bash
curl http://localhost:4800/api/health
```

---

## Companies

### GET /api/companies

List all companies.

```bash
curl http://localhost:4800/api/companies
```

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Acme Corp",
      "description": null,
      "status": "active",
      "issue_prefix": "ACME",
      "issue_counter": 5,
      "budget_monthly_cents": 0,
      "spent_monthly_cents": 1240,
      "created_at": "2026-03-01T00:00:00Z",
      "updated_at": "2026-03-16T12:00:00Z"
    }
  ]
}
```

### POST /api/companies

Create a company.

**Body:**

```json
{
  "name": "Acme Corp",
  "description": "Optional description",
  "issue_prefix": "ACME",
  "budget_monthly_cents": 1000
}
```

```bash
curl -X POST http://localhost:4800/api/companies \
  -H "Content-Type: application/json" \
  -d '{ "name": "Acme Corp", "issue_prefix": "ACME" }'
```

### GET /api/companies/:id

Get a company by ID.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}
```

### PATCH /api/companies/:id

Update a company.

```bash
curl -X PATCH http://localhost:4800/api/companies/${COMPANY_ID} \
  -H "Content-Type: application/json" \
  -d '{ "budget_monthly_cents": 5000 }'
```

---

## Dashboard

### GET /api/companies/:id/dashboard

Get aggregate metrics for a company.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/dashboard
```

**Response:**

```json
{
  "data": {
    "agentCount": 3,
    "taskCount": 42,
    "openTasks": 8,
    "completedTasks": 34,
    "totalSpendCents": 4820,
    "recentActivity": [...]
  }
}
```

---

## Agents

### GET /api/companies/:id/agents

List all agents for a company.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/agents
```

### POST /api/companies/:id/agents

Create an agent.

**Required fields:** `name`, `adapter_type`

**Optional fields:** `title`, `role` (default: `worker`), `reports_to`, `capabilities`, `adapter_config`, `budget_monthly_cents` (default: 0)

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "coder-bot",
    "title": "Senior Engineer",
    "role": "worker",
    "adapter_type": "process",
    "adapter_config": {
      "command": "python3",
      "args": ["/path/to/agent.py"],
      "cron": "*/5 * * * *"
    },
    "budget_monthly_cents": 2000
  }'
```

**Response:** `201 Created` with the created agent object.

### GET /api/companies/:id/agents/:agentId

Get a single agent.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/agents/${AGENT_ID}
```

### PATCH /api/companies/:id/agents/:agentId

Update an agent.

```bash
curl -X PATCH http://localhost:4800/api/companies/${COMPANY_ID}/agents/${AGENT_ID} \
  -H "Content-Type: application/json" \
  -d '{ "title": "Lead Engineer", "budget_monthly_cents": 3000 }'
```

### POST /api/companies/:id/agents/:agentId/pause

Set agent status to `paused`.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents/${AGENT_ID}/pause
```

### POST /api/companies/:id/agents/:agentId/resume

Set agent status back to `idle`.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents/${AGENT_ID}/resume
```

### POST /api/companies/:id/agents/:agentId/terminate

Set agent status to `terminated`. This is irreversible via API.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents/${AGENT_ID}/terminate
```

### POST /api/companies/:id/agents/:agentId/wakeup

Trigger an on-demand heartbeat. Updates `last_heartbeat_at` to now.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents/${AGENT_ID}/wakeup
```

**Response:**

```json
{
  "data": {
    "agent": { ...agent object... },
    "triggered": true
  }
}
```

### POST /api/companies/:id/agents/:agentId/api-keys

Generate an API key for an agent. The plain key is returned once and never stored.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents/${AGENT_ID}/api-keys \
  -H "Content-Type: application/json" \
  -d '{ "label": "production-key" }'
```

**Response:** `201 Created`

```json
{
  "data": {
    "id": "uuid",
    "agent_id": "uuid",
    "company_id": "uuid",
    "label": "production-key",
    "status": "active",
    "key": "64-char-hex-string",
    "last_used_at": null,
    "created_at": "2026-03-16T12:00:00Z"
  }
}
```

---

## Tasks (Issues)

### GET /api/companies/:id/issues

List tasks. Supports query filters:

| Query param | Description |
|---|---|
| `status` | Filter by status (e.g. `in_progress`) |
| `priority` | Filter by priority (e.g. `high`) |
| `assignee` | Filter by assignee agent ID |

```bash
curl "http://localhost:4800/api/companies/${COMPANY_ID}/issues?status=in_progress"
curl "http://localhost:4800/api/companies/${COMPANY_ID}/issues?priority=critical&status=todo"
```

### POST /api/companies/:id/issues

Create a task. Identifiers are auto-generated (`ACME-1`, `ACME-2`, ...).

**Required:** `title`

**Optional:** `description`, `priority` (default: `medium`), `status` (default: `backlog`), `parent_id`, `goal_id`, `project_id`, `assignee_agent_id`

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/issues \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Implement feature X",
    "description": "Detailed description",
    "priority": "high"
  }'
```

**Response:** `201 Created` with the issue object, including the generated `identifier`.

### GET /api/companies/:id/issues/:issueId

Get a single task.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}
```

### PATCH /api/companies/:id/issues/:issueId

Update a task's fields.

```bash
curl -X PATCH http://localhost:4800/api/companies/${COMPANY_ID}/issues/${ISSUE_ID} \
  -H "Content-Type: application/json" \
  -d '{ "status": "done" }'
```

### POST /api/companies/:id/issues/:issueId/checkout

Atomically claim a task. Only succeeds if the task is unassigned and in `backlog` or `todo` status. Returns `409` if already claimed.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/checkout \
  -H "Content-Type: application/json" \
  -d '{ "agent_id": "'${AGENT_ID}'" }'
```

### POST /api/companies/:id/issues/:issueId/release

Unassign a task and set its status back to `todo`.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/release
```

### POST /api/companies/:id/issues/:issueId/comments

Add a comment to a task.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/comments \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Starting work on this task.",
    "author_agent_id": "'${AGENT_ID}'"
  }'
```

### GET /api/companies/:id/issues/:issueId/comments

List comments on a task, ordered by creation time.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/comments
```

---

## Policies

### GET /api/companies/:id/policies

List all policies, ordered by priority descending.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/policies
```

### POST /api/companies/:id/policies

Create a policy.

**Required:** `name`, `tool_pattern`, `action`, `priority`

**Optional:** `agent_id` (null = company-wide), `max_calls_per_hour`

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "allow-github",
    "tool_pattern": "github:*",
    "action": "allow",
    "priority": 10
  }'
```

### PATCH /api/companies/:id/policies/:policyId

Update a policy.

```bash
curl -X PATCH http://localhost:4800/api/companies/${COMPANY_ID}/policies/${POLICY_ID} \
  -H "Content-Type: application/json" \
  -d '{ "priority": 20 }'
```

### DELETE /api/companies/:id/policies/:policyId

Delete a policy.

```bash
curl -X DELETE http://localhost:4800/api/companies/${COMPANY_ID}/policies/${POLICY_ID}
```

**Response:**

```json
{ "data": { "deleted": true, "id": "uuid" } }
```

---

## Costs

### GET /api/companies/:id/costs

List cost events. Supports optional date range filters:

| Query param | Format | Description |
|---|---|---|
| `from` | ISO 8601 | Start of date range |
| `to` | ISO 8601 | End of date range |

```bash
curl "http://localhost:4800/api/companies/${COMPANY_ID}/costs?from=2026-03-01&to=2026-03-31"
```

### GET /api/companies/:id/costs/by-agent

Get costs aggregated by agent.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/costs/by-agent
```

**Response:**

```json
{
  "data": [
    {
      "agent_id": "uuid",
      "total_cost_cents": 4820,
      "total_input_tokens": 150000,
      "total_output_tokens": 35000,
      "event_count": 42
    }
  ]
}
```

### POST /api/companies/:id/costs/events

Record a cost event manually (e.g. from an HTTP adapter that tracks its own token usage).

**Required:** `input_tokens`, `output_tokens`, `cost_cents`

**Optional:** `agent_id`, `issue_id`, `provider`, `model`

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/costs/events \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "'${AGENT_ID}'",
    "provider": "anthropic",
    "model": "claude-opus-4-5",
    "input_tokens": 2500,
    "output_tokens": 400,
    "cost_cents": 12
  }'
```

---

## Heartbeats

### GET /api/companies/:id/heartbeats

List all heartbeat runs, most recent first.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/heartbeats
```

### GET /api/companies/:id/heartbeats/:runId

Get a single heartbeat run by ID.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/heartbeats/${RUN_ID}
```

**Response fields:**

| Field | Description |
|---|---|
| `status` | `queued` / `running` / `success` / `failed` / `timeout` |
| `trigger_type` | `cron` / `manual` / `event` / `api` |
| `exit_code` | 0 = success, 124 = timeout |
| `stdout_excerpt` | First 4000 chars of stdout |
| `error` | Error message if failed |
| `usage_json` | Token usage if reported by adapter |

---

## Activity

### GET /api/companies/:id/activity

List activity log entries, most recent first.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/activity
```

---

## Goals

### GET /api/companies/:id/goals

List goals.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/goals
```

### POST /api/companies/:id/goals

Create a goal.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/goals \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Ship v1.0",
    "level": "strategic",
    "description": "Launch the first stable release"
  }'
```

---

## Projects

### GET /api/companies/:id/projects

List projects.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/projects
```

### POST /api/companies/:id/projects

Create a project.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "API v2",
    "description": "Redesign the API layer",
    "target_date": "2026-06-01"
  }'
```
