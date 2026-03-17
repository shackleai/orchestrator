/**
 * `shackleai comment` — List and add threaded comments on issues
 */

import type { Command } from 'commander'
import type { IssueComment } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

function formatCommentTable(comments: IssueComment[]): void {
  if (comments.length === 0) {
    console.log('No comments found.')
    return
  }

  const rows = comments.map((c) => ({
    ID: c.id.slice(0, 8),
    Author: c.author_agent_id ? c.author_agent_id.slice(0, 8) : 'system',
    Content: c.content.length > 60 ? c.content.slice(0, 57) + '...' : c.content,
    Thread: c.parent_id ? c.parent_id.slice(0, 8) : '-',
    Resolved: c.is_resolved ? 'yes' : 'no',
    Created: new Date(c.created_at).toLocaleString(),
  }))

  console.table(rows)
}

async function listComments(issueId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/issues/${issueId}/comments`)

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<IssueComment[]>
  formatCommentTable(body.data)
}

async function addComment(issueId: string, message: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/issues/${issueId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content: message }),
  })

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<IssueComment>
  console.log(`Comment added (${body.data.id.slice(0, 8)}) on issue ${issueId.slice(0, 8)}`)
}

export function registerCommentCommand(program: Command): void {
  const comment = program
    .command('comment')
    .description('Manage comments on issues')

  comment
    .command('list')
    .argument('<issueId>', 'Issue ID')
    .description('List comments on an issue')
    .action(async (issueId: string) => {
      await listComments(issueId)
    })

  comment
    .command('add')
    .argument('<issueId>', 'Issue ID')
    .argument('<message>', 'Comment message')
    .description('Add a comment to an issue')
    .action(async (issueId: string, message: string) => {
      await addComment(issueId, message)
    })
}
