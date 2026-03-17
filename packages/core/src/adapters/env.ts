/** Whitelist safe env vars for child processes — never leak host secrets */
export function getSafeEnv(
  extra: Record<string, string> = {},
): Record<string, string> {
  const safe: Record<string, string> = {}
  const ALLOWED_PREFIXES = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_',
    'SHACKLEAI_',
    'NODE_',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'PYTHON',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramFiles',
    'ProgramData',
    'HOMEDRIVE',
    'HOMEPATH',
    'VIRTUAL_ENV',
  ]

  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      ALLOWED_PREFIXES.some((p) => key.startsWith(p))
    ) {
      safe[key] = value
    }
  }

  // Also include SystemRoot and COMSPEC on Windows
  if (process.env.SystemRoot) safe.SystemRoot = process.env.SystemRoot
  if (process.env.COMSPEC) safe.COMSPEC = process.env.COMSPEC

  return { ...safe, ...extra }
}
