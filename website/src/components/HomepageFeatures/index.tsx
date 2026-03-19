import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Org chart for your AI team',
    description: (
      <>
        Agents have roles (<code>ceo</code>, <code>manager</code>, <code>worker</code>),
        report to each other, and operate as a structured organization — not a bag of scripts.
      </>
    ),
  },
  {
    title: 'Default-deny governance',
    description: (
      <>
        Every tool call goes through a policy engine. New tools are blocked until you
        explicitly allow them. Use glob patterns like <code>github:*</code> to grant access
        with precision.
      </>
    ),
  },
  {
    title: 'Token budgets and audit trail',
    description: (
      <>
        Track what every agent spends — per agent and per company — with soft alerts at
        80% and hard stops at 100%. Every entity change is logged in an immutable audit trail.
      </>
    ),
  },
  {
    title: 'Heartbeat scheduler',
    description: (
      <>
        Agents wake up on cron schedules or on-demand. The scheduler coalesces runs so
        agents never pile up. Full stdout capture and exit code tracking per run.
      </>
    ),
  },
  {
    title: '6 execution adapters',
    description: (
      <>
        Connect any agent: shell scripts via <code>process</code>, HTTP webhooks,
        Claude Code CLI, MCP servers, OpenClaw, or CrewAI. All adapters return a
        standardized result with optional token usage reporting.
      </>
    ),
  },
  {
    title: 'Local-first, no cloud required',
    description: (
      <>
        Run entirely on your machine with an embedded PGlite database. No account,
        no API key, no internet connection needed after install. Switch to PostgreSQL
        when you are ready for production.
      </>
    ),
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md" style={{paddingTop: '1rem', paddingBottom: '1rem'}}>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
