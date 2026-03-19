---
id: governance
title: Governance
sidebar_label: Governance
---

# Governance

The Governance Engine controls which tools agents are allowed to call. The security model is **default-deny**: if no policy explicitly permits a tool, access is denied. This prevents privilege escalation from unconfigured or newly-added tools.

---

## How it works

When an agent attempts to call a tool, the engine:

1. Fetches all policies for the company that apply to this agent (both agent-specific policies and company-wide policies where `agent_id IS NULL`).
2. Sorts by `priority` descending. At equal priority, agent-specific policies take precedence over company-wide ones.
3. Matches `tool_pattern` against the tool name using glob matching (micromatch).
4. Returns the first matching policy's action.
5. If nothing matches, denies access.

**Default-deny is the key guarantee.** A new tool that no policy covers is automatically blocked until you add an allow policy.

---

## Policy structure

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Policy ID |
| `company_id` | UUID | The company this policy belongs to |
| `agent_id` | UUID / null | Null means the policy applies company-wide |
| `name` | string | Human-readable label |
| `tool_pattern` | string | Glob pattern (e.g. `github:*`, `file:read`, `*`) |
| `action` | `allow` / `deny` / `log` | What happens on match |
| `priority` | integer | Higher = evaluated first |
| `max_calls_per_hour` | integer / null | Optional rate limit (reserved for future enforcement) |

---

## Actions

**`allow`** — permits the tool call.

**`deny`** — blocks the tool call and returns a denial reason.

**`log`** — permits the tool call but flags it in the audit log (treated as allow for access purposes).

---

## Glob patterns

Tool names are namespaced strings like `github:list_issues`, `file:write`, `shell:exec`. Patterns use standard glob syntax:

| Pattern | Matches |
|---|---|
| `github:*` | All GitHub tools |
| `file:read` | Only the exact `file:read` tool |
| `file:*` | All file tools |
| `*` | Every tool |
| `shell:*` | All shell tools |

Patterns are matched using [micromatch](https://github.com/micromatch/micromatch), which supports `*`, `**`, `?`, and character ranges.

---

## Priority resolution

When multiple policies could match, the first match wins based on this order:

1. Higher `priority` number wins.
2. At equal priority, agent-specific policies (where `agent_id` is set) win over company-wide policies.

**Example — overriding a company-wide block:**

```
Priority 10: company-wide DENY shell:*
Priority 20: agent-specific ALLOW shell:exec (for agent "deploy-bot")
```

When `deploy-bot` attempts `shell:exec`, the priority-20 agent-specific allow fires first, granting access.

---

## Common policy patterns

### Allow all tools (development mode)

Use this for trusted agents in a controlled environment. Not recommended for production.

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "allow-all",
    "tool_pattern": "*",
    "action": "allow",
    "priority": 1
  }'
```

### Allow all GitHub tools, deny everything else

```bash
# Allow GitHub
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "allow-github",
    "tool_pattern": "github:*",
    "action": "allow",
    "priority": 10
  }'

# The default-deny behavior blocks everything else automatically.
# No deny-all policy is needed.
```

### Agent-specific allow with company-wide deny

```bash
# Company-wide: deny shell tools
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "deny-shell",
    "tool_pattern": "shell:*",
    "action": "deny",
    "priority": 10
  }'

# Agent-specific: allow one agent to use shell
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "deploy-bot-shell-allow",
    "agent_id": "<deploy-bot-agent-id>",
    "tool_pattern": "shell:*",
    "action": "allow",
    "priority": 20
  }'
```

### Log sensitive tool calls

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "log-database-writes",
    "tool_pattern": "db:write*",
    "action": "log",
    "priority": 15
  }'
```

---

## Managing policies via CLI

Currently policies must be managed via the REST API directly. The CLI does not have a `policy` subcommand in v0.1.0.

**List all policies:**

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/policies
```

**Create a policy:**

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-policy",
    "tool_pattern": "github:*",
    "action": "allow",
    "priority": 10
  }'
```

**Update a policy:**

```bash
curl -X PATCH http://localhost:4800/api/companies/${COMPANY_ID}/policies/${POLICY_ID} \
  -H "Content-Type: application/json" \
  -d '{ "priority": 20 }'
```

**Delete a policy:**

```bash
curl -X DELETE http://localhost:4800/api/companies/${COMPANY_ID}/policies/${POLICY_ID}
```

---

## Checking a policy programmatically

The `GovernanceEngine` from `@shackleai/core` can be used directly in your agent code:

```typescript
import { GovernanceEngine } from '@shackleai/core'

const engine = new GovernanceEngine(db)

const result = await engine.checkPolicy(
  companyId,
  agentId,
  'github:create_pr',
)

if (!result.allowed) {
  console.error(`Blocked: ${result.reason}`)
  process.exit(1)
}
```

---

## Troubleshooting

**My agent is being denied a tool I expected to be allowed.**

Check the current policies and verify the `tool_pattern` glob matches the exact tool name your agent is using:

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/policies
```

Remember that tool names are case-sensitive. `GitHub:*` does not match `github:list_issues`.

**I have conflicting policies and the wrong one is winning.**

Check priorities. The higher number wins. At equal priority, agent-specific beats company-wide. You can adjust priority via PATCH.

**I want to start permissive and tighten later.**

Add a single `allow *` policy at priority 1. Then add deny policies at higher priorities as you identify tools that should be blocked. Remove the catch-all when you are ready to enforce default-deny fully.
