import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  CreateCompanyInput,
  UpdateCompanyInput,
  CreateAgentInput,
  UpdateAgentInput,
  CreateIssueInput,
  UpdateIssueInput,
  CreateGoalInput,
  CreateProjectInput,
  CreateIssueCommentInput,
  CreatePolicyInput,
  UpdatePolicyInput,
  CreateCostEventInput,
  CreateHeartbeatRunInput,
  UpdateHeartbeatRunInput,
  CreateAgentApiKeyInput,
} from '../src/validators.js'

const VALID_UUID = randomUUID()
const VALID_UUID_2 = randomUUID()

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

describe('CreateCompanyInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateCompanyInput.parse({
      name: 'Acme Corp',
      issue_prefix: 'ACM',
    })
    expect(result.name).toBe('Acme Corp')
    expect(result.status).toBe('active')
    expect(result.budget_monthly_cents).toBe(0)
  })

  it('accepts full input', () => {
    const result = CreateCompanyInput.parse({
      name: 'Acme Corp',
      description: 'A test company',
      status: 'inactive',
      issue_prefix: 'ACM',
      budget_monthly_cents: 10000,
    })
    expect(result.status).toBe('inactive')
    expect(result.budget_monthly_cents).toBe(10000)
  })

  it('rejects empty name', () => {
    expect(() =>
      CreateCompanyInput.parse({ name: '', issue_prefix: 'ACM' }),
    ).toThrow()
  })

  it('rejects missing issue_prefix', () => {
    expect(() => CreateCompanyInput.parse({ name: 'Acme' })).toThrow()
  })

  it('rejects invalid status', () => {
    expect(() =>
      CreateCompanyInput.parse({
        name: 'Acme',
        issue_prefix: 'ACM',
        status: 'deleted',
      }),
    ).toThrow()
  })

  it('rejects negative budget', () => {
    expect(() =>
      CreateCompanyInput.parse({
        name: 'Acme',
        issue_prefix: 'ACM',
        budget_monthly_cents: -100,
      }),
    ).toThrow()
  })
})

