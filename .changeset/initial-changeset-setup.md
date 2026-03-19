---
"@shackleai/core": minor
"@shackleai/db": minor
"@shackleai/shared": minor
---

Add changeset-based release workflow with automated versioning and GitHub changelog generation.

This changeset documents the initial setup of `@changesets/cli` for the monorepo. Going forward, every PR that affects a published package must include a changeset file describing the change type (major/minor/patch) and what changed.

The release workflow (`changesets.yml`) will automatically:
1. Open a "Version Packages" PR whenever changesets accumulate on main
2. Publish to npm when that PR is merged
