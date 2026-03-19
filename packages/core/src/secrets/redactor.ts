/**
 * LogRedactor — scans strings for known secret values and replaces them with [REDACTED].
 *
 * Used to sanitize adapter stdout/stderr before storage/display.
 */

export class LogRedactor {
  private secrets: Set<string> = new Set()

  /** Register secret values that should be redacted from output. */
  addSecrets(values: string[]): void {
    for (const v of values) {
      // Only redact non-trivial values (>= 4 chars) to avoid false positives
      if (v.length >= 4) {
        this.secrets.add(v)
      }
    }
  }

  /** Clear all registered secrets. */
  clear(): void {
    this.secrets.clear()
  }

  /** Redact all known secret values from the given text. */
  redact(text: string): string {
    if (this.secrets.size === 0) return text

    let result = text
    for (const secret of this.secrets) {
      while (result.includes(secret)) {
        result = result.split(secret).join('[REDACTED]')
      }
    }

    return result
  }
}
