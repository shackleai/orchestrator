#!/usr/bin/env bash
# scripts/review-pr.sh
#
# Run lint, build, and tests for an untrusted pull request inside a sandboxed
# Docker environment.  The source code under review never touches the host
# filesystem — it is fetched and executed entirely inside an ephemeral container.
#
# Usage:
#   ./scripts/review-pr.sh <pr-number> [--repo <owner/repo>]
#
# Required environment variables:
#   GITHUB_TOKEN   — fine-grained PAT with "Pull requests: read" permission
#
# Optional environment variables:
#   GITHUB_REPOSITORY  — defaults to shackleai/orchestrator
#   REVIEW_TIMEOUT     — seconds before the review container is killed (default: 600)
#
# Exit codes:
#   0  — all checks passed
#   1  — one or more checks failed
#   2  — usage / environment error
#   3  — Docker / infrastructure error

set -euo pipefail

# ---------------------------------------------------------------------------
# Colour helpers (degrade gracefully when not a TTY)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED="\033[0;31m"; GREEN="\033[0;32m"; YELLOW="\033[0;33m"
  CYAN="\033[0;36m"; BOLD="\033[1m"; RESET="\033[0m"
else
  RED=""; GREEN=""; YELLOW=""; CYAN=""; BOLD=""; RESET=""
fi

log()      { echo -e "${CYAN}[review-pr]${RESET} $*"; }
ok()       { echo -e "${GREEN}[review-pr] PASS${RESET} $*"; }
fail()     { echo -e "${RED}[review-pr] FAIL${RESET} $*"; }
fatal()    { echo -e "${RED}[review-pr] FATAL${RESET} $*" >&2; exit "${2:-2}"; }

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: $(basename "$0") <pr-number> [--repo <owner/repo>] [--timeout <seconds>]

Run a sandboxed code review for the given GitHub pull request.

Arguments:
  pr-number           Pull request number (required)

Options:
  --repo <owner/repo>   Target repository (default: shackleai/orchestrator)
  --timeout <seconds>   Kill the container after N seconds (default: 600)
  -h, --help            Show this message

Environment variables:
  GITHUB_TOKEN          GitHub PAT with "Pull requests: read" scope (required)
  GITHUB_REPOSITORY     Repository override (same as --repo)
  REVIEW_TIMEOUT        Timeout override (same as --timeout)

Examples:
  GITHUB_TOKEN=ghp_... ./scripts/review-pr.sh 185
  GITHUB_TOKEN=ghp_... ./scripts/review-pr.sh 185 --repo myorg/myrepo --timeout 300
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
PR_NUMBER=""
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-shackleai/orchestrator}"
REVIEW_TIMEOUT="${REVIEW_TIMEOUT:-600}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)    usage; exit 0 ;;
    --repo)       shift; GITHUB_REPOSITORY="$1" ;;
    --timeout)    shift; REVIEW_TIMEOUT="$1" ;;
    [0-9]*)       PR_NUMBER="$1" ;;
    *)            fatal "Unknown argument: $1" ;;
  esac
  shift
done

[[ -z "$PR_NUMBER" ]]          && { usage; fatal "pr-number is required" 2; }
[[ -z "${GITHUB_TOKEN:-}" ]]   && fatal "GITHUB_TOKEN is not set" 2

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
for cmd in docker curl jq; do
  command -v "$cmd" &>/dev/null || fatal "Required command not found: $cmd" 3
done

docker info &>/dev/null || fatal "Docker daemon is not running" 3

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${REPO_DIR}/docker-compose.untrusted-review.yml"
RUNNER_SCRIPT="${REPO_DIR}/scripts/run-review.sh"

[[ -f "$COMPOSE_FILE" ]]   || fatal "Compose file not found: $COMPOSE_FILE" 3
[[ -f "$RUNNER_SCRIPT" ]]  || fatal "Runner script not found: $RUNNER_SCRIPT" 3

# ---------------------------------------------------------------------------
# Resolve PR metadata via GitHub API
# ---------------------------------------------------------------------------
log "Fetching PR #${PR_NUMBER} metadata from ${GITHUB_REPOSITORY} ..."

PR_JSON=$(curl -fsSL \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}") \
  || fatal "Failed to fetch PR metadata. Check GITHUB_TOKEN and PR number." 2

