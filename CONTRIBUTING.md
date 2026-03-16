# Contributing to ShackleAI Orchestrator

Thank you for your interest in contributing to ShackleAI Orchestrator! This guide will help you get started.

## Getting Started

### Prerequisites

- **Node.js** 18.12 or later
- **pnpm** 10 or later (`corepack enable pnpm`)
- **Git**

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/orchestrator.git
   cd orchestrator
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Verify the setup:
   ```bash
   pnpm build
   pnpm test
   pnpm typecheck
   ```

## Development Workflow

### Branch Naming

Create a branch from `main` using the convention:

- `feature/issue-N-short-description` for new features
- `fix/issue-N-short-description` for bug fixes
- `docs/issue-N-short-description` for documentation

### Making Changes

1. Create your branch: `git checkout -b feature/issue-N-description`
2. Make your changes
3. Run quality checks:
   ```bash
   pnpm lint        # ESLint
   pnpm typecheck   # TypeScript
   pnpm test        # Vitest
   pnpm build       # Full build
   ```
4. Commit your changes with a clear message
5. Push and open a pull request

### Commit Messages

Use clear, descriptive commit messages:

```
Brief description of the change

Closes #N
```

### Pull Requests

- Reference the related issue with `Closes #N`
- Provide a clear description of what changed and why
- Ensure all CI checks pass
- Request a review

## Project Structure

```
packages/
  shared/     — Shared types, utilities, and constants
  db/         — Database layer
  core/       — Core orchestration engine
apps/
  cli/        — CLI entrypoint (@shackleai/orchestrator)
  dashboard/  — Web dashboard
```

## Code Style

- **TypeScript** strict mode — avoid `any` types
- **Prettier** for formatting (single quotes, no semicolons, trailing commas)
- **ESLint** for linting (TypeScript ESLint)
- Use `pnpm format` to auto-format your code

## Testing

We use **Vitest** for testing. Place test files next to the source code with the `.test.ts` extension.

```bash
pnpm test                   # Run all tests
pnpm --filter @shackleai/core test  # Run tests for a specific package
```

## Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include steps to reproduce for bugs
- Check existing issues before creating a new one

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
