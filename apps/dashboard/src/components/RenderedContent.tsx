import { MermaidDiagram } from './MermaidDiagram'

/**
 * Regex to match fenced mermaid code blocks:
 *   ```mermaid
 *   <code>
 *   ```
 *
 * Captures the code inside the fences as group 1.
 */
const MERMAID_BLOCK_RE = /```mermaid\s*\n([\s\S]*?)```/g

interface ContentSegment {
  type: 'text' | 'mermaid'
  value: string
}

function parseContent(text: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  let lastIndex = 0

  // Reset regex state
  MERMAID_BLOCK_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = MERMAID_BLOCK_RE.exec(text)) !== null) {
    // Add any text before this match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }

    // Add the mermaid block
    segments.push({ type: 'mermaid', value: match[1] })

    lastIndex = match.index + match[0].length
  }

  // Add any remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments
}

interface RenderedContentProps {
  content: string
  className?: string
}

/**
 * Renders text content with mermaid code blocks converted to diagrams.
 * Plain text segments are rendered with whitespace preservation.
 * Mermaid fenced blocks (```mermaid ... ```) are rendered as SVG diagrams.
 */
export function RenderedContent({ content, className }: RenderedContentProps) {
  const segments = parseContent(content)

  // Fast path: no mermaid blocks found, render plain text
  if (segments.length === 1 && segments[0].type === 'text') {
    return <p className={`whitespace-pre-wrap ${className ?? ''}`}>{content}</p>
  }

  return (
    <div className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'mermaid') {
          return <MermaidDiagram key={index} code={segment.value} className="my-3" />
        }

        // Trim leading/trailing empty lines from text segments adjacent to diagrams
        const text = segment.value.replace(/^\n+|\n+$/g, '')
        if (!text) return null

        return (
          <p key={index} className="whitespace-pre-wrap">
            {text}
          </p>
        )
      })}
    </div>
  )
}
