"""
My first CrewAI agent managed by ShackleAI Orchestrator.

This crew has 2 agents:
  1. Researcher - finds information
  2. Writer - writes a summary

The orchestrator calls this file during heartbeats.
"""

import argparse
import json
import os
from crewai import Agent, Task, Crew, Process

# ── Define the AI Agents ──────────────────────────────

researcher = Agent(
    role="Senior Research Analyst",
    goal="Find accurate, up-to-date information on the given topic",
    backstory="You are an expert analyst who researches technology trends.",
    verbose=True,
    allow_delegation=False,
)

writer = Agent(
    role="Technical Writer",
    goal="Write clear 3-paragraph summaries from research findings",
    backstory="You turn complex research into easy-to-read content.",
    verbose=True,
    allow_delegation=False,
)

# ── Main function ─────────────────────────────────────

def main():
    # Parse the task from orchestrator (or command line)
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", required=True, help="Task description or JSON payload")
    parser.add_argument("--session", default=None)
    args = parser.parse_args()

    # Extract task text
    try:
        payload = json.loads(args.task)
        task_text = payload.get("task", args.task)
    except (json.JSONDecodeError, TypeError):
        task_text = args.task

    print(f"[CrewAI] Agent: {os.environ.get('SHACKLEAI_AGENT_ID', 'standalone')}")
    print(f"[CrewAI] Task: {task_text}")
    print()

    # ── Define the Tasks ──────────────────────────────

    research_task = Task(
        description=f"Research this topic thoroughly: {task_text}",
        expected_output="A detailed report with key findings and data points",
        agent=researcher,
    )

    writing_task = Task(
        description="Write a clear 3-paragraph summary based on the research",
        expected_output="A polished 3-paragraph summary",
        agent=writer,
    )

    # ── Create and Run the Crew ───────────────────────

    crew = Crew(
        agents=[researcher, writer],
        tasks=[research_task, writing_task],
        process=Process.sequential,
        verbose=True,
    )

    result = crew.kickoff()
    print("\n=== FINAL OUTPUT ===")
    print(result)

    # ── Report results back to orchestrator ───────────

    result_payload = {
        "sessionState": json.dumps({"lastTask": task_text}),
        "taskStatus": "done",
        "inputTokens": 500,
        "outputTokens": 300,
        "costCents": 5,
        "model": "gpt-4o-mini",
        "provider": "openai",
    }
    print(f"\n__shackleai_result__{json.dumps(result_payload)}__shackleai_result__")


if __name__ == "__main__":
    main()
