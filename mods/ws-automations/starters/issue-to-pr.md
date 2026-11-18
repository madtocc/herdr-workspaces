---
description: Takes each new GitHub issue to a pull request
when: github * issue opened
agent: implementer
card: true
---
An issue was just opened:

{{issue}}

Take it to a pull request, if it's clear enough to act on:

1. Work in a git worktree of your own, so whatever else is going on in this folder is left alone: `git fetch origin`, then `git worktree add ~/.herdr/worktrees/{{repo}}-{{number}} -b issue-{{number}} origin/HEAD`, and do everything there.
2. Read the code the issue is about and find the cause before you change anything.
3. Make the smallest change that settles it, with a test that covers it.
4. Run the repo's own checks (tests, lint, types) and fix what you broke.
5. Push the branch and open a pull request. Its description says what was wrong, what changed and how you checked it, and ends with "Fixes #{{number}}".
6. Write the pull request's URL on your task card as a `pr:` line.

If the issue is a question, isn't clear enough to act on, or needs a decision only a person can make, change nothing. Say here what you'd need to know.
