# ShackleAI Orchestrator — Claude Code Instructions

## Session Startup — MANDATORY

1. **Check git identity**: `git config user.name` must be `ShackleAI`, email `useshackleai@gmail.com`
2. **Read PLAN.md** (gitignored): `D:\shackleai\orchestrator\PLAN.md` for current roadmap context
3. **Check GitHub issues**: `gh api repos/shackleai/orchestrator/issues?state=open --jq '.[].title'`
4. **Check current milestone**: `gh api repos/shackleai/orchestrator/milestones?state=open --jq '.[] | "\(.title) — \(.open_issues) open / \(.closed_issues) closed"'`

## Project Overview

**ShackleAI Orchestrator** is the open-source agent orchestrator (`npx @shackleai/orchestrator init`).

- **Repo**: `shackleai/orchestrator` (PUBLIC, MIT license)
- **npm**: `@shackleai/orchestrator`, `@shackleai/core`, `@shackleai/db`, `@shackleai/shared`

## Monorepo Structure

```
shackleai/orchestrator
  packages/
    shared/     @shackleai/shared   — Shared types, utilities, constants
    db/         @shackleai/db       — Database layer (SQLite, migrations)
    core/       @shackleai/core     — Core orchestration engine
  apps/
    cli/        @shackleai/orchestrator — CLI entrypoint (npx)
    dashboard/  shackleai-dashboard     — Web dashboard (private)
```

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5+ (strict mode)
- **Package manager**: pnpm 10+ (NEVER use npm or yarn)
- **Build system**: Turborepo
- **Testing**: Vitest
- **Linting**: ESLint 9 (flat config) + Prettier
- **Database**: SQLite (via better-sqlite3) for local orchestrator state

## Working Conventions

### Commands
```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (via turbo)
pnpm test             # Run all tests (via turbo)
pnpm lint             # Lint all packages (via turbo)
pnpm typecheck        # Type-check all packages (via turbo)
pnpm format           # Format all files with Prettier
pnpm format:check     # Check formatting without writing
```

### Branch Naming
- Features: `feature/issue-N-short-description`
- Scaffold: `scaffold/issue-N-short-description`
- Fixes: `fix/issue-N-short-description`
- Docs: `docs/issue-N-short-description`

### PR Workflow
1. Create branch from `main`
2. Implement changes
3. `pnpm lint && pnpm build && pnpm typecheck` must pass
4. Commit with `Closes #N` in the message
5. Push and create PR
6. PR must reference the issue: `Closes #N`

### Commit Messages
```
Phase XY: Brief description

Closes #N

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

## Quality Gates

- All tests must pass before merging
- TypeScript strict mode — no `any` without justification
- ESLint must pass with zero warnings
- Prettier formatting enforced
- Code review required on every PR

## Publishing

**NEVER publish from local machine.** Publishing happens via GitHub Actions:

```bash
git tag v0.X.Y
git push origin v0.X.Y
```

This triggers the CI pipeline which builds, tests, and publishes to npm.

## Anti-Patterns

- NEVER use `npm` or `yarn` — only `pnpm`
- NEVER commit `node_modules/`, `dist/`, or `.turbo/`
- NEVER skip tests or linting before pushing
- NEVER publish to npm locally
- NEVER commit as `errakaaram` — always `ShackleAI`
