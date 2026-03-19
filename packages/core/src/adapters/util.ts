/**
 * Shared utilities for CLI-based adapters.
 *
 * Extracted to avoid duplication across CLI adapters (Claude, Codex,
 * Cursor, Gemini, Kiro, and future CLI-based adapters).
 */

import type { AdapterContext, AdapterResult } from './adapter.js'

/**
 * Try to extract a __shackleai_result__ JSON block from output text.
 * Looks for `{"__shackleai_result__": ...}` anywhere in the output.
 */
export function parseShackleResult(
  text: string,
): { sessionState?: string; usage?: AdapterResult['usage'] } | null {
  const marker = '__shackleai_result__'
  const idx = text.indexOf(marker)
  if (idx === -1) return null

  const braceStart = text.lastIndexOf('{', idx)
  if (braceStart === -1) return null

  let depth = 0
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
    if (depth === 0) {
      try {
        const json = JSON.parse(text.slice(braceStart, i + 1)) as Record<string, unknown>
        const result = json[marker] as Record<string, unknown> | undefined
        if (!result) return null

        const parsed: { sessionState?: string; usage?: AdapterResult['usage'] } = {}

        if (typeof result.sessionState === 'string') {
          parsed.sessionState = result.sessionState
        }

        if (result.usage && typeof result.usage === 'object') {
          const u = result.usage as Record<string, unknown>
          parsed.usage = {
            inputTokens: (u.inputTokens as number) ?? 0,
            outputTokens: (u.outputTokens as number) ?? 0,
            costCents: (u.costCents as number) ?? 0,
            model: (u.model as string) ?? 'unknown',
            provider: (u.provider as string) ?? 'unknown',
          }
        }

        return parsed
      } catch {
        return null
      }
    }
  }

  return null
}

/**
 * Build the full prompt string by prepending system context and ancestry.
 */
export function buildFullPrompt(prompt: string, ctx: AdapterContext): string {
  let fullPrompt = prompt

  if (ctx.systemContext) {
    fullPrompt = `${ctx.systemContext}\n\n${fullPrompt}`
  }

  if (ctx.ancestry) {
    const parts: string[] = []
    if (ctx.ancestry.mission) parts.push(`Mission: ${ctx.ancestry.mission}`)
    if (ctx.ancestry.project) parts.push(`Project: ${ctx.ancestry.project.name}`)
    if (ctx.ancestry.goal) parts.push(`Goal: ${ctx.ancestry.goal.name}`)
    if (parts.length > 0) {
      fullPrompt = `Context: ${parts.join(' | ')}\n\n${fullPrompt}`
    }
  }

  return fullPrompt
}
