# Plan: ShackleAI Open-Source Orchestrator

## Context

**Problem**: ShackleAI has 11 core services, 55 DB migrations, and a full dashboard — but zero viral adoption. Paperclip (25K GitHub stars in 2 weeks) proves massive demand for "agent orchestration" tooling. ShackleAI needs an immediately consumable open-source product that drives awareness and funnels users to the managed platform.

**Solution**: Create `shackleai/orchestrator` — an open-source, npm-publishable agent orchestrator that works standalone via `npx @shackleai/orchestrator init`. Free tier drives adoption; CTAs funnel to ShackleAI managed platform for premium features (Vault, LLM Gateway, ToolCloud, Billing).

**Key constraint**: No code duplication. The orchestrator is the shared foundation; the platform imports from it via npm packages.

---

## Architecture Decision: Monorepo with Shared Packages

**Pattern**: Cal.com / Supabase / Infisical model.

```
shackleai/orchestrator  (PUBLIC, MIT license)
  └── packages/         shared npm packages
  └── apps/cli          the npx entry point + Hono server
  └── apps/dashboard    React + Vite standalone dashboard

shackleai/platform      (PRIVATE, existing repo)
  └── depends on @shackleai/* packages from npm
  └── adds: Vault, LLM Gateway, ToolCloud, Billing, Enterprise Auth
```

**Why this works**:
- Orchestrator repo is fully open-source — builds community
- Platform repo stays private — protects premium IP
- Shared packages published to npm — single source of truth
- No fork merge hell, no build-time stripping, no dual maintenance

---

## npm vs npx — How Users Install

```
# Quick start (no global install — downloads and runs once)
npx @shackleai/orchestrator init

# Install globally (persistent command)
npm install -g @shackleai/orchestrator
shackleai init
shackleai start

# Both produce identical results. npx is for first-time try, npm -g is for daily use.
```

---

## 4 npm Packages

| Package | Contains | Equivalent |
|---------|----------|-----------|
| `@shackleai/orchestrator` | CLI + Hono server (the `npx` entry point) | `paperclipai` |
| `@shackleai/core` | Governance + Runner + Adapters + Scheduler + Cost Tracker + Observatory | `@paperclipai/server` |
| `@shackleai/db` | PGlite + PostgreSQL providers + migrations | `@paperclipai/db` |
| `@shackleai/shared` | Types + Zod validators + constants | `@paperclipai/shared` |

Dashboard UI is built as static assets and bundled inside `@shackleai/orchestrator` (not a separate npm package).

---

## Package Structure

