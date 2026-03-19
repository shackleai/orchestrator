# Untrusted PR Review — Sandboxed Docker Environment

Run lint, build, and tests for any pull request — including PRs from external
forks — inside a hermetically sealed Docker environment.  The PR source code
never executes on the host and cannot reach the internet beyond the GitHub API.

---

## Quick start

```bash
export GITHUB_TOKEN="ghp_..."   # fine-grained PAT — "Pull requests: read" only
./scripts/review-pr.sh 185
```

The script fetches the PR, builds an isolated image, runs all checks, prints
a structured summary, and tears everything down automatically.

---

## Security model

The sandbox enforces five independent layers of isolation.

### 1. No host filesystem access

The source code under review is baked into the Docker image via `COPY` at
build time.  There are no bind mounts (`-v host:container`).  The review
container cannot read or write anything on the host.

### 2. Ephemeral storage only

All writable paths inside the container (`node_modules`, `dist`, the embedded
PGlite database at `/root/.shackleai`) are backed by `tmpfs`.  When the
container exits, everything is gone — no named volumes, no leftover data.

### 3. Read-only root filesystem

The container root filesystem is mounted `read_only: true`.  Only the explicit
`tmpfs` mounts defined in `docker-compose.untrusted-review.yml` are writable.
A supply-chain attack that attempts to modify files outside those paths fails
with a permission error.

### 4. Network isolation

The `review` container is attached only to the internal `review-net` bridge,
which has `internal: true` set at the Docker daemon level — it cannot initiate
TCP connections to the internet directly.

GitHub API calls (needed during the build to fetch PR metadata) are proxied
through the `gh-proxy` sidecar.  The sidecar is a `socat` forwarder that only
speaks `TCP → api.github.com:443`; every other destination is unreachable.

```
[review container]
       |
       | review-net (internal bridge — no internet route)
       |
[gh-proxy sidecar]  ──egress-net──>  api.github.com:443
```

### 5. Resource limits

Hard caps are enforced via Docker's `deploy.resources.limits`:

| Resource | Limit     |
|----------|-----------|
| CPU      | 1 core    |
| Memory   | 1 GB      |
| Timeout  | 600 s (configurable) |

---

## How it works

```
review-pr.sh <pr-number>
  │
  ├─ 1. Fetch PR metadata via GitHub API (curl, runs on the host)
  │       Resolves: head ref, SHA, author, base branch
  │
  ├─ 2. Build Docker image
  │       Uses existing Dockerfile (multi-stage, non-root node user)
  │       Injects scripts/run-review.sh as the container entrypoint
  │       --no-cache ensures a clean layer graph every run
  │
  ├─ 3. docker compose run review
  │       Applies sandbox constraints from docker-compose.untrusted-review.yml
  │       Streams output to terminal + temp file
  │
  │     Inside the container (run-review.sh):
  │       [STEP] install   →  pnpm install --frozen-lockfile
  │       [STEP] lint      →  pnpm lint
  │       [STEP] typecheck →  pnpm typecheck
  │       [STEP] build     →  pnpm build
  │       [STEP] test      →  pnpm test
  │
  └─ 4. Cleanup
          docker compose down --remove-orphans --volumes
          docker image rm
          Remove temp files
```

---

## Prerequisites

| Requirement      | Notes                                                  |
|------------------|--------------------------------------------------------|
| Docker Engine 24+| `docker info` must succeed                             |
| Docker Compose v2| `docker compose version`                               |
| `curl`           | GitHub API calls on the host                           |
| `jq`             | Parsing the API JSON response                          |
| `GITHUB_TOKEN`   | Fine-grained PAT — "Pull requests: read" is sufficient |

---

## Environment variables

| Variable             | Required | Default                    | Description                        |
|----------------------|----------|----------------------------|------------------------------------|
| `GITHUB_TOKEN`       | Yes      | —                          | GitHub PAT for PR metadata fetch   |
| `GITHUB_REPOSITORY`  | No       | `shackleai/orchestrator`   | Target repo (`owner/repo`)         |
| `REVIEW_TIMEOUT`     | No       | `600`                      | Seconds before container is killed |

---

## CLI options

