---
id: faq
title: FAQ
sidebar_label: FAQ
---

# FAQ

---

## General

**What is ShackleAI Orchestrator?**

It is an open-source agent orchestrator. You install it with `npx @shackleai/orchestrator init`, and it gives your AI agents a company structure: org chart, task backlog, governance policies, token budgets, and a heartbeat scheduler. Agents check in periodically (or on-demand), pick up tasks, and run under policies that control what tools they can use.

**Who is it for?**

Developers building multi-agent systems who want structure beyond ad-hoc scripts. If you have more than one AI worker and you want to track what they are doing, what they are spending, and what they are allowed to access, ShackleAI Orchestrator provides that infrastructure.

**Is it free?**

Yes. The core orchestrator is MIT licensed. There is no usage cost for the open-source package.

**Does it require a ShackleAI account?**

No. It runs entirely locally. You can use it without an internet connection (except for the initial npm install).

---

## Installation and setup

**`npx @shackleai/orchestrator init` is failing. What do I do?**

Check your Node.js version first:

```bash
node --version
```

You need 18.12 or later. If you are on an older version, upgrade via [nvm](https://github.com/nvm-sh/nvm) or the [official installer](https://nodejs.org).

**Can I re-run `init` if I made a mistake?**

Yes. Running `init` again creates a new company record and overwrites `~/.shackleai/config.json`. Your old data in the database is preserved (the old company record remains).

**Where is my data stored in local mode?**

PGlite stores data in a directory relative to where the orchestrator server process runs. The `dataDir` value in your config (default: `"default"`) is the directory name. The data lives in the working directory of the `shackleai start` process.

---

## Agents and adapters

**How do I connect my existing Python agent?**

Use the `process` adapter:

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-python-agent",
    "role": "worker",
    "adapter_type": "process",
    "adapter_config": {
      "command": "python3",
      "args": ["/path/to/my_agent.py"],
      "cron": "*/10 * * * *"
    }
  }'
```

Your Python script receives `SHACKLEAI_AGENT_ID`, `SHACKLEAI_RUN_ID`, and (if assigned) `SHACKLEAI_TASK_ID` as environment variables.

**Can I run an agent without a cron schedule?**

Yes. Simply do not include a `cron` key in `adapter_config`. The agent will only run when you call `shackleai run <id>` or POST to `/api/companies/:id/agents/:agentId/wakeup`.

**What happens if my agent takes longer than the timeout?**

The adapter sends SIGTERM to the process, waits 5 seconds for a graceful shutdown, then sends SIGKILL. The heartbeat run is recorded as `failed` with exit code `124` and the stderr includes the timeout message.

**Can two agents pick up the same task at the same time?**

No. Task checkout is atomic — only one agent can claim a task. If a second agent tries to check out the same task, the API returns `409 Conflict`.

---

## Governance

**My agent keeps getting denied. I set up an allow policy but it is not working.**

Check two things:

1. Is the tool name an exact match for your glob pattern? Tool names are case-sensitive. Use the exact string your agent passes to `checkPolicy`.
2. Is there a higher-priority deny policy overriding your allow? List all policies and sort by priority descending.

```bash
curl http://localhost:4800/api/companies/${COMPANY_ID}/policies
```

**What is default-deny?**

If no policy matches a tool call, access is denied. This is intentional — it prevents unconfigured tools from being accessible by default. Add an explicit `allow` policy for each tool your agents need.

**Can I disable governance for development?**

Add a company-wide `allow *` policy at priority 1:

```bash
curl -X POST http://localhost:4800/api/companies/${COMPANY_ID}/policies \
  -H "Content-Type: application/json" \
  -d '{ "name": "dev-allow-all", "tool_pattern": "*", "action": "allow", "priority": 1 }'
```

Delete this policy before going to production.

---

## Costs and budgets

**How is cost tracked?**

Adapters that report token usage (Claude, HTTP, MCP) can include a `__shackleai_result__` JSON block in their output with `usage.costCents`. The orchestrator records these as `CostEvent` rows and increments `spent_monthly_cents` on the agent and company records.

**What happens when an agent exceeds its budget?**

The `CostTracker.checkBudget` method returns `withinBudget: false` at 100% spend. Enforcement is in your adapter code — the orchestrator surfaces budget status but does not automatically stop agents. Build budget checks into your agent logic using the `/costs/by-agent` endpoint.

**How do I reset monthly spend?**

Monthly reset is not automatic in v0.1.0. Use the `CostTracker.resetMonthlySpend` method programmatically, or update the database directly:

```sql
UPDATE agents SET spent_monthly_cents = 0 WHERE company_id = 'your-company-id';
UPDATE companies SET spent_monthly_cents = 0 WHERE id = 'your-company-id';
```

---

## Database

**Can I use a managed PostgreSQL service like RDS or Supabase?**

Yes. Use server mode and set `databaseUrl` to the connection string provided by your managed database service. All migrations run automatically.

**Can I inspect the database directly?**

In local (PGlite) mode, the database is stored in a custom file format and is not directly accessible with standard PostgreSQL tools. In server mode, you can connect with any PostgreSQL client (e.g. `psql`, TablePlus, DBeaver).

**How do I back up my data?**

In server mode: use standard PostgreSQL backup tools (`pg_dump`).

In local mode: copy the PGlite data directory. Stop the server first to avoid corruption.

---

## Multiple companies

**Can I manage multiple AI teams from one orchestrator?**

Yes. Run `npx @shackleai/orchestrator init` to create a second company record. However, the CLI defaults to the company in your config file. To work with a different company, update `companyId` in `~/.shackleai/config.json` or use the REST API directly.

---

## Contributing

**I found a bug. Where do I report it?**

Open an issue at https://github.com/shackleai/orchestrator/issues.

**I want to add a new adapter. Where do I start?**

Implement the `AdapterModule` interface from `@shackleai/core`. See `packages/core/src/adapters/adapter.ts` for the interface definition and any existing adapter for a reference implementation.
