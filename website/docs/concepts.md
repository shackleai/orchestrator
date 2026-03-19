---
id: concepts
title: Concepts
sidebar_label: Concepts
---

# Concepts

ShackleAI Orchestrator is built around six primitives: **Companies**, **Agents**, **Tasks**, **Heartbeats**, **Governance**, and **Budgets**. Understanding how they relate makes the rest of the system straightforward.

---

## Companies

A **Company** is the top-level organizational unit. Everything in the orchestrator — agents, tasks, policies, costs — belongs to exactly one company. Think of it as a tenant namespace.

Key properties:

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | string | Display name (e.g. "Acme Corp") |
| `issue_prefix` | string | Short prefix for task identifiers (e.g. "ACME") |
| `issue_counter` | integer | Monotonically increasing, used to generate `ACME-1`, `ACME-2` |
| `budget_monthly_cents` | integer | Monthly token budget in cents (0 = unlimited) |
| `spent_monthly_cents` | integer | Running total of token spend this month |
| `status` | `active` / `inactive` | Whether the company is active |

A single orchestrator instance can host multiple companies. Each company is fully isolated — agents cannot see or interact with resources from other companies.

---

## Agents

An **Agent** is an AI worker. It has a role in the org chart, a connection method (adapter), and its own budget.

Key properties:

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `company_id` | UUID | The company this agent belongs to |
| `name` | string | Short identifier (e.g. "coder-bot") |
| `title` | string / null | Display title (e.g. "Senior Engineer") |
| `role` | `ceo` / `manager` / `worker` / `general` | Position in the org chart |
| `reports_to` | UUID / null | Parent agent ID — defines the hierarchy |
| `adapter_type` | string | How the agent is executed (see [Adapters](./adapters)) |
| `adapter_config` | JSON | Adapter-specific configuration |
| `budget_monthly_cents` | integer | Per-agent monthly budget (0 = unlimited) |
| `spent_monthly_cents` | integer | Spend this month |
| `last_heartbeat_at` | timestamp / null | When the agent last ran |
| `status` | `idle` / `active` / `paused` / `terminated` / `error` | Current state |

**Agent lifecycle:**

```
idle -> active (when heartbeat starts)
active -> idle (after heartbeat completes successfully)
active -> error (after heartbeat fails)
idle / active -> paused (manual pause via CLI or API)
paused -> idle (resume via CLI or API)
any -> terminated (terminate via CLI or API)
```

---

## Tasks (Issues)

A **Task** (stored as `Issue` in the database) is a unit of work. Tasks follow a lifecycle similar to GitHub Issues or Linear tickets.

Key properties:

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `identifier` | string | Human-readable ID (e.g. `ACME-42`) |
| `title` | string | Brief description of the work |
| `description` | string / null | Detailed description |
| `status` | see below | Current lifecycle state |
| `priority` | `critical` / `high` / `medium` / `low` | Importance |
| `assignee_agent_id` | UUID / null | Assigned agent (null = unassigned) |
| `parent_id` | UUID / null | Parent task for sub-tasks |
| `goal_id` | UUID / null | Strategic goal this task supports |
| `project_id` | UUID / null | Project this task belongs to |

**Task status lifecycle:**

```
backlog -> todo -> in_progress -> in_review -> done
                             |
                             +-> cancelled
```

**Atomic checkout:** When an agent claims a task, the system uses an atomic database update that only succeeds if the task is unassigned and in `backlog` or `todo` state. This prevents two agents from claiming the same task simultaneously. A 409 response means the task was already taken.

---

## Heartbeats

A **Heartbeat** is a single execution run of an agent. Every time an agent wakes up — whether triggered by a cron schedule or an on-demand `shackleai run` call — the orchestrator creates a `HeartbeatRun` record.

Key properties:

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Run ID, injected as `SHACKLEAI_RUN_ID` env var |
| `agent_id` | UUID | Which agent ran |
| `trigger_type` | `cron` / `manual` / `event` / `api` | What caused the run |
| `status` | `queued` / `running` / `success` / `failed` / `timeout` | Current state |
| `started_at` | timestamp | When execution began |
| `finished_at` | timestamp / null | When execution ended |
| `exit_code` | integer / null | Process exit code (0 = success) |
| `stdout_excerpt` | string / null | First 4000 characters of stdout |
| `error` | string / null | Error message if failed |
| `usage_json` | JSON / null | Token usage data if reported |

**Coalescing:** The scheduler skips a heartbeat if the agent already has one running. This prevents pile-up under slow or long-running agents.

**Scheduling:** Agents with a `cron` expression in their `adapter_config` are scheduled automatically when `shackleai start` runs. Any standard cron expression works (e.g. `"*/5 * * * *"` for every 5 minutes).

---

## Governance

The **Governance Engine** controls which tools an agent is allowed to call. The security model is **default-deny**: unless a policy explicitly allows a tool, access is denied.

A **Policy** has:

| Field | Type | Description |
|---|---|---|
| `name` | string | Human-readable label |
| `tool_pattern` | string | Glob pattern matched against tool names (e.g. `github:*`, `file:read`) |
| `action` | `allow` / `deny` / `log` | What happens when the pattern matches |
| `priority` | integer | Higher number = evaluated first |
| `agent_id` | UUID / null | Null = company-wide policy |
| `max_calls_per_hour` | integer / null | Optional rate limit |

**Resolution order:**
1. Fetch all policies for the company that apply to this agent (agent-specific + company-wide).
2. Sort by `priority` descending. At equal priority, agent-specific policies beat company-wide.
3. Match `tool_pattern` using glob (micromatch).
4. Return the first matching policy's action.
5. If no policy matches, deny.

See [Governance](./governance) for a full guide.

---

## Budgets

Budgets control token spending. Every cost-generating adapter action is recorded as a `CostEvent`.

**Budget enforcement:**
- A budget of `0` means unlimited — always within budget.
- At 80% spend, a `softAlert: true` signal is raised.
- At 100% spend, `withinBudget: false` — agents should stop incurring costs.

**Budget hierarchy:**
1. Per-agent budget: `agents.budget_monthly_cents`
2. Per-company budget: `companies.budget_monthly_cents`

Both are checked independently. An agent can be within its own budget while the company is at the limit.

**Cost data:** The `CostEvent` table records `provider`, `model`, `input_tokens`, `output_tokens`, and `cost_cents` per run. Costs are aggregated on the company and agent rows for fast budget checks, and also queryable via `/api/companies/:id/costs/by-agent`.

---

## Goals and Projects

**Goals** form a strategy hierarchy with four levels: `strategic` → `initiative` → `project` → `task`. They have owner agents and lifecycle status (`active`, `completed`, `cancelled`).

**Projects** group tasks under a goal. They have a lead agent, a target date, and a status (`active`, `completed`, `on_hold`, `cancelled`).

Tasks can be linked to both a goal and a project via `goal_id` and `project_id`.

---

## Activity Log

The **Activity Log** is an immutable audit trail. Every entity change — agent created, task status changed, policy added — is recorded with `entity_type`, `entity_id`, `actor_type`, `actor_id`, `action`, and a `changes` JSON diff. The dashboard endpoint returns the 5 most recent activity entries.
