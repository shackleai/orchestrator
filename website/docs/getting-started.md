---
id: getting-started
title: Getting Started
sidebar_label: Getting Started
slug: /getting-started
---

# Getting Started

Get from zero to a running agent orchestrator in under 5 minutes.

---

## Prerequisites

- **Node.js** 18.12 or later (`node --version`)
- **npm** 7 or later (comes with Node.js)

That is all. No cloud account, no Docker, no database to install for local mode.

---

## Step 1 — Initialize

Run the setup wizard:

```bash
npx @shackleai/orchestrator init
```

The wizard asks:

1. **Deployment mode** — choose `Local` for an embedded database (recommended for getting started) or `Server` if you have an external PostgreSQL instance.
2. **Company name** — the name of your AI organization (e.g. "Acme Corp"). This becomes the prefix for task identifiers: `ACME-1`, `ACME-2`, etc.
3. **Company mission** — optional description.
4. **Create your first agent?** — choose `Yes` and fill in a name, role, and adapter type.

When it finishes you will see:

```
Setup complete! Run `shackleai start` to launch the server.
```

The wizard has written a config file to `~/.shackleai/config.json` and run all 12 database migrations.

---

## Step 2 — Start the server

```bash
npx @shackleai/orchestrator start
```

Output:

```
ShackleAI Orchestrator v0.1.0
Company: Acme Corp
Mode:    local

Dashboard: http://localhost:4800
Health:    http://localhost:4800/api/health
```

The server is now running on port 4800. Keep this terminal open.

To use a different port:

```bash
npx @shackleai/orchestrator start --port 9000
```

---

## Step 3 — Verify with doctor

Open a new terminal and run:

```bash
npx @shackleai/orchestrator doctor
```

Expected output:

```
ShackleAI Orchestrator v0.1.0 — Doctor

Config path: /Users/yourname/.shackleai/config.json
[OK]   Config loaded
       Company: Acme Corp (uuid...)
       Mode:    local
[OK]   Server reachable (v0.1.0)
[OK]   Database connected
       Agents: 1
       Tasks:  0 (0 open, 0 completed)

All checks passed.
```

---

## Step 4 — Create a task

```bash
npx @shackleai/orchestrator task create
```

Follow the prompts to enter a title, optional description, and priority. The task receives an auto-numbered identifier like `ACME-1`.

List all tasks:

```bash
npx @shackleai/orchestrator task list
```

---

## Step 5 — Assign and trigger an agent

List your agents to get the agent ID:

```bash
npx @shackleai/orchestrator agent list
```

Assign the task to the agent (replace the IDs with your actual UUIDs):

```bash
npx @shackleai/orchestrator task assign <taskId> <agentId>
```

Trigger the agent to run immediately:

```bash
npx @shackleai/orchestrator run <agentId>
```

---

## Step 6 — Check the API directly

The local API is a standard HTTP server. You can query it with curl:

```bash
# Health check
curl http://localhost:4800/api/health

# List agents
COMPANY_ID=$(cat ~/.shackleai/config.json | python3 -c "import sys,json; print(json.load(sys.stdin)['companyId'])")
curl "http://localhost:4800/api/companies/${COMPANY_ID}/agents"

# Dashboard metrics
curl "http://localhost:4800/api/companies/${COMPANY_ID}/dashboard"
```

---

## What's next

- Read [Concepts](./concepts) to understand how companies, agents, tasks, and governance fit together.
- Read [Adapters](./adapters) to connect your agents to Claude Code CLI, HTTP webhooks, MCP servers, or any subprocess.
- Read [Governance](./governance) to set up tool access policies for your agents.
- Read [API Reference](./api-reference) for the complete HTTP API.
