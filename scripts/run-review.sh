#!/usr/bin/env bash
# scripts/run-review.sh
#
# In-container review runner.  Injected into the review image by review-pr.sh
# and executed as the container entrypoint.
#
# Runs five checks in sequence; all checks run even when one fails, so the
# caller receives a complete picture of the PR's quality in a single pass.
#
# Structured output lines (parsed by review-pr.sh):
#   [STEP] <name>   — a check is starting
#   [PASS] <name>   — the check passed
#   [FAIL] <name>   — the check failed
#
# Exit code: 0 if all checks pass, 1 if any check fails.

set -uo pipefail

PASS_COUNT=0
FAIL_COUNT=0
FAILED_STEPS=()

step()      { echo "[STEP] $*"; }
pass_step() { echo "[PASS] $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail_step() { echo "[FAIL] $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); FAILED_STEPS+=("$*"); }

echo "======================================================="
echo " ShackleAI Orchestrator — Sandboxed PR Review Runner"
echo " PR      : #${PR_NUMBER:-unknown}"
echo " Ref     : ${PR_REF:-unknown}"
echo " Repo    : ${GITHUB_REPOSITORY:-unknown}"
echo " Date    : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "======================================================="
echo ""

cd /app

# ---------------------------------------------------------------------------
# Step 1: Install dependencies
# ---------------------------------------------------------------------------
step "install: pnpm install --frozen-lockfile"
if pnpm install --frozen-lockfile 2>&1; then
  pass_step "install"
else
  fail_step "install"
  echo "[FAIL] Cannot proceed without node_modules — skipping remaining steps."
  echo ""
  echo "======================================================="
  echo " Summary: 0 passed, 1 failed"
  echo " Failed: install"
  echo "======================================================="
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Lint
# ---------------------------------------------------------------------------
step "lint: pnpm lint"
if pnpm lint 2>&1; then
  pass_step "lint"
else
  fail_step "lint"
fi

# ---------------------------------------------------------------------------
# Step 3: Type-check
# ---------------------------------------------------------------------------
step "typecheck: pnpm typecheck"
if pnpm typecheck 2>&1; then
  pass_step "typecheck"
else
  fail_step "typecheck"
fi

# ---------------------------------------------------------------------------
# Step 4: Build
# ---------------------------------------------------------------------------
step "build: pnpm build"
if pnpm build 2>&1; then
  pass_step "build"
else
  fail_step "build"
fi

# ---------------------------------------------------------------------------
# Step 5: Tests
# ---------------------------------------------------------------------------
step "test: pnpm test"
if pnpm test 2>&1; then
  pass_step "test"
else
  fail_step "test"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "======================================================="
echo " Summary: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
if [[ ${#FAILED_STEPS[@]} -gt 0 ]]; then
  echo " Failed steps:"
  for s in "${FAILED_STEPS[@]}"; do
    echo "   - ${s}"
  done
fi
echo "======================================================="

[[ "$FAIL_COUNT" -eq 0 ]]