```
shackleai/orchestrator/                  # PUBLIC repo, MIT license
├── pnpm-workspace.yaml
├── turbo.json                           # Turborepo build orchestration
├── package.json                         # Root workspace
├── LICENSE                              # MIT
├── README.md                            # Hero README
├── CONTRIBUTING.md                      # Contributor guide
├── CLAUDE.md                            # Claude Code operating instructions
│
├── packages/
│   ├── shared/                          # @shackleai/shared
│   │   ├── src/
│   │   │   ├── types.ts                 # Agent, Issue, Policy, CostEvent, HeartbeatRun
│   │   │   ├── validators.ts            # Zod schemas for all entities
│   │   │   ├── constants.ts             # Status enums, priority levels, adapter types
│   │   │   └── index.ts
│   │   ├── __tests__/                   # Unit tests
│   │   └── package.json
│   │
│   ├── db/                              # @shackleai/db
│   │   ├── src/
│   │   │   ├── provider.ts              # DatabaseProvider interface (abstract)
│   │   │   ├── pglite-provider.ts       # Embedded PGlite (zero-config local)
│   │   │   ├── pg-provider.ts           # External PostgreSQL (production)
│   │   │   ├── migrations/
│   │   │   │   ├── index.ts             # Migration runner
│   │   │   │   ├── 001_companies.ts     # Company table
│   │   │   │   ├── 002_agents.ts        # Agent table + org tree
│   │   │   │   ├── 003_issues.ts        # Task/issue table
│   │   │   │   ├── 004_goals.ts         # Goal hierarchy
│   │   │   │   ├── 005_projects.ts      # Projects + milestones
│   │   │   │   ├── 006_comments.ts      # Issue comments
│   │   │   │   ├── 007_policies.ts      # Governance policies
│   │   │   │   ├── 008_costs.ts         # Cost events
│   │   │   │   ├── 009_heartbeats.ts    # Heartbeat runs
│   │   │   │   ├── 010_activity.ts      # Activity audit log
│   │   │   │   ├── 011_api_keys.ts      # Agent API keys
│   │   │   │   └── 012_license_keys.ts  # ShackleAI license key validation
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   └── package.json
│   │
│   └── core/                            # @shackleai/core
│       ├── src/
│       │   ├── governance/
│       │   │   ├── engine.ts            # Policy evaluation (glob match + default-deny)
│       │   │   ├── rate-limiter.ts      # Per-policy rate limiting
│       │   │   └── index.ts
│       │   ├── runner/
│       │   │   ├── executor.ts          # Heartbeat execution engine
│       │   │   ├── session.ts           # Session state (resume across heartbeats)
│       │   │   └── index.ts
│       │   ├── adapters/
│       │   │   ├── adapter.ts           # AdapterModule interface
│       │   │   ├── process.ts           # Shell process adapter (any CLI agent)
│       │   │   ├── http.ts              # HTTP webhook adapter
│       │   │   ├── claude.ts            # Claude Code adapter
│       │   │   ├── mcp.ts              # MCP server tool adapter
│       │   │   └── index.ts
│       │   ├── observatory.ts           # Event logging (fire-and-forget)
│       │   ├── scheduler.ts             # Heartbeat cron scheduling
│       │   ├── cost-tracker.ts          # Token budget tracking
│       │   ├── license.ts               # ShackleAI license key validation
│       │   └── index.ts
│       ├── __tests__/                   # Unit + integration tests
│       └── package.json
│
├── apps/
│   ├── cli/                             # @shackleai/orchestrator (npx entry point)
│   │   ├── src/
│   │   │   ├── index.ts                 # Commander.js CLI entry
│   │   │   ├── commands/
│   │   │   │   ├── init.ts              # Interactive setup wizard
│   │   │   │   ├── start.ts             # Launch server + dashboard
│   │   │   │   ├── agent.ts             # agent list|create|pause|resume|terminate
│   │   │   │   ├── task.ts              # task list|create|assign|complete
│   │   │   │   ├── run.ts               # Manual heartbeat trigger
│   │   │   │   ├── doctor.ts            # Health diagnostics
│   │   │   │   └── upgrade.ts           # License key activation + CTA
│   │   │   ├── server/
│   │   │   │   ├── index.ts             # Hono app factory
│   │   │   │   ├── routes/
│   │   │   │   │   ├── companies.ts     # Company CRUD
│   │   │   │   │   ├── agents.ts        # Agent CRUD + lifecycle
│   │   │   │   │   ├── issues.ts        # Task CRUD + checkout
│   │   │   │   │   ├── policies.ts      # Governance CRUD
│   │   │   │   │   ├── costs.ts         # Cost tracking
│   │   │   │   │   ├── heartbeats.ts    # Execution logs
│   │   │   │   │   ├── activity.ts      # Audit trail
│   │   │   │   │   └── dashboard.ts     # Metrics endpoint
│   │   │   │   └── middleware/
│   │   │   │       ├── auth.ts          # Bearer token + license key
│   │   │   │       └── company-scope.ts # Company isolation
│   │   │   └── config.ts               # ~/.shackleai/ config management
│   │   ├── __tests__/
│   │   └── package.json                 # bin: { "shackleai": "./dist/index.js" }
│   │
│   └── dashboard/                       # React dashboard (built into static assets)
│       ├── src/
│       │   ├── pages/
│       │   │   ├── overview.tsx          # Metrics + quick actions
│       │   │   ├── agents.tsx            # Agent list + status
│       │   │   ├── agent-detail.tsx      # Config, logs, heartbeat history
│       │   │   ├── tasks.tsx             # Task list with filters
│       │   │   ├── activity.tsx          # Audit log feed
│       │   │   ├── costs.tsx             # Budget dashboards
│       │   │   └── settings.tsx          # Config + upgrade CTA
│       │   ├── components/               # shadcn/ui + Tailwind
│       │   └── App.tsx
│       ├── vite.config.ts
│       └── package.json
│
└── docs/                                 # User documentation
    ├── README.md                         # Docs index
    ├── getting-started.md                # 5-minute quickstart
    ├── concepts.md                       # Companies, agents, tasks, heartbeats
    ├── adapters.md                       # How to connect any agent
    ├── governance.md                     # Policy engine guide
    ├── api-reference.md                  # Full REST API docs
    ├── cli-reference.md                  # All CLI commands
    ├── configuration.md                  # Config file + env vars
    ├── deployment.md                     # Docker, VPS, cloud
    ├── faq.md                            # Common questions
    └── upgrade-to-platform.md            # Why upgrade to ShackleAI
```

---

## Tech Stack (Standalone Orchestrator)

| Layer | Technology | Why |
|-------|-----------|-----|
| CLI | Commander.js + @clack/prompts | Industry standard, interactive wizards |
| Server | Hono | 14KB, Web Standards, perfect for embedded server |
| Dashboard | React 19 + Vite + shadcn/ui + Tailwind | Same component library as platform |
| Database (dev) | PGlite (embedded PostgreSQL WASM) | Zero-config, ~3MB, full SQL support |
| Database (prod) | PostgreSQL 16 | User provides connection string |
| ORM | Drizzle | Type-safe, works with PGlite and pg |
| Validation | Zod | Already used in platform |
| Build | Turborepo + pnpm workspaces | Fast, caching, monorepo standard |

