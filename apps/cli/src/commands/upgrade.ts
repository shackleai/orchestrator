/**
 * `shackleai upgrade` — License key activation and status
 */

import type { Command } from 'commander'
import { apiClient, getCompanyId } from '../api-client.js'

interface LicenseInfo {
  tier: string
  valid_until: string | null
  last_validated_at: string | null
}

interface LicenseActivateResponse {
  data: LicenseInfo
  error?: string
}

async function activateKey(key: string): Promise<void> {
  const companyId = await getCompanyId()

  console.log('Activating license key...')

  const res = await apiClient(
    `/api/companies/${companyId}/license`,
    {
      method: 'POST',
      body: JSON.stringify({ key }),
    },
  )

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string
    }
    console.error(`Error: ${body.error ?? res.statusText}`)
    console.error(
      'License activation failed. The API endpoint may not be available yet.',
    )
    process.exit(1)
  }

  const body = (await res.json()) as LicenseActivateResponse
  console.log(`License activated.`)
  console.log(`  Tier:  ${body.data.tier}`)
  console.log(
    `  Valid: ${body.data.valid_until ? new Date(body.data.valid_until).toLocaleDateString() : 'indefinite'}`,
  )
}

async function showStatus(): Promise<void> {
  const companyId = await getCompanyId()

  const res = await apiClient(`/api/companies/${companyId}/license`)

  if (!res.ok) {
    if (res.status === 404) {
      console.log('No license key activated. Using free tier.')
      console.log('Run `shackleai upgrade --key <key>` to activate a license.')
      return
    }
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string
    }
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as LicenseActivateResponse
  console.log('License status:')
  console.log(`  Tier:      ${body.data.tier}`)
  console.log(
    `  Valid:     ${body.data.valid_until ? new Date(body.data.valid_until).toLocaleDateString() : 'indefinite'}`,
  )
  console.log(
    `  Validated: ${body.data.last_validated_at ? new Date(body.data.last_validated_at).toLocaleString() : 'never'}`,
  )
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Manage license key')
    .option('--key <key>', 'Activate a license key')
    .option('--status', 'Show current license status')
    .action(async (opts: { key?: string; status?: boolean }) => {
      if (opts.key) {
        await activateKey(opts.key)
      } else if (opts.status) {
        await showStatus()
      } else {
        // Default: show status
        await showStatus()
      }
    })
}
