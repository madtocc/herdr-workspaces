---
description: Sums up the week, every Friday afternoon
when: fri 16:00
---
Write this week's summary for {{workspace}}, for someone who was away:

- **Merged**: what went in, per repo (`gh pr list --state merged --search "merged:>=<the date 7 days ago>"`, or `git log --since="7 days ago"` on the default branch where there's no GitHub).
- **Open**: pull requests still open and what each is waiting on (`gh pr list`, `gh pr checks`).
- **On the board**: tasks in doing and review, from the workspace's tasks folder, if it has one.
- **Needs someone**: anything stuck, and who can move it.

A short list under each heading, in plain words. Leave out a heading that has nothing. Change nothing.
