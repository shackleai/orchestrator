# CLI Reference

The `shackleai` CLI is installed via `npm` / `npx` as `@shackleai/orchestrator`. All commands connect to the running server at `http://localhost:4800` unless you override the port.

---

## Installation

```bash
# Run without installing (recommended for first-time use)
npx @shackleai/orchestrator <command>

# Install globally
npm install -g @shackleai/orchestrator

# After global install
shackleai <command>
```

---

## Global options

```
--version    Print the version number
--help       Show help for any command
```

---

## shackleai init

Interactive setup wizard. Run this once to configure a new orchestrator.

```bash
shackleai init
```

**What it does:**

1. Asks for deployment mode: `Local` (embedded PGlite) or `Server` (external PostgreSQL).
2. Asks for company name and optional mission.
3. If `Server` mode: asks for `DATABASE_URL`.
4. Runs all database migrations.
5. Creates the company record.
6. Optionally creates the first agent.
7. Writes config to `~/.shackleai/config.json`.

**Config file location:** `~/.shackleai/config.json`

**Config schema:**

```json
{
  "mode": "local",
  "companyId": "uuid",
  "companyName": "Acme Corp",
  "dataDir": "default"
}
```

For server mode:

```json
{
  "mode": "server",
  "companyId": "uuid",
  "companyName": "Acme Corp",
  "databaseUrl": "postgresql://user:pass@host:5432/dbname"
}
```

---

## shackleai start

Start the local API server.

```bash
shackleai start [--port <number>]
```

**Options:**

| Option | Default | Description |
|---|---|---|
| `--port`, `-p` | `4800` | Port to listen on |

**What it does:**
- Reads `~/.shackleai/config.json`.
- Connects to the database (PGlite or PostgreSQL based on mode).
- Runs any pending migrations.
- Starts the Hono HTTP server.

The server must be running for all other CLI commands and for agent heartbeats to work.

---

## shackleai agent

Manage agents.

### shackleai agent list

```bash
shackleai agent list
```

Displays a table of all agents with columns: ID (truncated), Name, Role, Status, Adapter, Last Heartbeat.

### shackleai agent create

```bash
shackleai agent create
```

Interactive wizard to create a new agent. Prompts for name, role, and adapter type.

### shackleai agent pause

```bash
shackleai agent pause <id>
```

Sets the agent's status to `paused`. Paused agents do not execute scheduled heartbeats.

**Arguments:**

| Argument | Description |
|---|---|
| `<id>` | Agent UUID |

### shackleai agent resume

```bash
shackleai agent resume <id>
```

Sets the agent's status back to `idle`. The agent will resume its cron schedule on the next tick.

### shackleai agent terminate

```bash
shackleai agent terminate <id>
```

Sets the agent's status to `terminated`. Terminated agents cannot be reactivated via the CLI.

---

## shackleai task

Manage tasks.

### shackleai task list

```bash
shackleai task list
```

Displays a table with: ID (truncated), Identifier (e.g. ACME-5), Title (truncated at 40 chars), Status, Priority, Assignee ID (truncated).

### shackleai task create

```bash
shackleai task create
```

Interactive wizard. Prompts for title, optional description, and priority.

### shackleai task assign

```bash
shackleai task assign <taskId> <agentId>
```

Atomically assigns a task to an agent. Sets status to `in_progress`. Fails with an error if the task is already assigned to another agent.

**Arguments:**

| Argument | Description |
|---|---|
| `<taskId>` | Task UUID |
| `<agentId>` | Agent UUID |

### shackleai task complete

```bash
shackleai task complete <taskId>
```

Sets the task status to `done`.

---

## shackleai run

Trigger an immediate on-demand agent wakeup.

```bash
shackleai run <agentId>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<agentId>` | Agent UUID |

**Output:**

```
Triggering wakeup for agent <agentId>...
Triggered: true
Agent:     coder-bot (uuid)
Status:    idle
Heartbeat: 3/16/2026, 12:30:00 PM
```

This updates `last_heartbeat_at` on the agent record. If the agent has an adapter that actually executes a process, use the API's `/wakeup` endpoint in a future version that integrates with the scheduler.

---

## shackleai doctor

Run health checks and diagnostics.

```bash
shackleai doctor
```

**Checks performed:**

1. Config file exists at `~/.shackleai/config.json`.
2. Server is reachable at `http://localhost:4800/api/health`.
3. Database is connected (via dashboard metrics endpoint).

**Output:**

```
ShackleAI Orchestrator v0.1.0 — Doctor

Config path: /Users/yourname/.shackleai/config.json
[OK]   Config loaded
       Company: Acme Corp (uuid)
       Mode:    local
[OK]   Server reachable (v0.1.0)
[OK]   Database connected
       Agents: 2
       Tasks:  8 (3 open, 5 completed)

All checks passed.
```

---

## shackleai upgrade

Manage your license key.

### Show license status (default)

```bash
shackleai upgrade
# or
shackleai upgrade --status
```

**Output:**

```
License status:
  Tier:      free
  Valid:     indefinite
  Validated: never
```

### Activate a license key

```bash
shackleai upgrade --key <your-license-key>
```

**Output:**

```
Activating license key...
License activated.
  Tier:  pro
  Valid: 1/1/2027
```

**Options:**

| Option | Description |
|---|---|
| `--key <key>` | License key to activate |
| `--status` | Show current license status |

---

## Environment and config

The CLI reads its active company ID and server connection settings from `~/.shackleai/config.json`. There is no way to target a different company from the CLI without editing this file or re-running `shackleai init`.

To target a specific API server (e.g. a remote deployment), the CLI currently only supports the local default (`http://localhost:4800`). Use the API directly for remote operations.