PR_HEAD_REF=$(echo "$PR_JSON" | jq -r '.head.ref')
PR_HEAD_SHA=$(echo "$PR_JSON" | jq -r '.head.sha')
PR_TITLE=$(echo "$PR_JSON"   | jq -r '.title')
PR_AUTHOR=$(echo "$PR_JSON"  | jq -r '.user.login')
PR_BASE=$(echo "$PR_JSON"    | jq -r '.base.ref')

log "PR #${PR_NUMBER}: \"${PR_TITLE}\""
log "Author : ${PR_AUTHOR}"
log "Branch : ${PR_HEAD_REF} (${PR_HEAD_SHA:0:8})"
log "Base   : ${PR_BASE}"

# ---------------------------------------------------------------------------
# Build the review image
# Source code is baked in at build time via COPY — no host checkout needed.
# ---------------------------------------------------------------------------
IMAGE_TAG="shackleai-review:pr-${PR_NUMBER}-${PR_HEAD_SHA:0:8}"

log "Building review image ${IMAGE_TAG} ..."

export PR_NUMBER
export PR_REF="refs/pull/${PR_NUMBER}/head"
export GITHUB_TOKEN
export GITHUB_REPOSITORY

# Primary build (multi-stage, uses existing Dockerfile)
docker build \
  --file "${REPO_DIR}/Dockerfile" \
  --tag "${IMAGE_TAG}" \
  --no-cache \
  "${REPO_DIR}" || fatal "Docker build failed" 3

# Inject the in-container runner script via a thin wrapper layer
TMP_DOCKERFILE=$(mktemp /tmp/Dockerfile-review.XXXXXX)
cat >"$TMP_DOCKERFILE" <<INNER
FROM ${IMAGE_TAG}
COPY scripts/run-review.sh /app/scripts/run-review.sh
RUN chmod +x /app/scripts/run-review.sh
INNER

docker build \
  --file "$TMP_DOCKERFILE" \
  --tag "${IMAGE_TAG}" \
  "${REPO_DIR}" || { rm -f "$TMP_DOCKERFILE"; fatal "Runner injection failed" 3; }
rm -f "$TMP_DOCKERFILE"

# ---------------------------------------------------------------------------
# Run the sandboxed review
# ---------------------------------------------------------------------------
log "Starting sandboxed review (timeout: ${REVIEW_TIMEOUT}s) ..."

RESULTS_DIR=$(mktemp -d /tmp/review-results.XXXXXX)
EXIT_CODE=0
PROJECT_NAME="review-pr-${PR_NUMBER}"

timeout "${REVIEW_TIMEOUT}" \
  docker compose \
    --file "${COMPOSE_FILE}" \
    --project-name "${PROJECT_NAME}" \
  run \
    --rm \
    -e PR_NUMBER="${PR_NUMBER}" \
    -e PR_REF="${PR_REF}" \
    -e GITHUB_TOKEN="${GITHUB_TOKEN}" \
    -e GITHUB_REPOSITORY="${GITHUB_REPOSITORY}" \
    review \
  2>&1 | tee "${RESULTS_DIR}/output.log" || EXIT_CODE=$?

# ---------------------------------------------------------------------------
# Report results
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=====================================================${RESET}"
echo -e "${BOLD}  Review Results — PR #${PR_NUMBER}${RESET}"
echo -e "${BOLD}  ${PR_TITLE}${RESET}"
echo -e "${BOLD}=====================================================${RESET}"

if [[ -f "${RESULTS_DIR}/output.log" ]]; then
  grep -E "^\[STEP\]|^\[PASS\]|^\[FAIL\]" "${RESULTS_DIR}/output.log" || true
fi

echo ""

if [[ "$EXIT_CODE" -eq 0 ]]; then
  ok "All checks passed for PR #${PR_NUMBER}"
elif [[ "$EXIT_CODE" -eq 124 ]]; then
  fail "Review timed out after ${REVIEW_TIMEOUT}s"
  EXIT_CODE=1
else
  fail "One or more checks failed for PR #${PR_NUMBER} (exit ${EXIT_CODE})"
  EXIT_CODE=1
fi

# ---------------------------------------------------------------------------
# Cleanup — always runs, even on failure
# ---------------------------------------------------------------------------
log "Cleaning up ..."
docker compose \
  --file "${COMPOSE_FILE}" \
  --project-name "${PROJECT_NAME}" \
  down --remove-orphans --volumes &>/dev/null || true

docker image rm "${IMAGE_TAG}" &>/dev/null || true
rm -rf "${RESULTS_DIR}"

log "Done."
exit "$EXIT_CODE"