describe('UpdateCompanyInput', () => {
  it('accepts partial update', () => {
    const result = UpdateCompanyInput.parse({ name: 'New Name' })
    expect(result.name).toBe('New Name')
  })

  it('accepts empty object', () => {
    const result = UpdateCompanyInput.parse({})
    expect(result).toEqual({})
  })

  it('rejects invalid status', () => {
    expect(() => UpdateCompanyInput.parse({ status: 'bad' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

describe('CreateAgentInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateAgentInput.parse({
      company_id: VALID_UUID,
      name: 'Agent Smith',
    })
    expect(result.role).toBe('general')
    expect(result.status).toBe('idle')
    expect(result.adapter_type).toBe('process')
    expect(result.adapter_config).toEqual({})
  })

  it('accepts full input', () => {
    const result = CreateAgentInput.parse({
      company_id: VALID_UUID,
      name: 'Agent Smith',
      title: 'Senior Agent',
      role: 'ceo',
      status: 'active',
      reports_to: VALID_UUID_2,
      capabilities: 'code,review',
      adapter_type: 'claude',
      adapter_config: { model: 'opus' },
      budget_monthly_cents: 5000,
    })
    expect(result.role).toBe('ceo')
    expect(result.adapter_type).toBe('claude')
  })

  it('rejects invalid UUID for company_id', () => {
    expect(() =>
      CreateAgentInput.parse({ company_id: 'not-a-uuid', name: 'Agent' }),
    ).toThrow()
  })

  it('rejects empty name', () => {
    expect(() =>
      CreateAgentInput.parse({ company_id: VALID_UUID, name: '' }),
    ).toThrow()
  })

  it('rejects invalid role', () => {
    expect(() =>
      CreateAgentInput.parse({
        company_id: VALID_UUID,
        name: 'Agent',
        role: 'admin',
      }),
    ).toThrow()
  })

  it('rejects invalid adapter_type', () => {
    expect(() =>
      CreateAgentInput.parse({
        company_id: VALID_UUID,
        name: 'Agent',
        adapter_type: 'unknown',
      }),
    ).toThrow()
  })
})

describe('UpdateAgentInput', () => {
  it('accepts partial update', () => {
    const result = UpdateAgentInput.parse({ status: 'paused' })
    expect(result.status).toBe('paused')
  })

  it('rejects invalid status', () => {
    expect(() => UpdateAgentInput.parse({ status: 'deleted' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

describe('CreateIssueInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateIssueInput.parse({
      company_id: VALID_UUID,
      title: 'Fix bug',
    })
    expect(result.status).toBe('backlog')
    expect(result.priority).toBe('medium')
  })

  it('accepts full input', () => {
    const result = CreateIssueInput.parse({
      company_id: VALID_UUID,
      title: 'Fix bug',
      description: 'A nasty bug',
      parent_id: VALID_UUID_2,
      goal_id: VALID_UUID_2,
      project_id: VALID_UUID_2,
      status: 'in_progress',
      priority: 'critical',
      assignee_agent_id: VALID_UUID_2,
    })
    expect(result.status).toBe('in_progress')
    expect(result.priority).toBe('critical')
  })

  it('rejects missing title', () => {
    expect(() => CreateIssueInput.parse({ company_id: VALID_UUID })).toThrow()
  })

  it('rejects invalid priority', () => {
    expect(() =>
      CreateIssueInput.parse({
        company_id: VALID_UUID,
        title: 'X',
        priority: 'urgent',
      }),
    ).toThrow()
  })

  it('rejects invalid status', () => {
    expect(() =>
      CreateIssueInput.parse({
        company_id: VALID_UUID,
        title: 'X',
        status: 'open',
      }),
    ).toThrow()
  })
})

describe('UpdateIssueInput', () => {
  it('accepts partial update', () => {
    const result = UpdateIssueInput.parse({ status: 'done' })
    expect(result.status).toBe('done')
  })

  it('accepts null values for nullable fields', () => {
    const result = UpdateIssueInput.parse({
      assignee_agent_id: null,
      description: null,
    })
    expect(result.assignee_agent_id).toBeNull()
    expect(result.description).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

describe('CreateGoalInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateGoalInput.parse({
      company_id: VALID_UUID,
      title: 'Increase revenue',
    })
    expect(result.level).toBe('task')
    expect(result.status).toBe('active')
  })

  it('accepts full input', () => {
    const result = CreateGoalInput.parse({
      company_id: VALID_UUID,
      title: 'Increase revenue',
      description: 'By 50%',
      parent_id: VALID_UUID_2,
      level: 'strategic',
      status: 'completed',
      owner_agent_id: VALID_UUID_2,
    })
    expect(result.level).toBe('strategic')
  })

  it('rejects invalid level', () => {
    expect(() =>
      CreateGoalInput.parse({
        company_id: VALID_UUID,
        title: 'Goal',
        level: 'epic',
      }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

describe('CreateProjectInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateProjectInput.parse({
      company_id: VALID_UUID,
      name: 'Project Alpha',
    })
    expect(result.status).toBe('active')
  })

  it('accepts full input', () => {
    const result = CreateProjectInput.parse({
      company_id: VALID_UUID,
      name: 'Project Alpha',
      description: 'The alpha project',
      goal_id: VALID_UUID_2,
      lead_agent_id: VALID_UUID_2,
      status: 'completed',
      target_date: '2026-12-31',
    })
    expect(result.target_date).toBe('2026-12-31')
  })

  it('rejects empty name', () => {
    expect(() =>
      CreateProjectInput.parse({ company_id: VALID_UUID, name: '' }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// IssueComment
// ---------------------------------------------------------------------------

describe('CreateIssueCommentInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateIssueCommentInput.parse({
      issue_id: VALID_UUID,
      content: 'Looks good to me',
    })
    expect(result.is_resolved).toBe(false)
  })

  it('accepts full input', () => {
    const result = CreateIssueCommentInput.parse({
      issue_id: VALID_UUID,
      content: 'LGTM',
      author_agent_id: VALID_UUID_2,
      parent_id: VALID_UUID_2,
      is_resolved: true,
    })
    expect(result.is_resolved).toBe(true)
  })

  it('rejects empty content', () => {
    expect(() =>
      CreateIssueCommentInput.parse({
        issue_id: VALID_UUID,
        content: '',
      }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

describe('CreatePolicyInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreatePolicyInput.parse({
      company_id: VALID_UUID,
      name: 'Default allow',
      tool_pattern: '*',
    })
    expect(result.action).toBe('allow')
    expect(result.priority).toBe(0)
  })

  it('accepts full input', () => {
    const result = CreatePolicyInput.parse({
      company_id: VALID_UUID,
      agent_id: VALID_UUID_2,
      name: 'Rate limit',
      tool_pattern: 'llm.*',
      action: 'deny',
      priority: 10,
      max_calls_per_hour: 100,
    })
    expect(result.action).toBe('deny')
    expect(result.max_calls_per_hour).toBe(100)
  })

  it('rejects invalid action', () => {
    expect(() =>
      CreatePolicyInput.parse({
        company_id: VALID_UUID,
        name: 'P',
        tool_pattern: '*',
        action: 'block',
      }),
    ).toThrow()
  })
})

describe('UpdatePolicyInput', () => {
  it('accepts partial update', () => {
    const result = UpdatePolicyInput.parse({ action: 'log' })
    expect(result.action).toBe('log')
  })
})

// ---------------------------------------------------------------------------
// CostEvent
// ---------------------------------------------------------------------------

describe('CreateCostEventInput', () => {
  it('accepts valid input', () => {
    const result = CreateCostEventInput.parse({
      company_id: VALID_UUID,
      input_tokens: 1000,
      output_tokens: 500,
      cost_cents: 3,
    })
    expect(result.cost_cents).toBe(3)
  })

  it('accepts full input', () => {
    const result = CreateCostEventInput.parse({
      company_id: VALID_UUID,
      agent_id: VALID_UUID_2,
      issue_id: VALID_UUID_2,
      provider: 'anthropic',
      model: 'claude-opus-4',
      input_tokens: 1000,
      output_tokens: 500,
      cost_cents: 3,
    })
    expect(result.provider).toBe('anthropic')
  })

  it('rejects negative token counts', () => {
    expect(() =>
      CreateCostEventInput.parse({
        company_id: VALID_UUID,
        input_tokens: -1,
        output_tokens: 500,
        cost_cents: 3,
      }),
    ).toThrow()
  })

  it('rejects missing required fields', () => {
    expect(() =>
      CreateCostEventInput.parse({ company_id: VALID_UUID }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// HeartbeatRun
// ---------------------------------------------------------------------------

describe('CreateHeartbeatRunInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateHeartbeatRunInput.parse({
      company_id: VALID_UUID,
      agent_id: VALID_UUID_2,
      trigger_type: 'cron',
    })
    expect(result.status).toBe('queued')
  })

  it('accepts all trigger types', () => {
    for (const tt of ['cron', 'manual', 'event', 'api']) {
      const result = CreateHeartbeatRunInput.parse({
        company_id: VALID_UUID,
        agent_id: VALID_UUID_2,
        trigger_type: tt,
      })
      expect(result.trigger_type).toBe(tt)
    }
  })

  it('rejects invalid trigger type', () => {
    expect(() =>
      CreateHeartbeatRunInput.parse({
        company_id: VALID_UUID,
        agent_id: VALID_UUID_2,
        trigger_type: 'webhook',
      }),
    ).toThrow()
  })
})

describe('UpdateHeartbeatRunInput', () => {
  it('accepts partial update', () => {
    const result = UpdateHeartbeatRunInput.parse({
      status: 'running',
      started_at: '2026-01-01T00:00:00Z',
    })
    expect(result.status).toBe('running')
    expect(result.started_at).toBeInstanceOf(Date)
  })

  it('accepts null values for nullable fields', () => {
    const result = UpdateHeartbeatRunInput.parse({
      error: null,
      exit_code: null,
      usage_json: null,
    })
    expect(result.error).toBeNull()
  })

  it('rejects invalid status', () => {
    expect(() => UpdateHeartbeatRunInput.parse({ status: 'crashed' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// AgentApiKey
// ---------------------------------------------------------------------------

describe('CreateAgentApiKeyInput', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateAgentApiKeyInput.parse({
      agent_id: VALID_UUID,
      company_id: VALID_UUID_2,
      key_hash: 'sha256_abc123',
    })
    expect(result.status).toBe('active')
  })

  it('accepts full input', () => {
    const result = CreateAgentApiKeyInput.parse({
      agent_id: VALID_UUID,
      company_id: VALID_UUID_2,
      key_hash: 'sha256_abc123',
      label: 'Production key',
      status: 'revoked',
    })
    expect(result.label).toBe('Production key')
  })

  it('rejects empty key_hash', () => {
    expect(() =>
      CreateAgentApiKeyInput.parse({
        agent_id: VALID_UUID,
        company_id: VALID_UUID_2,
        key_hash: '',
      }),
    ).toThrow()
  })

  it('rejects invalid UUID', () => {
    expect(() =>
      CreateAgentApiKeyInput.parse({
        agent_id: 'bad',
        company_id: VALID_UUID_2,
        key_hash: 'hash',
      }),
    ).toThrow()
  })
})
