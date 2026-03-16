# ShackleAI Orchestrator

**The Operating System for AI Agents** — an open-source orchestrator that gives your AI workforce a company org chart, a task tracker, a policy engine, and a cost ledger.

```
npx @shackleai/orchestrator init
```

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@shackleai/orchestrator)](https://www.npmjs.com/package/@shackleai/orchestrator)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.12-brightgreen)](https://nodejs.org)

---

## What is it?

ShackleAI Orchestrator gives structure to multi-agent systems. Instead of wiring agents together with ad-hoc scripts, you declare them like employees: they have roles, report to one another, pick up tasks from a shared backlog, check in via heartbeats, and operate under governance policies that control what tools they can call.

Everything is stored locally in an embedded database — no cloud account required.

---

## Quickstart

**Prerequisites:** Node.js 18.12+

```bash
# Initialize a new orchestrator (interactive wizard)
npx @shackleai/orchestrator init

# Start the local API server (default port 4800)
npx @shackleai/orchestrator start

# Run diagnostics
npx @shackleai/orchestrator doctor
```

The `init` wizard asks three questions: deployment mode (local embedded database or external PostgreSQL), company name, and whether to create a first agent. It writes a config file to `~/.shackleai/config.json` and runs all database migrations automatically.

---

## Features

| Feature | What it does |
|---|---|
| **Companies** | Organizational units — each has its own agent pool, task backlog, and monthly budget |
| **Agents** | AI workers with roles (`ceo`, `manager`, `worker`), org-chart hierarchy, and heartbeat tracking |
| **Tasks** | GitHub-style issue tracker — auto-numbered identifiers (e.g. `ACME-42`), priorities, status lifecycle |
| **Heartbeats** | Scheduled (cron) and on-demand agent wakeups with full run history and stdout capture |
| **Governance** | Default-deny policy engine — glob-pattern tool access control with priority resolution |
| **Budgets** | Monthly token cost budgets per agent and per company — soft alert at 80%, hard stop at 100% |
| **Adapters** | Six execution backends: Process, HTTP webhook, Claude Code CLI, MCP, OpenClaw, CrewAI |
| **REST API** | Full Hono-based HTTP API served locally — queryable by agents and dashboards |
| **Activity Log** | Immutable audit trail of every entity change |

---

## Architecture

```
npx @shackleai/orchestrator init
         |
         v
  ~/.shackleai/config.json
         |
         v
npx @shackleai/orchestrator start
         |
         v
+--------------------------------+
|   Hono HTTP API (port 4800)    |
|  /api/companies/:id/agents     |
|  /api/companies/:id/issues     |
|  /api/companies/:id/policies   |
|  /api/companies/:id/costs      |
|  /api/companies/:id/heartbeats |
+--------------------------------+
         |
         v
+------------------------+   +------------------+
|   GovernanceEngine     |   |   CostTracker    |
|   (default-deny,       |   |   (per-agent     |
|    glob patterns)      |   |    budget ledger)|
+------------------------+   +------------------+
         |
         v
+--------------------------------------------+
|              Scheduler                     |
|  cron schedules + on-demand wakeups        |
|  coalescing: skips if agent already runs   |
+--------------------------------------------+
         |
         v
+--------------------------------------------------+
|               Adapter Layer                      |
| Process | HTTP | Claude | MCP | OpenClaw | CrewAI|
+--------------------------------------------------+
         |
         v
+-----------------------------------+
|   @shackleai/db                   |
|   PGlite (local) or PostgreSQL    |
|   12 migrations, fully typed      |
+-----------------------------------+
```

**Monorepo packages:**

| Package | npm | Purpose |
|---|---|---|
| `apps/cli` | `@shackleai/orchestrator` | CLI entrypoint — `npx` |
| `packages/core` | `@shackleai/core` | Adapters, governance, scheduler, cost tracker |
| `packages/db` | `@shackleai/db` | Database layer, migrations, PGlite + PostgreSQL |
| `packages/shared` | `@shackleai/shared` | TypeScript types, constants, Zod validators |

---

## Comparison

| Capability | DIY Scripts | LangChain | CrewAI | AutoGen | ShackleAI Orchestrator |
|---|---|---|---|---|---|
| Multi-agent task routing | Manual | Via chains | Yes | Yes | Yes |
| Org-chart hierarchy | No | No | Roles only | No | Yes (CEO / Manager / Worker) |
| Governance (tool access control) | No | No | No | No | Yes — default-deny |
| Monthly cost budgets | No | No | No | No | Yes — per agent + company |
| Heartbeat scheduling (cron) | Manual | No | No | No | Yes |
| Local-first (no cloud account) | Yes | Partial | No | No | Yes |
| REST API for agents to query | No | No | No | No | Yes |
| Audit log | No | No | No | No | Yes |
| Open source (MIT) | N/A | Yes | Yes | Yes | Yes |

---

## Deployment modes

**Local** — uses an embedded PGlite database. No external dependencies. Data lives in your working directory. Perfect for single-machine setups and development.

**Server** — connects to an external PostgreSQL database. Use this for production or multi-machine setups.

```bash
# Local mode (default)
npx @shackleai/orchestrator init
# Select "Local" when prompted

# Server mode
npx @shackleai/orchestrator init
# Select "Server" and enter DATABASE_URL
```

---

## CLI Reference

```bash
shackleai init                   # Interactive setup wizard
shackleai start [--port 4800]    # Start the API server

shackleai agent list             # List all agents
shackleai agent create           # Create a new agent (interactive)
shackleai agent pause <id>       # Pause an agent
shackleai agent resume <id>      # Resume a paused agent
shackleai agent terminate <id>   # Terminate an agent

shackleai task list              # List all tasks
shackleai task create            # Create a task (interactive)
shackleai task assign <taskId> <agentId>   # Assign task to agent
shackleai task complete <taskId>           # Mark task as done

shackleai run <agentId>          # Trigger on-demand agent wakeup
shackleai doctor                 # Run diagnostics
shackleai upgrade [--key <key>]  # Activate license key
shackleai upgrade --status       # Show license status
```

---

## Upgrade

```bash
# Check current version
npx @shackleai/orchestrator --version

# Upgrade to the latest version
npx @shackleai/orchestrator@latest start
```

---

## Documentation

- [Getting Started](docs/getting-started.md) — 5-minute tutorial
- [Concepts](docs/concepts.md) — Companies, agents, tasks, heartbeats, governance, budgets
- [Adapters](docs/adapters.md) — Process, HTTP, Claude, MCP adapter guide
- [Governance](docs/governance.md) — Policy engine and tool access control
- [API Reference](docs/api-reference.md) — Full REST API with curl examples
- [CLI Reference](docs/cli-reference.md) — All CLI commands
- [Configuration](docs/configuration.md) — Config file, env vars, deployment modes
- [Deployment](docs/deployment.md) — Local, Docker, VPS, cloud
- [FAQ](docs/faq.md) — Common questions

---

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

**Quick setup:**

```bash
git clone https://github.com/shackleai/orchestrator.git
cd orchestrator
pnpm install
pnpm build && pnpm test
```

---

## License

[MIT](LICENSE) — Copyright (c) 2026 shackleai