---

## Feature Set: Open-Source vs Platform

### Open-Source (shackleai/orchestrator) — FREE

| Feature | Description |
|---------|-------------|
| **Agent Management** | Create, configure, pause, resume, terminate agents |
| **Org Structure** | Hierarchical reporting (CEO → managers → agents) |
| **Task System** | Issues with status workflow, single assignee, atomic checkout |
| **Heartbeat Scheduler** | Cron-based + event-triggered agent wake-ups |
| **Session Resumption** | Agents resume context across heartbeats |
| **Basic Governance** | Allow/deny policies per agent per tool |
| **Cost Tracking** | Per-agent token budgets with soft/hard limits |
| **Activity Audit Log** | Immutable log of all mutations |
| **Adapters** | Process, HTTP, Claude, MCP (4 built-in) |
| **Multi-Company** | Run multiple isolated companies |
| **Dashboard** | Web UI for management, monitoring, costs |
| **CLI** | `npx @shackleai/orchestrator init/start/agent/task` |
| **Zero-Config Setup** | PGlite embedded DB, one command start |
| **Comments** | Threaded comments on tasks (inter-agent communication) |
| **Goal Hierarchy** | Strategic → initiative → project → task tracing |

### Platform-Only (shackleai.com) — PAID

| Feature | Why Premium |
|---------|------------|
| **Vault** | AES-256-GCM credential encryption, OAuth flows, rotation |
| **LLM Gateway** | Multi-provider routing, PII scrubbing, complexity classification |
| **ToolCloud** | Docker container orchestration for MCP servers |
| **Registry** | 1,352+ MCP server catalog with one-click install |
| **Billing** | Stripe, seat-based, metering, dunning |
| **Enterprise Auth** | SSO, RBAC with ABAC conditions, time restrictions |
| **Killswitch** | Emergency access revocation |
| **Approval Workflows** | Multi-step approval gates with escalation |
| **S3 Audit Export** | Compliance-grade audit trail export |
| **Memory Cloud** | Managed semantic search with pgvector embeddings |
| **Runtime** | Deploy agents from GitHub/zip with auto-Dockerfile |
| **Team Management** | Multi-user, seat-based, shared policies |

---

## Database Schema (Orchestrator — 12 core tables)

```sql
-- Companies
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  issue_prefix TEXT NOT NULL UNIQUE,
  issue_counter INT NOT NULL DEFAULT 0,
  budget_monthly_cents INT DEFAULT 0,
  spent_monthly_cents INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agents
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  title TEXT,
  role TEXT DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'idle',
  reports_to UUID REFERENCES agents(id),
  capabilities TEXT,
  adapter_type TEXT NOT NULL,
  adapter_config JSONB DEFAULT '{}',
  budget_monthly_cents INT DEFAULT 0,
  spent_monthly_cents INT DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Issues (Tasks)
CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  identifier TEXT NOT NULL UNIQUE,
  issue_number INT NOT NULL,
  parent_id UUID REFERENCES issues(id),
  goal_id UUID REFERENCES goals(id),
  project_id UUID REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT DEFAULT 'medium',
  assignee_agent_id UUID REFERENCES agents(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Goals
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  parent_id UUID REFERENCES goals(id),
  title TEXT NOT NULL,
  description TEXT,
  level TEXT DEFAULT 'task',
  status TEXT DEFAULT 'active',
  owner_agent_id UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  goal_id UUID REFERENCES goals(id),
  lead_agent_id UUID REFERENCES agents(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',
  target_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Issue Comments
CREATE TABLE issue_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id),
  author_agent_id UUID REFERENCES agents(id),
  content TEXT NOT NULL,
  parent_id UUID REFERENCES issue_comments(id),
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Policies
CREATE TABLE policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID REFERENCES agents(id),
  name TEXT NOT NULL,
  tool_pattern TEXT NOT NULL,
  action TEXT NOT NULL,
  priority INT DEFAULT 0,
  max_calls_per_hour INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost Events
CREATE TABLE cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID REFERENCES agents(id),
  issue_id UUID REFERENCES issues(id),
  provider TEXT,
  model TEXT,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_cents INT DEFAULT 0,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- Heartbeat Runs
CREATE TABLE heartbeat_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  exit_code INT,
  error TEXT,
  usage_json JSONB,
  session_id_before TEXT,
  session_id_after TEXT,
  stdout_excerpt TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity Log
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent API Keys
CREATE TABLE agent_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  key_hash TEXT NOT NULL,
  label TEXT,
  status TEXT DEFAULT 'active',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Endpoints (Hono Server)

```
# Companies
GET    /api/companies
POST   /api/companies
GET    /api/companies/:id
PATCH  /api/companies/:id

