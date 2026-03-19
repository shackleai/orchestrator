---
id: deployment
title: Deployment Guide
sidebar_label: Deployment Guide
---

# Deployment Guide

ShackleAI Orchestrator runs anywhere Node.js 18+ runs. This guide covers four deployment scenarios: local development, Docker, a Linux VPS, and cloud platforms.

---

## Local (development)

The simplest setup — everything runs on your machine with an embedded database.

```bash
npx @shackleai/orchestrator init   # One-time setup
npx @shackleai/orchestrator start  # Start the server
```

The server runs until you stop it (Ctrl+C). Data persists in the PGlite database between restarts.

To keep the server running in the background:

```bash
npx @shackleai/orchestrator start &
```

Or use a process manager like [PM2](https://pm2.keymetrics.io):

```bash
npm install -g pm2
pm2 start "npx @shackleai/orchestrator start" --name shackleai
pm2 save
pm2 startup   # Generate startup script
```

---

## Docker

See the [Docker](./docker) guide for a detailed walkthrough. Quick summary:

```bash
SHACKLEAI_COMPANY_NAME="Acme Corp" docker compose up
```

---

## Linux VPS

This example uses Ubuntu 24.04 and systemd to run the orchestrator as a managed service.

### 1. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # Should be >= 20
```

### 2. Install PostgreSQL (if using server mode)

```bash
sudo apt-get install -y postgresql
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql <<SQL
CREATE USER orchestrator WITH PASSWORD 'your-password';
CREATE DATABASE orchestrator OWNER orchestrator;
SQL
```

### 3. Initialize the orchestrator

Run as the user who will own the process (e.g. `ubuntu`):

```bash
npx @shackleai/orchestrator init
# Select Server mode
# DATABASE_URL: postgresql://orchestrator:your-password@localhost:5432/orchestrator
```

### 4. Create a systemd service

```bash
sudo nano /etc/systemd/system/shackleai.service
```

```ini
[Unit]
Description=ShackleAI Orchestrator
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStart=/usr/bin/npx @shackleai/orchestrator start --port 4800
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable shackleai
sudo systemctl start shackleai
sudo systemctl status shackleai
```

### 5. Verify

```bash
curl http://localhost:4800/api/health
```

### 6. Reverse proxy with Caddy (optional)

To expose the API over HTTPS with automatic TLS:

```bash
sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```
your-domain.example.com {
    reverse_proxy localhost:4800
}
```

```bash
sudo systemctl restart caddy
```

---

## Cloud platforms

### Railway

1. Create a new project and add a PostgreSQL plugin.
2. Deploy the orchestrator as a Node.js service.
3. Set `DATABASE_URL` to the Railway PostgreSQL URL.
4. On first deploy, run `init` via the Railway console to write the config.

### Fly.io

```bash
fly launch --name my-orchestrator --image node:20-alpine
fly postgres create --name orchestrator-db
fly postgres attach orchestrator-db

# Set environment
fly secrets set DATABASE_URL=<connection-string>

# Deploy
fly deploy
```

### AWS EC2 / GCP Compute Engine / Azure VM

Follow the Linux VPS instructions above. The steps are identical regardless of cloud provider.

---

## Networking and ports

| Port | Service |
|---|---|
| `4800` | ShackleAI Orchestrator API (default) |

The orchestrator binds to `0.0.0.0` (all interfaces) by default. In production, place it behind a reverse proxy (Nginx, Caddy) and do not expose port 4800 directly to the internet unless you have authentication middleware in front of it.

---

## Upgrades

To upgrade to a new version:

```bash
# Using npx (always pulls latest)
npx @shackleai/orchestrator@latest start

# Or update a globally installed version
npm update -g @shackleai/orchestrator
```

Database migrations run automatically on startup. New migrations are always additive — no manual migration steps are needed.

To check your current version:

```bash
npx @shackleai/orchestrator --version
curl http://localhost:4800/api/health   # Returns version in response
```