```
./scripts/review-pr.sh <pr-number> [options]

Options:
  --repo <owner/repo>   Override target repository
  --timeout <seconds>   Kill the container after N seconds
  -h, --help            Show help
```

---

## Example output

```
[review-pr] Fetching PR #185 metadata from shackleai/orchestrator ...
[review-pr] PR #185: "feat: add sandboxed Docker environment for untrusted PR review"
[review-pr] Author : octocat
[review-pr] Branch : feat/185-untrusted-review (a1b2c3d4)
[review-pr] Base   : main
[review-pr] Building review image shackleai-review:pr-185-a1b2c3d4 ...
[review-pr] Starting sandboxed review (timeout: 600s) ...

[STEP] install: pnpm install --frozen-lockfile
[PASS] install
[STEP] lint: pnpm lint
[PASS] lint
[STEP] typecheck: pnpm typecheck
[PASS] typecheck
[STEP] build: pnpm build
[PASS] build
[STEP] test: pnpm test
[PASS] test

=====================================================
  Review Results — PR #185
  feat: add sandboxed Docker environment for untrusted PR review
=====================================================
[PASS] install
[PASS] lint
[PASS] typecheck
[PASS] build
[PASS] test

[review-pr] PASS All checks passed for PR #185
[review-pr] Cleaning up ...
[review-pr] Done.
```

---

## Exit codes

| Code | Meaning                                       |
|------|-----------------------------------------------|
| `0`  | All checks passed                             |
| `1`  | One or more checks failed                     |
| `2`  | Usage / environment error (bad args, no token)|
| `3`  | Docker / infrastructure error                 |

---

## CI integration

Add a workflow to run the sandbox automatically for every fork PR:

```yaml
# .github/workflows/sandboxed-review.yml
name: Sandboxed PR Review

on:
  pull_request_target:
    types: [opened, synchronize, reopened]

jobs:
  sandboxed-review:
    runs-on: ubuntu-latest
    # Only trigger for fork PRs — first-party branches use the normal CI.
    if: github.event.pull_request.head.repo.fork == true
    permissions:
      pull-requests: read
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main   # always check out main, never the fork's code

      - name: Run sandboxed review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: ./scripts/review-pr.sh ${{ github.event.pull_request.number }}
```

> **Why `pull_request_target`?**  This event always checks out the base branch
> and runs with repository secrets.  Untrusted fork code only ever executes
> inside the Docker sandbox, not in the Actions runner itself.

---

## Threat model

| Threat                                         | Mitigation                                                                 |
|------------------------------------------------|----------------------------------------------------------------------------|
| Malicious code exfiltrates secrets             | No host mounts; HTTPS_PROXY restricts egress to `api.github.com` only     |
| Code overwrites host files                     | `read_only: true` root fs, no bind mounts                                  |
| Code exhausts host resources                   | CPU/memory hard limits; `--timeout` kills hung processes                   |
| Persistent backdoor left on host               | All storage is `tmpfs`; image removed after every run                      |
| Supply-chain npm package contacts C2 server    | Network isolation prevents all outbound except the GitHub proxy            |
| Privilege escalation inside container          | `no-new-privileges:true`, non-root `node` user (UID 1000)                  |

---

## Troubleshooting

**`Docker daemon is not running`**
Start Docker Desktop or run `sudo systemctl start docker`.

**`Failed to fetch PR metadata`**
Verify `GITHUB_TOKEN` is set and has "Pull requests: read" on the target repo.
Check the PR exists: `gh pr view <number>`.

**Build fails with `pnpm: not found`**
The base image uses `corepack enable`.  Ensure the `Dockerfile` base stage
contains `RUN corepack enable && corepack prepare pnpm@latest --activate`.

**Tests fail inside the sandbox but pass locally**
The sandbox uses `tmpfs` for `node_modules` — tests must not rely on paths
that persist across runs.  Also verify tests do not make outbound HTTP calls
to hosts other than `api.github.com`.

**`timeout: unknown option` on macOS**
Install GNU coreutils: `brew install coreutils`, then
`sudo ln -s /usr/local/bin/gtimeout /usr/local/bin/timeout`.