# Agents
GET    /api/companies/:id/agents
POST   /api/companies/:id/agents
GET    /api/companies/:id/agents/:agentId
PATCH  /api/companies/:id/agents/:agentId
POST   /api/companies/:id/agents/:agentId/pause
POST   /api/companies/:id/agents/:agentId/resume
POST   /api/companies/:id/agents/:agentId/terminate
POST   /api/companies/:id/agents/:agentId/wakeup
POST   /api/companies/:id/agents/:agentId/api-keys

# Issues (Tasks)
GET    /api/companies/:id/issues
POST   /api/companies/:id/issues
GET    /api/companies/:id/issues/:issueId
PATCH  /api/companies/:id/issues/:issueId
POST   /api/companies/:id/issues/:issueId/checkout
POST   /api/companies/:id/issues/:issueId/release
POST   /api/companies/:id/issues/:issueId/comments
GET    /api/companies/:id/issues/:issueId/comments

# Goals & Projects
GET    /api/companies/:id/goals
POST   /api/companies/:id/goals
GET    /api/companies/:id/projects
POST   /api/companies/:id/projects

# Policies
GET    /api/companies/:id/policies
POST   /api/companies/:id/policies
PATCH  /api/companies/:id/policies/:policyId
DELETE /api/companies/:id/policies/:policyId

# Cost Tracking
GET    /api/companies/:id/costs
GET    /api/companies/:id/costs/by-agent
POST   /api/companies/:id/costs/events

# Heartbeats
GET    /api/companies/:id/heartbeats
GET    /api/companies/:id/heartbeats/:runId
GET    /api/companies/:id/heartbeats/:runId/logs

# Activity Log
GET    /api/companies/:id/activity

# Dashboard Metrics
GET    /api/companies/:id/dashboard

# Static Dashboard
GET    /*   → serves React SPA
```

---

## License Key Management (Upgrade Path)

Free orchestrator works fully standalone. When users want premium features:

```bash
shackleai upgrade --key sk_shackle_live_xxxxxxxxxxxx
```

- Key stored in `~/.shackleai/config.json` + `license_keys` DB table
- Validated against `api.shackleai.com/v1/license/validate`
- Re-validated every 24h, 7-day offline grace period
- **NEVER phones home without explicit license key set**

---

## Testing Strategy

| Package | Test Type | Framework |
|---------|-----------|-----------|
| `@shackleai/shared` | Unit | Vitest |
| `@shackleai/db` | Unit + Integration | Vitest |
| `@shackleai/core` | Unit + Integration | Vitest |
| `@shackleai/orchestrator` | Unit + E2E | Vitest + Playwright |
| Dashboard | E2E | Playwright |

**Coverage targets**: core 80%+, db 70%+, orchestrator 60%+

---

## Implementation Roadmap

### v0.1.0 — MVP (3 weeks)
- Phase 1: Scaffold + Core + DB (Week 1)
- Phase 2: Runner + Adapters + CLI (Week 2)
- Phase 3: Dashboard + Polish + Ship (Week 3)

### v0.2.0 — Feature Parity (Week 4-5)
- Org chart, multi-company, goal hierarchy, comments, approvals, kanban, Docker

### v0.3.0 — Platform Integration (Week 6-7)
- Import @shackleai/* into platform, wire premium features, deploy

---

## Session Execution Guide

Each session runs 2-3 parallel agents in worktrees. Give the ticket number and the agent will pick up the full context from the issue body.

### SESSION 1: Scaffold + Shared + DB (#1, #2, #3)
### SESSION 2: Governance + Observatory + Cost Tracker (#4, #5, #6)
### SESSION 3: Scheduler + Adapters (#7, #8, #9)
### SESSION 4: Runner + License + CLI Init (#10, #11, #12)
### SESSION 5: API Routes — Companies + Agents + Issues (#13, #14, #15)
### SESSION 6: Remaining Routes + CLI Commands + E2E (#16, #17, #18)
### SESSION 7: Dashboard MVP (#19, #20)
### SESSION 8: README + CI/CD + npm Publish Prep (#21, #22, #23)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| PGlite SQL compatibility | Standard SQL only (no pgvector, custom types, procedures) |
| Package size for npx | PGlite ~3MB + Hono 14KB + React ~42KB = under 5MB |
| Competing with Paperclip | Different positioning: governance + MCP-native + managed upgrade path |
| Version drift | Shared @shackleai/shared types + CI tests against latest packages |
| Open-sourcing governance | Basic allow/deny is free; ABAC/approvals/killswitch stay platform-only |
