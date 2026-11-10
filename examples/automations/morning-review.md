---
description: Review yesterday's changes every weekday morning
when: weekdays 09:00
agent: reviewer
folder: api
---
Review the commits on main from the last day (`git log --since=yesterday`).
For each problem worth fixing, say what it is, where, and why it matters.
If there's nothing worth raising, say so in one line.

<!-- Copy this to ~/.herdr/workspaces/<id>/automations/ and change `folder`
     to one of the workspace's folders. `reviewer` is examples/presets/reviewer.md. -->
