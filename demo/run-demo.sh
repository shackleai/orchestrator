#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# ShackleAI Orchestrator — E2E Demo
#
# Demonstrates the full orchestrator flow with CrewAI and OpenClaw agents:
#   1. Initialize a company ("Demo Corp")
#   2. Register a CrewAI agent (Researcher) and an OpenClaw agent (Reviewer)
#   3. Create tasks and assign them
#   4. Trigger heartbeats and watch agents execute
#   5. View costs, activity, and results via the API
#
# Prerequisites:
#   - Node.js 18+, pnpm
#   - Python 3.12+ (CrewAI/OpenClaw agents are Python scripts)
#   - The orchestrator must be built: pnpm build
##############################################################################

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$DEMO_DIR/.." && pwd)"
CLI="node $ROOT_DIR/apps/cli/dist/index.js"
API="http://127.0.0.1:4800/api"
COMPANY_ID=""
SERVER_PID=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}\n"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; }

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    step "Shutting down server (PID $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    ok "Server stopped"
  fi
}
trap cleanup EXIT

##############################################################################
step "1. Initialize the orchestrator"
##############################################################################

# Force re-init for clean demo
$CLI init --yes --name "Demo Corp" --force 2>/dev/null || $CLI init --yes --name "Demo Corp" 2>/dev/null || {
  warn "init --yes not available, using defaults"
}
ok "Initialized Demo Corp"

##############################################################################
step "2. Start the API server (background)"
##############################################################################

$CLI start &
SERVER_PID=$!
sleep 3

# Health check
if curl -sf "$API/companies" > /dev/null 2>&1; then
  ok "Server running at $API"
else
  fail "Server failed to start"
  exit 1
fi

##############################################################################
step "3. Get company ID"
##############################################################################

COMPANY_ID=$(curl -s "$API/companies" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const companies = d.data || d;
  console.log(companies[0]?.id || '');
")

if [ -z "$COMPANY_ID" ]; then
  fail "No company found"
  exit 1
fi
ok "Company ID: $COMPANY_ID"

##############################################################################
step "4. Register CrewAI agent — 'Researcher'"
##############################################################################

CREWAI_AGENT_ID=$(curl -s -X POST "$API/companies/$COMPANY_ID/agents" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"researcher\",
    \"title\": \"Senior Research Analyst\",
    \"role\": \"worker\",
    \"adapter_type\": \"crewai\",
    \"adapter_config\": {
      \"entrypoint\": \"$DEMO_DIR/crewai_agent.py\",
      \"timeout\": 60
    },
    \"budget_monthly_cents\": 50000
  }" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(d.id || d.data?.id || '');
  ")

ok "CrewAI agent registered: $CREWAI_AGENT_ID"

##############################################################################
step "5. Register OpenClaw agent — 'Reviewer'"
##############################################################################

OPENCLAW_AGENT_ID=$(curl -s -X POST "$API/companies/$COMPANY_ID/agents" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"reviewer\",
    \"title\": \"Code Review Bot\",
    \"role\": \"worker\",
    \"adapter_type\": \"openclaw\",
    \"adapter_config\": {
      \"entrypoint\": \"$DEMO_DIR/openclaw_agent.py\",
      \"timeout\": 30
    },
    \"budget_monthly_cents\": 30000
  }" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(d.id || d.data?.id || '');
  ")

ok "OpenClaw agent registered: $OPENCLAW_AGENT_ID"

##############################################################################
step "6. List all agents"
##############################################################################

curl -s "$API/companies/$COMPANY_ID/agents" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const agents = d.data || d;
  console.log('Agents:');
  for (const a of agents) {
    console.log('  ' + a.name + ' (' + a.adapter_type + ') — ' + a.role + ' — budget: $' + (a.budget_monthly_cents/100).toFixed(2));
  }
"

##############################################################################
step "7. Create tasks and assign to agents"
##############################################################################

# Task 1: Research task for CrewAI agent
TASK1_ID=$(curl -s -X POST "$API/companies/$COMPANY_ID/issues" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Research AI agent orchestration landscape\",
    \"description\": \"Analyze the current market for AI agent orchestration platforms. Compare key players, identify trends, and summarize findings.\",
    \"priority\": \"high\",
    \"assignee_agent_id\": \"$CREWAI_AGENT_ID\"
  }" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(d.id || d.data?.id || '');
  ")

ok "Task 1 created and assigned to Researcher: $TASK1_ID"

