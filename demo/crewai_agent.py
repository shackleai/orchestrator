#!/usr/bin/env python3
"""
ShackleAI Orchestrator — CrewAI Demo Agent

This is a self-contained CrewAI crew that the orchestrator manages via heartbeats.
It simulates a "Research & Write" crew with two agents:
  1. Researcher — gathers information
  2. Writer — produces a summary

Usage (standalone):
  python demo/crewai_agent.py --task '{"task":"Write about AI agents"}'

Usage (via orchestrator):
  The orchestrator calls this automatically during heartbeats.

Requirements:
  pip install crewai crewai-tools
"""

import argparse
import json
import os
import sys
import time

# ShackleAI result marker — the orchestrator parses this from stdout
RESULT_MARKER = "__shackleai_result__"


def run_crew(task_description: str, session_state: str | None = None) -> dict:
    """
    Run the CrewAI crew. Falls back to simulation if crewai is not installed.
    """
    try:
        from crewai import Agent, Task, Crew, Process  # type: ignore

        researcher = Agent(
            role="Senior Research Analyst",
            goal=f"Research the topic: {task_description}",
            backstory="Expert analyst with deep knowledge of AI and technology.",
            verbose=False,
            allow_delegation=False,
        )

        writer = Agent(
            role="Technical Writer",
            goal="Write clear, concise summaries from research findings",
            backstory="Experienced writer who turns complex topics into readable content.",
            verbose=False,
            allow_delegation=False,
        )

        research_task = Task(
            description=f"Research the following topic thoroughly: {task_description}",
            expected_output="A detailed research report with key findings",
            agent=researcher,
        )

        writing_task = Task(
            description="Based on the research, write a clear 3-paragraph summary",
            expected_output="A well-written 3-paragraph summary",
            agent=writer,
        )

        crew = Crew(
            agents=[researcher, writer],
            tasks=[research_task, writing_task],
            process=Process.sequential,
            verbose=False,
        )

        result = crew.kickoff()
        output = str(result)

        return {
            "success": True,
            "output": output,
            "crew_size": 2,
            "tasks_completed": 2,
            "inputTokens": getattr(result, "token_usage", {}).get("prompt_tokens", 500),
            "outputTokens": getattr(result, "token_usage", {}).get("completion_tokens", 200),
            "costCents": 5,
            "model": "gpt-4o-mini",
            "provider": "openai",
        }

    except (ImportError, Exception):
        # CrewAI not installed or not configured — run simulation
        print("[DEMO MODE] CrewAI not installed, running simulation...", file=sys.stderr)
        time.sleep(1)  # Simulate work

        iteration = 1
        if session_state:
            try:
                prev = json.loads(session_state)
                iteration = prev.get("iteration", 0) + 1
            except (json.JSONDecodeError, TypeError):
                pass

        output = (
            f"=== CrewAI Research & Write Crew (Iteration {iteration}) ===\n\n"
            f"Topic: {task_description}\n\n"
            f"[Researcher] Analyzed 5 sources on '{task_description}'.\n"
            f"Key findings: AI agent orchestration is a rapidly growing field with "
            f"key players including ShackleAI, Paperclip, and CrewAI.\n\n"
            f"[Writer] Summary:\n"
            f"AI agent orchestration platforms enable teams of autonomous AI workers "
            f"to collaborate on complex business objectives. These platforms provide "
            f"organizational hierarchies, task management, cost tracking, and governance "
            f"to prevent runaway spending and ensure accountability.\n\n"
            f"The market is evolving rapidly, with open-source solutions gaining traction "
            f"as organizations seek vendor-neutral approaches to managing their AI workforce. "
            f"Key differentiators include adapter flexibility, plugin ecosystems, and the "
            f"depth of governance controls available.\n\n"
            f"ShackleAI Orchestrator stands out with its CrewAI and OpenClaw adapter support, "
            f"git worktree isolation for parallel coding, and a governance-first approach "
            f"with default-deny policy matching.\n"
        )

        return {
            "success": True,
            "output": output,
            "crew_size": 2,
            "tasks_completed": 2,
            "iteration": iteration,
            "inputTokens": 450 + iteration * 50,
            "outputTokens": 180 + iteration * 20,
            "costCents": 3,
            "model": "gpt-4o-mini-simulated",
            "provider": "crewai",
        }


def main():
    parser = argparse.ArgumentParser(description="ShackleAI CrewAI Demo Agent")
    parser.add_argument("--task", required=True, help="JSON task payload from orchestrator")
    parser.add_argument("--session", default=None, help="Previous session state")
    parser.add_argument("--config", default=None, help="Optional crew config path")
    args = parser.parse_args()

    # Parse task from orchestrator payload
    try:
        payload = json.loads(args.task)
        task_desc = payload.get("task", "Research AI agent orchestration")
    except (json.JSONDecodeError, TypeError):
        task_desc = args.task  # Use raw string if not JSON

    agent_id = os.environ.get("SHACKLEAI_AGENT_ID", "unknown")
    run_id = os.environ.get("SHACKLEAI_RUN_ID", "unknown")

    print(f"[CrewAI] Agent={agent_id} Run={run_id}")
    print(f"[CrewAI] Task: {task_desc}")
    print()

    result = run_crew(task_desc, args.session)
    print(result["output"])

    # Emit structured result for the orchestrator to parse
    result_payload = {
        "sessionState": json.dumps({"iteration": result.get("iteration", 1), "lastTask": task_desc}),
        "inputTokens": result["inputTokens"],
        "outputTokens": result["outputTokens"],
        "costCents": result["costCents"],
        "model": result["model"],
        "provider": result["provider"],
    }
    print(f"\n{RESULT_MARKER}{json.dumps(result_payload)}{RESULT_MARKER}")


if __name__ == "__main__":
    main()
