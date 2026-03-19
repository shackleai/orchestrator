import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'getting-started',
      label: 'Getting Started',
    },
    {
      type: 'doc',
      id: 'concepts',
      label: 'Concepts',
    },
    {
      type: 'doc',
      id: 'configuration',
      label: 'Configuration',
    },
    {
      type: 'category',
      label: 'Adapters',
      collapsed: false,
      items: [
        {type: 'doc', id: 'adapters', label: 'All Adapters'},
      ],
    },
    {
      type: 'doc',
      id: 'governance',
      label: 'Governance',
    },
    {
      type: 'doc',
      id: 'cli-reference',
      label: 'CLI Reference',
    },
    {
      type: 'doc',
      id: 'api-reference',
      label: 'API Reference',
    },
    {
      type: 'category',
      label: 'Deployment',
      collapsed: true,
      items: [
        {type: 'doc', id: 'deployment', label: 'Deployment Guide'},
        {type: 'doc', id: 'docker', label: 'Docker'},
      ],
    },
    {
      type: 'doc',
      id: 'faq',
      label: 'FAQ',
    },
  ],
};

export default sidebars;