# Task 2: Code review task for OpenClaw agent
TASK2_ID=$(curl -s -X POST "$API/companies/$COMPANY_ID/issues" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Review PR #42 — auth middleware rewrite\",
    \"description\": \"Review the authentication middleware rewrite for security vulnerabilities, code quality, and adherence to coding standards.\",
    \"priority\": \"critical\",
    \"assignee_agent_id\": \"$OPENCLAW_AGENT_ID\"
  }" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(d.id || d.data?.id || '');
  ")

ok "Task 2 created and assigned to Reviewer: $TASK2_ID"

# Move tasks to in_progress
curl -s -X PATCH "$API/companies/$COMPANY_ID/issues/$TASK1_ID" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' > /dev/null
curl -s -X PATCH "$API/companies/$COMPANY_ID/issues/$TASK2_ID" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' > /dev/null
ok "Both tasks moved to in_progress"

##############################################################################
step "8. Trigger CrewAI heartbeat"
##############################################################################

echo -e "${YELLOW}Running CrewAI agent heartbeat...${NC}"
CREWAI_RESULT=$(curl -s -X POST "$API/companies/$COMPANY_ID/agents/$CREWAI_AGENT_ID/run" \
  -H "Content-Type: application/json" \
  -d '{"trigger": "manual"}')

echo "$CREWAI_RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const r = d.data || d;
  console.log('Exit code: ' + r.exitCode);
  console.log('Usage: ' + JSON.stringify(r.usage || 'none'));
  if (r.stdout) {
    console.log('\n--- Agent Output (first 500 chars) ---');
    console.log(r.stdout.substring(0, 500));
  }
"
ok "CrewAI heartbeat complete"

##############################################################################
step "9. Trigger OpenClaw heartbeat"
##############################################################################

echo -e "${YELLOW}Running OpenClaw agent heartbeat...${NC}"
OPENCLAW_RESULT=$(curl -s -X POST "$API/companies/$COMPANY_ID/agents/$OPENCLAW_AGENT_ID/run" \
  -H "Content-Type: application/json" \
  -d '{"trigger": "manual"}')

echo "$OPENCLAW_RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const r = d.data || d;
  console.log('Exit code: ' + r.exitCode);
  console.log('Usage: ' + JSON.stringify(r.usage || 'none'));
  if (r.stdout) {
    console.log('\n--- Agent Output (first 500 chars) ---');
    console.log(r.stdout.substring(0, 500));
  }
"
ok "OpenClaw heartbeat complete"

##############################################################################
step "10. View heartbeat history"
##############################################################################

curl -s "$API/companies/$COMPANY_ID/heartbeats?limit=5" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const runs = d.data || d;
  console.log('Recent heartbeats:');
  for (const r of runs) {
    console.log('  ' + r.id?.substring(0,8) + '... | agent=' + (r.agent_id?.substring(0,8) || '?') + '... | status=' + r.status + ' | trigger=' + r.trigger_type + ' | exit=' + r.exit_code);
  }
"

##############################################################################
step "11. View cost summary"
##############################################################################

curl -s "$API/companies/$COMPANY_ID/costs?limit=10" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const events = d.data || d;
  let total = 0;
  console.log('Cost events:');
  for (const e of events) {
    total += e.cost_cents || 0;
    console.log('  ' + (e.provider || '?') + '/' + (e.model || '?') + ' — $' + ((e.cost_cents||0)/100).toFixed(2) + ' (' + (e.input_tokens||0) + ' in / ' + (e.output_tokens||0) + ' out)');
  }
  console.log('  Total: $' + (total/100).toFixed(2));
"

##############################################################################
step "12. View activity log"
##############################################################################

curl -s "$API/companies/$COMPANY_ID/activity?limit=10" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const events = d.data || d;
  console.log('Recent activity:');
  for (const e of events) {
    console.log('  [' + e.action + '] ' + e.entity_type + '/' + (e.entity_id?.substring(0,8) || '?') + '... by ' + e.actor_type + '/' + (e.actor_id?.substring(0,8) || 'system'));
  }
"

##############################################################################
step "13. Dashboard URL"
##############################################################################

echo -e "${GREEN}Dashboard: http://127.0.0.1:4800${NC}"
echo -e "${GREEN}API:       http://127.0.0.1:4800/api${NC}"
echo ""
echo "Press Ctrl+C to stop the demo."
wait "$SERVER_PID"
