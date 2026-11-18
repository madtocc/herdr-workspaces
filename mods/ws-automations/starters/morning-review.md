---
description: Reads the last day's commits every weekday morning
when: weekdays 09:00
agent: reviewer
check: for d in . */; do [ -e "$d/.git" ] || continue; git -C "$d" fetch -q origin 2>/dev/null; r=$(git -C "$d" rev-parse -q --verify origin/HEAD >/dev/null 2>&1 && echo origin/HEAD || echo HEAD); git -C "$d" log "$r" --since="1 day ago" --no-merges --format="${d%/} %h %s" 2>/dev/null; done
---
These commits landed on the default branch in the last day (folder, commit, subject). The check fetched them; the checkout here may be behind, so read them from origin:

{{check}}

Read them (`git -C <folder> show <commit>`, which works without checking anything out) and look for what deserves a second look: bugs, changed behaviour with no test, work left half done, anything that goes against this workspace's instructions.

For each one: what, where, and why it matters. If nothing does, say so in one line. Change nothing.
