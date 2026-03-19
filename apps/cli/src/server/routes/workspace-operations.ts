/**
 * Workspace Operations routes — placeholder.
 * The import was added to server/index.ts but the route file was not committed.
 * This stub prevents build failures until the full implementation lands.
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'

export function workspaceOperationsRouter(_db: DatabaseProvider): Hono {
  return new Hono()
}
