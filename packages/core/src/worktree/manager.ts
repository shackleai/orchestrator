/**
 * WorktreeManager — creates, destroys, and inspects git worktrees
 * for parallel isolated agent workspaces.
 *
 * All git operations use child_process.execFile for safety (no shell injection).
 * Cross-platform: uses path.join everywhere.
 */

import { execFile } from 'node:child_process'
import { join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { DatabaseProvider } from '@shackleai/db'
import type {
  AgentWorktree,
  WorktreeInfo,
  CleanupResult,
} from '@shackleai/shared'
import {
  WorktreeStatus,
  FREE_TIER_MAX_WORKTREES,
  WORKTREE_MAX_AGE_MS,
  GIT_MIN_VERSION,
} from '@shackleai/shared'

const execFileAsync = promisify(execFile)

/** Directory name inside the repo where worktrees live. */
const WORKTREE_DIR = '.worktrees'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout: 30_000,
  })
  return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd() }
}

async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], dirPath)
    return true
  } catch {
    return false
  }
}

async function branchExists(
  repoPath: string,
  branch: string,
): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', branch], repoPath)
    return true
  } catch {
    return false
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath)
    return s.isDirectory()
  } catch {
    return false
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

// ---------------------------------------------------------------------------
// WorktreeManager
// ---------------------------------------------------------------------------

interface CreateOptions {
  repoPath: string
  agentId: string
  companyId: string
  branchName: string
  baseBranch?: string
  issueId?: string
}

interface CleanupOptions {
  maxAgeMs?: number
  dryRun?: boolean
}

export class WorktreeManager {
  private db: DatabaseProvider

  constructor(db: DatabaseProvider) {
    this.db = db
  }

  // ── Create ──────────────────────────────────────────────────────────────

  async create(opts: CreateOptions): Promise<WorktreeInfo> {
    const {
      repoPath,
      agentId,
      companyId,
      branchName,
      baseBranch = 'main',
      issueId,
    } = opts

    // Validate repo
    if (!(await dirExists(repoPath))) {
      throw new Error(`Repository path does not exist: ${repoPath}`)
    }
    if (!(await isGitRepo(repoPath))) {
      throw new Error(`Not a git repository: ${repoPath}`)
    }

    // Validate base branch exists
    if (!(await branchExists(repoPath, baseBranch))) {
      throw new Error(`Base branch does not exist: ${baseBranch}`)
    }

    // Check for duplicate branch
    if (await branchExists(repoPath, branchName)) {
      throw new Error(`Branch already exists: ${branchName}`)
    }

    // Check free tier limit
    await this.checkWorktreeLimit(companyId)

    // Build worktree path
    const safeDirName = `${agentId.slice(0, 8)}-${branchName.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    const worktreePath = join(repoPath, WORKTREE_DIR, safeDirName)

    // Create the worktree
    await git(
      ['worktree', 'add', worktreePath, '-b', branchName, baseBranch],
      repoPath,
    )

    // Record in DB
    const id = randomUUID()
    await this.db.query(
      `INSERT INTO agent_worktrees
         (id, agent_id, company_id, issue_id, repo_path, worktree_path, branch, base_branch, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        agentId,
        companyId,
        issueId ?? null,
        repoPath,
        worktreePath,
        branchName,
        baseBranch,
        WorktreeStatus.Active,
      ],
    )

    return {
      path: worktreePath,
      branch: branchName,
      baseBranch,
      agentId,
      companyId,
      issueId: issueId ?? undefined,
      status: 'active',
      isDirty: false,
      commitsAhead: 0,
      commitsBehind: 0,
      createdAt: new Date(),
    }
  }

  // ── Destroy ─────────────────────────────────────────────────────────────

  async destroy(worktreePath: string): Promise<void> {
    if (!(await dirExists(worktreePath))) {
      // Already gone — just clean up DB
      await this.removeDbRecord(worktreePath)
      return
    }

    // Check for uncommitted changes — NEVER lose work
    const isDirty = await this.checkDirty(worktreePath)
    if (isDirty) {
      // Stash changes before removal
      await git(['stash', 'push', '-m', 'shackleai-auto-stash'], worktreePath)
      console.warn(
        `Warning: Uncommitted changes in ${worktreePath} have been stashed.`,
      )
    }

    // Find the main repo path from the worktree
    const { stdout: repoRoot } = await git(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      worktreePath,
    )
    // git-common-dir returns the .git dir; the repo is one level up
    const repoPath = join(repoRoot, '..')

    await git(['worktree', 'remove', worktreePath], repoPath)
    await git(['worktree', 'prune'], repoPath)

    await this.removeDbRecord(worktreePath)
  }

  // ── List (git-based) ───────────────────────────────────────────────────

  async listGit(repoPath: string): Promise<WorktreeInfo[]> {
    const { stdout } = await git(['worktree', 'list', '--porcelain'], repoPath)
    if (!stdout) return []

    const entries: WorktreeInfo[] = []
    const blocks = stdout.split('\n\n')

    for (const block of blocks) {
      const lines = block.split('\n')
      let path = ''
      let branch = ''

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice('worktree '.length)
        }
        if (line.startsWith('branch ')) {
          // refs/heads/branchname
          branch = line.slice('branch '.length).replace('refs/heads/', '')
        }
      }

      // Skip the main worktree (the repo itself)
      if (!path || !path.includes(WORKTREE_DIR)) continue

      // Look up DB record
      const dbRecord = await this.getDbRecordByPath(path)

      entries.push({
        path,
        branch,
        baseBranch: dbRecord?.base_branch ?? 'main',
        agentId: dbRecord?.agent_id ?? 'unknown',
        companyId: dbRecord?.company_id ?? 'unknown',
        issueId: dbRecord?.issue_id ?? undefined,
        status: (dbRecord?.status as WorktreeInfo['status']) ?? 'active',
        isDirty: await this.checkDirty(path),
        commitsAhead: 0,
        commitsBehind: 0,
        createdAt: dbRecord?.created_at ? new Date(dbRecord.created_at) : new Date(),
      })
    }

    return entries
  }

  // ── List (DB-based, by company/agent) ──────────────────────────────────

  async list(
    companyId: string,
    agentId?: string,
    pagination?: { limit: number; offset: number },
  ): Promise<AgentWorktree[]> {
    const limit = pagination?.limit ?? 100
    const offset = pagination?.offset ?? 0

    if (agentId) {
      const result = await this.db.query<AgentWorktree>(
        `SELECT * FROM agent_worktrees
         WHERE company_id = $1 AND agent_id = $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [companyId, agentId, limit, offset],
      )
      return result.rows
    }

    const result = await this.db.query<AgentWorktree>(
      `SELECT * FROM agent_worktrees
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
    )
    return result.rows
  }

  // ── Get ─────────────────────────────────────────────────────────────────

  async get(worktreePath: string): Promise<WorktreeInfo | null> {
    const dbRecord = await this.getDbRecordByPath(worktreePath)
    if (!dbRecord) return null

    const exists = await dirExists(worktreePath)
    const isDirty = exists ? await this.checkDirty(worktreePath) : false

    let commitsAhead = 0
    let commitsBehind = 0

    if (exists) {
      try {
        const { stdout } = await git(
          ['rev-list', '--left-right', '--count', `${dbRecord.base_branch}...HEAD`],
          worktreePath,
        )
        const [behind, ahead] = stdout.split('\t').map(Number)
        commitsBehind = behind ?? 0
        commitsAhead = ahead ?? 0
      } catch {
        // Remote tracking not set up — ignore
      }
    }

    return {
      path: dbRecord.worktree_path,
      branch: dbRecord.branch,
      baseBranch: dbRecord.base_branch,
      agentId: dbRecord.agent_id,
      companyId: dbRecord.company_id,
      issueId: dbRecord.issue_id ?? undefined,
      status: dbRecord.status as WorktreeInfo['status'],
      isDirty,
      commitsAhead,
      commitsBehind,
      createdAt: new Date(dbRecord.created_at),
    }
  }

  // ── Get by ID ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<AgentWorktree | null> {
    const result = await this.db.query<AgentWorktree>(
      `SELECT * FROM agent_worktrees WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  async cleanup(
    companyId: string,
    options?: CleanupOptions,
  ): Promise<CleanupResult> {
    const maxAgeMs = options?.maxAgeMs ?? WORKTREE_MAX_AGE_MS
    const dryRun = options?.dryRun ?? false
    const cutoff = new Date(Date.now() - maxAgeMs)

    const result: CleanupResult = {
      removed: [],
      stashed: [],
      skipped: [],
    }

    // Get worktrees for terminated agents OR older than maxAge
    const rows = await this.db.query<AgentWorktree>(
      `SELECT w.* FROM agent_worktrees w
       LEFT JOIN agents a ON a.id = w.agent_id
       WHERE w.company_id = $1
         AND (a.status = 'terminated' OR w.last_used_at < $2)`,
      [companyId, cutoff.toISOString()],
    )

    for (const row of rows.rows) {
      const exists = await dirExists(row.worktree_path)
      if (!exists) {
        // Worktree dir gone — just clean up DB
        if (!dryRun) {
          await this.removeDbRecord(row.worktree_path)
        }
        result.removed.push(row.worktree_path)
        continue
      }

      const isDirty = await this.checkDirty(row.worktree_path)
      if (isDirty) {
        // NEVER force-delete with uncommitted changes
        if (!dryRun) {
          try {
            await git(
              ['stash', 'push', '-m', 'shackleai-cleanup-stash'],
              row.worktree_path,
            )
            result.stashed.push(row.worktree_path)
          } catch {
            result.skipped.push(row.worktree_path)
            continue
          }
        } else {
          result.skipped.push(row.worktree_path)
          continue
        }
      }

      if (!dryRun) {
        try {
          await git(['worktree', 'remove', row.worktree_path], row.repo_path)
          await git(['worktree', 'prune'], row.repo_path)
          await this.removeDbRecord(row.worktree_path)
          result.removed.push(row.worktree_path)
        } catch {
          result.skipped.push(row.worktree_path)
        }
      } else {
        result.removed.push(row.worktree_path)
      }
    }

    return result
  }

  // ── Touch (update last_used_at) ────────────────────────────────────────

  async touch(worktreePath: string): Promise<void> {
    await this.db.query(
      `UPDATE agent_worktrees SET last_used_at = NOW() WHERE worktree_path = $1`,
      [worktreePath],
    )
  }

  // ── Static utilities ───────────────────────────────────────────────────

  static async checkGitVersion(): Promise<{
    ok: boolean
    version: string
    error?: string
  }> {
    try {
      const { stdout } = await execFileAsync('git', ['--version'], {
        timeout: 5_000,
      })
      // "git version 2.43.0" or "git version 2.43.0.windows.1"
      const match = stdout.match(/(\d+\.\d+\.\d+)/)
      const version = match?.[1] ?? '0.0.0'

      if (compareVersions(version, GIT_MIN_VERSION) < 0) {
        return {
          ok: false,
          version,
          error: `Git ${GIT_MIN_VERSION}+ required for worktree support (found ${version})`,
        }
      }

      return { ok: true, version }
    } catch {
      return { ok: false, version: '0.0.0', error: 'Git not found in PATH' }
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async checkDirty(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await git(['status', '--porcelain'], worktreePath)
      return stdout.length > 0
    } catch {
      return false
    }
  }

  private async checkWorktreeLimit(companyId: string): Promise<void> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_worktrees
       WHERE company_id = $1 AND status = 'active'`,
      [companyId],
    )

    const count = parseInt(result.rows[0]?.count ?? '0', 10)
    if (count >= FREE_TIER_MAX_WORKTREES) {
      throw new Error(
        `Free tier limit reached: maximum ${FREE_TIER_MAX_WORKTREES} concurrent active worktrees. ` +
          `Upgrade to Pro for unlimited worktrees: https://shackleai.com/pricing`,
      )
    }
  }

  private async getDbRecordByPath(
    worktreePath: string,
  ): Promise<AgentWorktree | null> {
    // Normalize path for case-insensitive Windows filesystems
    let normalized = resolve(worktreePath)
    if (process.platform === 'win32') {
      normalized = normalized.toLowerCase()
    }

    const result = await this.db.query<AgentWorktree>(
      process.platform === 'win32'
        ? `SELECT * FROM agent_worktrees WHERE LOWER(worktree_path) = $1`
        : `SELECT * FROM agent_worktrees WHERE worktree_path = $1`,
      [normalized],
    )
    return result.rows[0] ?? null
  }

  private async removeDbRecord(worktreePath: string): Promise<void> {
    await this.db.query(
      `DELETE FROM agent_worktrees WHERE worktree_path = $1`,
      [worktreePath],
    )
  }
}
