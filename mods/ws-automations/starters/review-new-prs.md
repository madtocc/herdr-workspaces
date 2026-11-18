---
description: Reviews each pull request someone else opens
when: github * pr opened by others
agent: reviewer
---
A pull request was just opened:

{{pr}}

Review it:

1. Read the change with `gh pr diff {{number}}`, against what the pull request says it does. Don't check it out in this folder: other work may be going on here. If you need to run it, use a worktree of your own (`git worktree add`).
2. Run the checks that cover it, if you can.
3. Say what's worth fixing before it merges: what, where and why. Leave style alone unless it hides a bug.

Don't push to its branch and don't comment on GitHub. Report here.
