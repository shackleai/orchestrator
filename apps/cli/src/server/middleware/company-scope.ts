/**
 * company-scope middleware — validates :id param and attaches company to context
 */

import type { Context, Next } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Company } from '@shackleai/shared'

export type CompanyScopeVariables = {
  company: Company
  db: DatabaseProvider
}

export async function companyScope(
  c: Context<{ Variables: CompanyScopeVariables }>,
  next: Next,
): Promise<Response | void> {
  const id = c.req.param('id')

  const db = c.get('db')

  const result = await db.query<Company>(
    'SELECT * FROM companies WHERE id = $1',
    [id],
  )

  if (result.rows.length === 0) {
    return c.json({ error: 'Company not found' }, 404)
  }

  c.set('company', result.rows[0])

  return next()
}
