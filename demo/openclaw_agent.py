#!/usr/bin/env python3
"""
ShackleAI Orchestrator — OpenClaw Demo Agent

Simulates an OpenClaw-style agent that the orchestrator manages via heartbeats.
This agent acts as a "Code Review Bot" that reviews code changes.

Usage (standalone):
  python demo/openclaw_agent.py --task '{"task":"Review PR #42"}' --session '{}'

Usage (via orchestrator):
  The orchestrator calls this automatically during heartbeats.

Requirements:
  pip install openclaw  (optional — runs in simulation mode without it)
"""

import argparse
import json
import os
import sys
import time

RESULT_MARKER = "__shackleai_result__"


def run_agent(task_description: str, session_state: str | None = None) -> dict:
    """
    Run the OpenClaw agent. Falls back to simulation if openclaw is not installed.
    """
    try:
        import openclaw
        # Real OpenClaw integration would go here
        raise ImportError("Using simulation for demo")
    except ImportError:
        print("[DEMO MODE] Running OpenClaw simulation...", file=sys.stderr)
        time.sleep(0.5)

        reviews_done = 0
        if session_state:
            try:
                prev = json.loads(session_state)
                reviews_done = prev.get("reviews_done", 0)
            except (json.JSONDecodeError, TypeError):
                pass

        reviews_done += 1

        output = (
            f"=== OpenClaw Code Review Agent (Review #{reviews_done}) ===\n\n"
            f"Task: {task_description}\n\n"
            f"[OpenClaw] Analyzing code changes...\n"
            f"[OpenClaw] Running static analysis...\n"
            f"[OpenClaw] Checking for security vulnerabilities...\n\n"
            f"Review Summary:\n"
            f"  Files reviewed: 12\n"
            f"  Issues found: 3\n"
            f"    - HIGH: SQL injection risk in user input handler (line 42)\n"
            f"    - MEDIUM: Missing null check in API response parser (line 156)\n"
            f"    - LOW: Unused import in utils.ts (line 3)\n\n"
            f"  Suggestions:\n"
            f"    1. Use parameterized queries instead of string concatenation\n"
            f"    2. Add optional chaining for API response fields\n"
            f"    3. Remove unused import to reduce bundle size\n\n"
            f"  Verdict: CHANGES REQUESTED (2 blocking issues)\n"
            f"  Total reviews completed this session: {reviews_done}\n"
        )

        # Simulate tool calls that the orchestrator will track
        tool_calls = [
            {"toolName": "github:list_files", "status": "success", "durationMs": 120},
            {"toolName": "github:get_diff", "status": "success", "durationMs": 350},
            {"toolName": "security:scan", "status": "success", "durationMs": 800},
        ]

        return {
            "success": True,
            "output": output,
            "reviews_done": reviews_done,
            "issues_found": 3,
            "inputTokens": 800 + reviews_done * 100,
            "outputTokens": 400 + reviews_done * 50,
            "costCents": 7,
            "model": "gpt-4o",
            "provider": "openai",
            "tool_calls": tool_calls,
        }


def main():
    parser = argparse.ArgumentParser(description="ShackleAI OpenClaw Demo Agent")
    parser.add_argument("--task", required=True, help="JSON task payload from orchestrator")
    parser.add_argument("--session", default=None, help="Previous session state")
    args = parser.parse_args()

    try:
        payload = json.loads(args.task)
        task_desc = payload.get("task", "Review latest code changes")
    except (json.JSONDecodeError, TypeError):
        task_desc = args.task

    agent_id = os.environ.get("SHACKLEAI_AGENT_ID", "unknown")
    run_id = os.environ.get("SHACKLEAI_RUN_ID", "unknown")

    print(f"[OpenClaw] Agent={agent_id} Run={run_id}")
    print(f"[OpenClaw] Task: {task_desc}")
    print()

    result = run_agent(task_desc, args.session)
    print(result["output"])

    # Emit structured result
    result_payload = {
        "session_id_after": json.dumps({
            "reviews_done": result["reviews_done"],
            "lastTask": task_desc,
        }),
        "usage": {
            "inputTokens": result["inputTokens"],
            "outputTokens": result["outputTokens"],
            "costCents": result["costCents"],
            "model": result["model"],
            "provider": result["provider"],
        },
    }
    print(f"\n{RESULT_MARKER}{json.dumps(result_payload)}{RESULT_MARKER}")


if __name__ == "__main__":
    main()
