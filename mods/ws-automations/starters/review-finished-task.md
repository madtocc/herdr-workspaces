---
description: Reviews a board task when it moves to review
when: task enters review
agent: reviewer
---
A task on the board was just moved to review:

{{task}}

Review the work it describes. If the card has a `pr:` line, read that pull request (`gh pr diff <url>`); otherwise read what changed in its folder (`git status`, `git diff`, the latest commits).

Say what's worth fixing before it's done: what, where and why. Then add what you found under a "## Review" heading at the end of the task's file ({{task.file}}), leaving the lines between the --- markers as they are. Change no code.
