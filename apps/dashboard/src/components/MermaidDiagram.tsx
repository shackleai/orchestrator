import { useState, useEffect, useRef, useId } from 'react'
import mermaid from 'mermaid'
import { AlertTriangle } from 'lucide-react'

let mermaidInitialized = false

function initMermaid(theme: 'dark' | 'light') {
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  })
  mermaidInitialized = true
}

interface MermaidDiagramProps {
  code: string
  className?: string
}

export function MermaidDiagram({ code, className }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const uniqueId = useId().replace(/:/g, '_')

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const isDark = document.documentElement.classList.contains('dark')
        if (!mermaidInitialized) {
          initMermaid(isDark ? 'dark' : 'light')
        } else {
          // Re-initialize with correct theme each render
          mermaid.initialize({
            startOnLoad: false,
            theme: isDark ? 'dark' : 'default',
            securityLevel: 'strict',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          })
        }

        const diagramId = `mermaid_${uniqueId}_${Date.now()}`
        const { svg: rendered } = await mermaid.render(diagramId, code.trim())

        if (!cancelled) {
          setSvg(rendered)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null)
          setError(err instanceof Error ? err.message : 'Failed to render diagram')
        }
        // Clean up any orphaned error elements mermaid may have injected
        const errorEl = document.getElementById(`d${uniqueId}`)
        if (errorEl) errorEl.remove()
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [code, uniqueId])

  if (error) {
    return (
      <div className={`rounded-md border border-destructive/30 bg-destructive/5 p-3 ${className ?? ''}`}>
        <div className="flex items-center gap-2 mb-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Failed to render Mermaid diagram</span>
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            className="ml-auto text-xs underline text-muted-foreground hover:text-foreground"
          >
            {showCode ? 'Hide code' : 'Show code'}
          </button>
        </div>
        {showCode && (
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs font-mono whitespace-pre-wrap">
            {code}
          </pre>
        )}
      </div>
    )
  }

  if (!svg) {
    return (
      <div className={`flex items-center justify-center rounded-md border border-border bg-muted/30 p-6 ${className ?? ''}`}>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-x-auto rounded-md border border-border bg-card p-4 [&_svg]:max-w-full [&_svg]:h-auto ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label="Mermaid diagram"
    />
  )
}
