---
description: Lists dependencies that need attention, every Monday
when: mon 09:30
---
Look through this workspace's repos for dependencies that need attention. In each repo use its own tool: `npm outdated` and `npm audit` (or pnpm, yarn, bun), `pip list --outdated`, `cargo outdated`, `go list -u -m all`, and so on.

Report, most pressing first:

1. Known vulnerabilities that have a fixed version. Say which are a patch or minor update away: those are the ones to do today.
2. Packages a major version or more behind, and what the upgrade is likely to break.
3. The rest, in one line.

For each: the repo, the package, from which version to which. Change nothing and install nothing.
