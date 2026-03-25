# @shackleai/shared

## 0.2.0

### Minor Changes

- [#246](https://github.com/shackleai/orchestrator/pull/246) [`6a4a030`](https://github.com/shackleai/orchestrator/commit/6a4a0309a56976c4cac23bdd5f08391bc969ec5c) Thanks [@shackleai](https://github.com/shackleai)! - Add changeset-based release workflow with automated versioning and GitHub changelog generation.

  This changeset documents the initial setup of `@changesets/cli` for the monorepo. Going forward, every PR that affects a published package must include a changeset file describing the change type (major/minor/patch) and what changed.

  The release workflow (`changesets.yml`) will automatically:
  1. Open a "Version Packages" PR whenever changesets accumulate on main
  2. Publish to npm when that PR is merged
