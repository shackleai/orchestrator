/**
 * Built-in company templates — inlined to avoid filesystem resolution issues
 * when running from compiled dist/ directories.
 */

import type { CompanyTemplate } from '@shackleai/shared'

export const BUILTIN_TEMPLATES: Record<string, CompanyTemplate> = {
  'software-team': {
    name: 'Software Team',
    description:
      'A standard software development team with PM, frontend, backend, and QA agents.',
    version: '1.0.0',
    agents: [
      {
        name: 'Product Manager',
        title: 'Product Manager',
        role: 'manager',
        capabilities:
          'Requirements gathering, backlog prioritization, sprint planning, stakeholder communication',
        adapter_type: 'claude',
        adapter_config: {},
        budget_monthly_cents: 5000,
        reports_to: null,
      },
      {
        name: 'Frontend Engineer',
        title: 'Frontend Engineer',
        role: 'worker',
        capabilities:
          'React, TypeScript, CSS, UI components, accessibility, responsive design',
        adapter_type: 'claude',
        adapter_config: {},
        budget_monthly_cents: 5000,
        reports_to: 'Product Manager',
      },
      {
        name: 'Backend Engineer',
        title: 'Backend Engineer',
        role: 'worker',
        capabilities:
          'Node.js, TypeScript, PostgreSQL, REST APIs, system design, performance optimization',
        adapter_type: 'claude',
        adapter_config: {},
        budget_monthly_cents: 5000,
        reports_to: 'Product Manager',
      },
      {
        name: 'QA Engineer',
        title: 'QA Engineer',
        role: 'worker',
        capabilities:
          'Test planning, automated testing, regression testing, bug triage, quality metrics',
        adapter_type: 'claude',
        adapter_config: {},
        budget_monthly_cents: 3000,
        reports_to: 'Product Manager',
      },
    ],
    goals: [
      {
        title: 'Deliver high-quality software on schedule',
        description:
          'Ensure the team ships features that meet requirements with minimal defects.',
        level: 'strategic',
        owner_agent_name: 'Product Manager',
      },
      {
        title: 'Maintain code quality standards',
        description:
          'Keep test coverage high and technical debt manageable.',
        level: 'initiative',
        owner_agent_name: 'QA Engineer',
      },
    ],
    policies: [
      {
        name: 'Allow all tools for engineers',
        tool_pattern: '*',
        action: 'allow',
        priority: 0,
      },
      {
        name: 'Log deployments',
        tool_pattern: 'deploy:*',
        action: 'log',
        priority: 10,
      },
    ],
  },

  startup: {
    name: 'Startup',
    description:
      'A lean startup team with CEO, CTO, and engineer agents for rapid iteration.',
    version: '1.0.0',
    agents: [
      {
        name: 'CEO',
        title: 'Chief Executive Officer',
        role: 'ceo',
        capabilities:
          'Vision setting, strategic planning, resource allocation, stakeholder management',
        adapter_type: 'claude',
        adapter_config: {},
        budget_monthly_cents: 5000,
        reports_to: null,
      },
      {
        name: 'CTO',
        title: 'Chief Technology Officer',
        role: 'manager',
        capabilities:
          'Architecture decisions, tech stack selection, engineering roadmap, code review',
        adapter_type: 'claude',
        adapter_config: {},
        budget_monthly_cents: 5000,
        reports_to: 'CEO',
      },
      {
        name: 'Engineer',
        title: 'Full-Stack Engineer',
        role: 'worker',
        capabilities:
          'Full-stack development, TypeScript, React, Node.js, PostgreSQL, DevOps',
        adapter_type: 'claude',
        adapter_config: {},
        budget_monthly_cents: 5000,
        reports_to: 'CTO',
      },
    ],
    goals: [
      {
        title: 'Achieve product-market fit',
        description:
          'Build and iterate on the core product to find product-market fit as fast as possible.',
        level: 'strategic',
        owner_agent_name: 'CEO',
      },
      {
        title: 'Ship MVP in 30 days',
        description:
          'Deliver a minimum viable product with core features within one month.',
        level: 'initiative',
        owner_agent_name: 'CTO',
      },
    ],
    policies: [
      {
        name: 'Allow all tools',
        tool_pattern: '*',
        action: 'allow',
        priority: 0,
      },
      {
        name: 'Deny destructive ops without CTO',
        tool_pattern: 'deploy:production',
        action: 'log',
        priority: 10,
      },
    ],
  },
}
