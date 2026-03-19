---
id: configuration
title: Configuration
sidebar_label: Configuration
---

# Configuration

ShackleAI Orchestrator is configured through a JSON file written by `shackleai init`. No environment variables are required for basic local operation.

---

## Config file

**Location:** `~/.shackleai/config.json`

The config file is written by `shackleai init` and read by `shackleai start` and all CLI commands.

### Local mode

```json
{
  "mode": "local",
  "companyId": "uuid-of-your-company",
  "companyName": "Acme Corp",
  "dataDir": "default"
}
```

| Field | Description |
|---|---|
| `mode` | `"local"` — use embedded PGlite database |
| `companyId` | UUID created during `init`, used by CLI commands |
| `companyName` | Display name for the company |
| `dataDir` | PGlite data directory name (relative to the PGlite storage path) |

### Server mode

```json
{
  "mode": "server",
  "companyId": "uuid-of-your-company",
  "companyName": "Acme Corp",
  "databaseUrl": "postgresql://user:password@localhost:5432/orchestrator"
}
```

| Field | Description |
|---|---|
| `mode` | `"server"` — use external PostgreSQL |
| `databaseUrl` | Full PostgreSQL connection string |

---

## Deployment modes

### Local (PGlite)

The default. An embedded PostgreSQL-compatible database runs in-process using PGlite. No external dependencies.

**When to use:**
- Single-machine setup
- Development and testing
- Simple personal agents

**Limitations:**
- Single process only — does not support multiple workers connecting to the same database
- Data lives on disk in the working directory

### Server (PostgreSQL)

Connects to any PostgreSQL 14+ database. The schema is identical to local mode — all 12 migrations run against the target database.

**When to use:**
- Production deployments
- Multi-machine setups
- When you want to run the API server on a separate host from your agents

**Requirements:**
- PostgreSQL 14 or later
- A database and user with `CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`, `SELECT` privileges

**Setup:**

```bash
# Create the database
psql -c "CREATE DATABASE orchestrator;"
psql -c "CREATE USER orchestrator_user WITH PASSWORD 'your_password';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE orchestrator TO orchestrator_user;"

# Initialize
npx @shackleai/orchestrator init
# Select "Server" and enter: postgresql://orchestrator_user:your_password@localhost:5432/orchestrator
```

---

## Server options

The `shackleai start` command accepts:

| Flag | Default | Description |
|---|---|---|
| `--port`, `-p` | `4800` | HTTP port to listen on |

```bash
shackleai start --port 9000
```

---

## Agent adapter configuration

Each agent has an `adapter_config` JSON field. The fields available depend on the adapter type.

### Common fields (all adapters)

| Field | Type | Description |
|---|---|---|
| `cron` | string / null | Cron expression for scheduled heartbeats |
| `timeout` | integer / null | Execution timeout in seconds |

### Process adapter

```json
{
  "command": "python3",
  "args": ["/path/to/agent.py"],
  "timeout": 120,
  "cron": "*/5 * * * *"
}
```

### HTTP adapter

```json
{
  "url": "https://my-agent.example.com/heartbeat",
  "headers": { "X-Custom-Header": "value" },
  "authToken": "secret-token",
  "timeout": 60,
  "cron": "0 * * * *"
}
```

### Claude adapter

```json
{
  "prompt": "You are a code review agent. Check the latest PRs.",
  "model": "claude-opus-4-5",
  "timeout": 300,
  "cron": "0 9 * * 1-5"
}
```

### MCP adapter

```json
{
  "url": "http://localhost:3001/mcp",
  "toolName": "run_agent_step",
  "toolParams": { "persona": "engineer" },
  "timeout": 120,
  "cron": "*/10 * * * *"
}
```

---

## Cron expressions

Standard 5-field cron syntax is used (via node-cron). The orchestrator validates cron expressions at startup and logs an error for invalid ones without crashing.

| Expression | Runs |
|---|---|
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour at :00 |
| `0 9 * * 1-5` | Weekdays at 9am |
| `0 0 * * *` | Daily at midnight |

Agents without a `cron` expression in their `adapter_config` are on-demand only — they only run when `shackleai run <id>` or the wakeup API endpoint is called.

---

## Database schema

The database has 12 tables created by migrations that run automatically on `start`:

| Table | Description |
|---|---|
| `companies` | Organizational units |
| `agents` | AI workers |
| `issues` | Tasks / tickets |
| `goals` | Strategic goal hierarchy |
| `projects` | Project groupings |
| `issue_comments` | Comments on tasks |
| `policies` | Governance rules |
| `cost_events` | Token usage ledger |
| `heartbeat_runs` | Execution history |
| `activity_log` | Audit trail |
| `agent_api_keys` | API key records (hashed) |
| `license_keys` | License key records |

Migrations are idempotent and run in order. Re-running `start` on an already-migrated database is safe.
