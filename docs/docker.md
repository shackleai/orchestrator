# Docker Deployment

Run the ShackleAI Orchestrator in a container using Docker Compose.

## Quick Start (Local Mode)

Local mode uses an embedded PGlite database — no external database required.

```bash
# Clone the repo
git clone https://github.com/shackleai/orchestrator.git
cd orchestrator

# Start the orchestrator
SHACKLEAI_COMPANY_NAME="Acme Corp" docker compose up
```

The dashboard is available at http://localhost:4800.

## Server Mode (External PostgreSQL)

Server mode connects to an external PostgreSQL database. The `postgres` profile
starts a bundled PostgreSQL container alongside the orchestrator.

```bash
SHACKLEAI_COMPANY_NAME="Acme Corp" \
SHACKLEAI_MODE=server \
SHACKLEAI_DATABASE_URL="postgresql://shackleai:shackleai@postgres:5432/shackleai" \
docker compose --profile server up
```

## Environment Variables

| Variable                  | Required | Default  | Description                                             |
|---------------------------|----------|----------|---------------------------------------------------------|
| `SHACKLEAI_COMPANY_NAME`  | Yes      | —        | Company name for auto-initialization                    |
| `SHACKLEAI_MODE`          | No       | `local`  | Deployment mode: `local` (PGlite) or `server` (Postgres)|
| `SHACKLEAI_DATABASE_URL`  | No*      | —        | PostgreSQL connection URL (* required when mode=server)  |

> **How auto-init works**: If no config exists on startup and `SHACKLEAI_COMPANY_NAME`
> is set, the orchestrator initializes automatically — no interactive `shackleai init`
> needed. If the company already exists in the database, it reuses the existing record.

## Persistent Data

Orchestrator state is stored in a named Docker volume:

```yaml
volumes:
  shackleai-data:  # mounted at /root/.shackleai inside the container
```

Data persists across container restarts. To reset:

```bash
docker compose down -v
```

## Building the Image

```bash
docker build -t shackleai-orchestrator .
```

Run it manually:

```bash
docker run -p 4800:4800 \
  -e SHACKLEAI_COMPANY_NAME="Acme Corp" \
  -v shackleai-data:/root/.shackleai \
  shackleai-orchestrator
```

## Health Check

```bash
curl http://localhost:4800/api/health
```
