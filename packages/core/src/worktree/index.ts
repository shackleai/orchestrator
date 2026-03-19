/**
 * Worktree module — git worktree management for parallel agent workspaces.
 */

export { WorktreeManager } from './manager.js'
export { WorkspacePolicyEngine } from './policy.js'
export { WorkspaceOperationLogger } from './operation-logger.js'
export type { LogOperationInput, OperationFilters } from './operation-logger.js'
