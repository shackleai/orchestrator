/**
 * Adapter error classification — maps raw adapter errors to actionable
 * error categories with fix instructions for the dashboard.
 *
 * When a heartbeat fails because an adapter dependency is missing, the
 * executor tags the heartbeat_run with a structured error_category and
 * fix_instructions so the dashboard can show actionable messages.
 */

export type AdapterErrorCategory =
  | 'dependency_missing'
  | 'dependency_outdated'
  | 'config_invalid'
  | 'timeout'
  | 'runtime_error'
  | 'unknown'

export interface ClassifiedError {
  /** Machine-readable error category. */
  category: AdapterErrorCategory
  /** Human-readable fix instructions for the user. */
  fixInstructions: string
  /** Short summary for dashboard display. */
  summary: string
}

interface ErrorPattern {
  adapterType: string
  /** Patterns to match against the error message (case-insensitive). */
  patterns: RegExp[]
  /** Also match on exit code 127 (command not found). */
  matchExitCode127: boolean
  fixInstructions: string
  summary: string
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Claude Code CLI
  {
    adapterType: 'claude',
    patterns: [
      /claude[:\s].*not found/i,
      /Failed to spawn claude CLI/i,
      /ENOENT.*claude/i,
    ],
    matchExitCode127: true,
    fixInstructions:
      'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code\nDocs: https://docs.anthropic.com/en/docs/claude-code',
    summary: 'Claude Code CLI is not installed',
  },
  // OpenClaw
  {
    adapterType: 'openclaw',
    patterns: [
      /Python not found/i,
      /python.*not found/i,
      /ENOENT.*python/i,
    ],
    matchExitCode127: false,
    fixInstructions:
      'Install Python 3.8+: https://python.org/downloads\nThen install OpenClaw: pip install openclaw',
    summary: 'Python is not installed',
  },
  {
    adapterType: 'openclaw',
    patterns: [
      /OpenClaw not installed/i,
      /openclaw.*not found/i,
      /No module named.*openclaw/i,
      /ModuleNotFoundError.*openclaw/i,
    ],
    matchExitCode127: false,
    fixInstructions: 'Install OpenClaw: pip install openclaw',
    summary: 'OpenClaw is not installed',
  },
  // CrewAI
  {
    adapterType: 'crewai',
    patterns: [
      /Python not available/i,
      /python.*not found/i,
      /ENOENT.*python/i,
    ],
    matchExitCode127: false,
    fixInstructions:
      'Install Python 3.8+: https://python.org/downloads\nThen install CrewAI: pip install crewai',
    summary: 'Python is not installed',
  },
  {
    adapterType: 'crewai',
    patterns: [
      /CrewAI not available/i,
      /crewai.*not found/i,
      /No module named.*crewai/i,
      /ModuleNotFoundError.*crewai/i,
    ],
    matchExitCode127: false,
    fixInstructions: 'Install CrewAI: pip install crewai',
    summary: 'CrewAI is not installed',
  },
  // MCP
  {
    adapterType: 'mcp',
    patterns: [
      /Cannot find module/i,
      /Failed to load @modelcontextprotocol\/sdk/i,
      /modelcontextprotocol.*not installed/i,
    ],
    matchExitCode127: false,
    fixInstructions:
      'Install MCP SDK: pnpm add @modelcontextprotocol/sdk',
    summary: '@modelcontextprotocol/sdk is not installed',
  },
  // Codex
  {
    adapterType: 'codex',
    patterns: [
      /codex[:\s].*not found/i,
      /Failed to spawn codex/i,
      /ENOENT.*codex/i,
    ],
    matchExitCode127: true,
    fixInstructions:
      'Install OpenAI Codex CLI: npm install -g @openai/codex',
    summary: 'Codex CLI is not installed',
  },
  // Cursor
  {
    adapterType: 'cursor',
    patterns: [
      /cursor[:\s].*not found/i,
      /Failed to spawn cursor/i,
      /ENOENT.*cursor/i,
    ],
    matchExitCode127: true,
    fixInstructions:
      'Install Cursor: https://cursor.com/downloads',
    summary: 'Cursor is not installed',
  },
  // Gemini
  {
    adapterType: 'gemini',
    patterns: [
      /gemini[:\s].*not found/i,
      /Failed to spawn gemini/i,
      /ENOENT.*gemini/i,
    ],
    matchExitCode127: true,
    fixInstructions:
      'Install Gemini CLI: npm install -g @anthropic-ai/gemini',
    summary: 'Gemini CLI is not installed',
  },
  // Kiro
  {
    adapterType: 'kiro',
    patterns: [
      /kiro[:\s].*not found/i,
      /Failed to spawn kiro/i,
      /ENOENT.*kiro/i,
    ],
    matchExitCode127: true,
    fixInstructions:
      'Install Kiro: https://kiro.dev/downloads',
    summary: 'Kiro is not installed',
  },
  // OpenCode
  {
    adapterType: 'opencode',
    patterns: [
      /opencode[:\s].*not found/i,
      /Failed to spawn opencode/i,
      /ENOENT.*opencode/i,
    ],
    matchExitCode127: true,
    fixInstructions:
      'Install OpenCode: go install github.com/opencode-ai/opencode@latest',
    summary: 'OpenCode is not installed',
  },
]

/**
 * Classify an adapter error into a structured category with fix instructions.
 *
 * @param adapterType - The adapter type (e.g. 'claude', 'openclaw')
 * @param errorMessage - The raw error message (stderr)
 * @param exitCode - The process exit code (127 = command not found)
 * @returns Classified error with category, fix instructions, and summary
 */
export function classifyAdapterError(
  adapterType: string,
  errorMessage: string,
  exitCode: number | null,
): ClassifiedError {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.adapterType !== adapterType) continue

    // Check exit code 127 match
    if (pattern.matchExitCode127 && exitCode === 127) {
      return {
        category: 'dependency_missing',
        fixInstructions: pattern.fixInstructions,
        summary: pattern.summary,
      }
    }

    // Check regex pattern match
    for (const regex of pattern.patterns) {
      if (regex.test(errorMessage)) {
        return {
          category: 'dependency_missing',
          fixInstructions: pattern.fixInstructions,
          summary: pattern.summary,
        }
      }
    }
  }

  // Fallback classifications
  if (exitCode === 127) {
    return {
      category: 'dependency_missing',
      fixInstructions: `The ${adapterType} adapter command was not found. Check that it is installed and available in PATH.`,
      summary: `${adapterType} command not found`,
    }
  }

  if (exitCode === 124) {
    return {
      category: 'timeout',
      fixInstructions: 'The adapter timed out. Consider increasing the timeout in adapter_config.',
      summary: 'Adapter execution timed out',
    }
  }

  return {
    category: 'unknown',
    fixInstructions: '',
    summary: 'Adapter execution failed',
  }
}

/**
 * Get fix instructions for a given adapter type.
 * Used by the doctor command and agent creation validation to show
 * install instructions when testEnvironment() fails.
 */
export function getAdapterFixInstructions(adapterType: string): string {
  const patterns = ERROR_PATTERNS.filter((p) => p.adapterType === adapterType)
  if (patterns.length === 0) {
    return `Check that the ${adapterType} adapter runtime is installed and available in PATH.`
  }
  // Return the first (most likely) fix instruction
  return patterns[0].fixInstructions
}
