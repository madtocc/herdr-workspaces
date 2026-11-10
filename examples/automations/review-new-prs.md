---
description: Review each pull request someone else opens
when: github api pr opened by others
agent: reviewer
card: true
---
A pull request was just opened:

{{pr}}

Check it out with `gh pr checkout {{number}}`, read the change against what it
says it does, and run the checks that cover it. Then list what's worth fixing
before it merges: what, where, and why. Don't push or comment on GitHub; report
here.

<!-- Copy this to ~/.herdr/workspaces/<id>/automations/ and change `api` to a
     workspace folder whose origin is on GitHub, or to owner/name. It runs in
     that folder. `reviewer` is examples/presets/reviewer.md. -->
