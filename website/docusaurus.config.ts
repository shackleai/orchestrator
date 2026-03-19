import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ShackleAI Orchestrator',
  tagline: 'Open-source orchestration for AI agent teams',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://shackleai.github.io',
  baseUrl: '/orchestrator/',

  organizationName: 'shackleai',
  projectName: 'orchestrator',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/shackleai/orchestrator/edit/main/website/',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ShackleAI Orchestrator',
      logo: {
        alt: 'ShackleAI Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/shackleai/orchestrator',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://www.npmjs.com/package/@shackleai/orchestrator',
          label: 'npm',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started'},
            {label: 'CLI Reference', to: '/docs/cli-reference'},
            {label: 'API Reference', to: '/docs/api-reference'},
            {label: 'Adapters', to: '/docs/adapters'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: 'https://github.com/shackleai/orchestrator'},
            {label: 'npm', href: 'https://www.npmjs.com/package/@shackleai/orchestrator'},
            {label: 'Issues', href: 'https://github.com/shackleai/orchestrator/issues'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ShackleAI. MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'python', 'ini', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
