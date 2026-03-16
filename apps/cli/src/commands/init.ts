/**
 * `shackleai init` — Interactive setup wizard using @clack/prompts
 */

import * as p from '@clack/prompts'
import { PGliteProvider, PgProvider, runMigrations } from '@shackleai/db'
import { AdapterType } from '@shackleai/shared'
import type { DatabaseProvider } from '@shackleai/db'
import { writeConfig } from '../config.js'

const VERSION = '0.1.0'

export async function initCommand(): Promise<void> {
  p.intro(`ShackleAI Orchestrator v${VERSION}`)

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

  const companyResult = await db.query<{ id: string }>(
    `INSERT INTO companies (name, description, issue_prefix)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [companyName.trim(), mission?.trim() || null, issuePrefix || 'MAIN'],
  )
  const companyId = companyResult.rows[0].id
  spin.stop('Company created')

  // Optionally create first agent
  const createAgent = await p.confirm({
    message: 'Create your first agent?',
    initialValue: true,
  })

  if (p.isCancel(createAgent)) {
    p.cancel('Setup cancelled.')
    await db.close()
    process.exit(0)
  }

  if (createAgent) {
    const agentName = await p.text({
      message: 'Agent name',
      placeholder: 'coder-bot',
      validate: (v) => {
        if (!v.trim()) return 'Agent name is required'
        return undefined
      },
    })

    if (p.isCancel(agentName)) {
      p.cancel('Setup cancelled.')
      await db.close()
      process.exit(0)
    }

    const agentRole = await p.text({
      message: 'Agent role',
      placeholder: 'engineer',
      validate: (v) => {
        if (!v.trim()) return 'Agent role is required'
        return undefined
      },
    })

    if (p.isCancel(agentRole)) {
      p.cancel('Setup cancelled.')
      await db.close()
      process.exit(0)
    }

    const adapterOptions = Object.entries(AdapterType).map(([key, value]) => ({
      value,
      label: key,
    }))

    const adapterType = await p.select({
      message: 'Adapter type',
      options: adapterOptions,
    })

    if (p.isCancel(adapterType)) {
      p.cancel('Setup cancelled.')
      await db.close()
      process.exit(0)
    }

    spin.start('Creating agent...')
    await db.query(
      `INSERT INTO agents (company_id, name, role, adapter_type)
       VALUES ($1, $2, $3, $4)`,
      [companyId, agentName.trim(), agentRole.trim(), adapterType],
    )
    spin.stop('Agent created')
  }

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
