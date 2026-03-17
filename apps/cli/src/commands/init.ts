/**
 * `shackleai init` — Interactive setup wizard using @clack/prompts
 */

import * as p from '@clack/prompts'
import { PGliteProvider, PgProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { readConfig, writeConfig } from '../config.js'
import { VERSION } from '../index.js'

export interface InitOptions {
  force?: boolean
  yes?: boolean
  name?: string
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  p.intro(`ShackleAI Orchestrator v${VERSION}`)

  // Check if already initialized
  const existingConfig = await readConfig()
  if (existingConfig && !options.force) {
    p.log.warning(
      'ShackleAI is already initialized. Run with --force to reinitialize.',
    )
    p.outro(`Company: ${existingConfig.companyName} (${existingConfig.companyId})`)
    return
  }

  // Non-interactive mode
  if (options.yes) {
    if (!options.name) {
      p.log.error('Company name required with --yes. Use --name flag.')
      process.exit(1)
    }

    return initNonInteractive(options.name)
  }

  const mode = await p.select({
    message: 'Deployment mode',
    options: [
      { value: 'local', label: 'Local', hint: 'Embedded PGlite database' },
      {
        value: 'server',
        label: 'Server',
        hint: 'External PostgreSQL database',
      },
    ],
  })

  if (p.isCancel(mode)) {
    p.cancel('Setup cancelled.')
    process.exit(0)
  }

  const companyName = await p.text({
    message: 'Company name',
    placeholder: 'Acme Corp',
    validate: (v) => {
      if (!v.trim()) return 'Company name is required'
      return undefined
    },
  })

  if (p.isCancel(companyName)) {
    p.cancel('Setup cancelled.')
    process.exit(0)
  }

  const mission = await p.text({
    message: 'Company mission (optional)',
    placeholder: 'Build the future of AI',
  })

  if (p.isCancel(mission)) {
    p.cancel('Setup cancelled.')
    process.exit(0)
  }

  let databaseUrl: string | undefined
  if (mode === 'server') {
    const urlInput = await p.text({
      message: 'DATABASE_URL',
      placeholder: 'postgresql://user:pass@host:5432/dbname',
      validate: (v) => {
        if (!v.trim()) return 'Database URL is required for server mode'
        return undefined
      },
    })

    if (p.isCancel(urlInput)) {
      p.cancel('Setup cancelled.')
      process.exit(0)
    }
    databaseUrl = urlInput
  }

  // Initialize DB
  const spin = p.spinner()
  spin.start('Initializing database...')

  let db: DatabaseProvider
  if (mode === 'local') {
    db = new PGliteProvider('default')
  } else {
    db = new PgProvider(databaseUrl!)
  }

  await runMigrations(db)
  spin.stop('Database initialized')

  // Create company record
  spin.start('Creating company...')
  const issuePrefix = companyName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5)

  let companyId: string
  try {
    const companyResult = await db.query<{ id: string }>(
      `INSERT INTO companies (name, description, issue_prefix)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [companyName.trim(), mission?.trim() || null, issuePrefix || 'MAIN'],
    )
    companyId = companyResult.rows[0].id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('unique') || message.includes('duplicate')) {
      spin.stop('Company already exists')
      p.log.warning(
        `A company named "${companyName.trim()}" already exists. Run with --force to reinitialize or choose a different name.`,
      )
      await db.close()
      process.exit(1)
    }
    spin.stop('Failed to create company')
    console.error(`Database error: ${message}`)
    await db.close()
    process.exit(1)
  }
  spin.stop('Company created')

  // Save config
  await writeConfig({
    mode: mode as 'local' | 'server',
    companyId,
    companyName: companyName.trim(),
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(mode === 'local' ? { dataDir: 'default' } : {}),
  })

  await db.close()

  p.outro(`Setup complete! Run \`shackleai start\` to launch the server.`)
}

/**
 * Non-interactive init — skips all prompts, uses defaults:
 * local mode, no mission, no agent creation.
 */
async function initNonInteractive(companyName: string): Promise<void> {
  const spin = p.spinner()
  spin.start('Initializing database...')

  const db = new PGliteProvider('default')
  await runMigrations(db)
  spin.stop('Database initialized')

  spin.start('Creating company...')
  const issuePrefix = companyName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5)

  let companyId: string
  try {
    const companyResult = await db.query<{ id: string }>(
      `INSERT INTO companies (name, description, issue_prefix)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [companyName.trim(), null, issuePrefix || 'MAIN'],
    )
    companyId = companyResult.rows[0].id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    spin.stop('Failed to create company')
    console.error(`Database error: ${message}`)
    await db.close()
    process.exit(1)
  }
  spin.stop('Company created')

  await writeConfig({
    mode: 'local',
    companyId,
    companyName: companyName.trim(),
    dataDir: 'default',
  })

  await db.close()

  p.outro(`Setup complete! Run \`shackleai start\` to launch the server.`)
}
