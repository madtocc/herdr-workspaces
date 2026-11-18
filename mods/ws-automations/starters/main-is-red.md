---
description: Looks into a failing check on a default branch
when: every 30m
agent: implementer
check: for d in . */; do [ -e "$d/.git" ] && (cd "$d" && b=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null) && gh run list --branch "$b" --limit 15 --json workflowName,conclusion,url,displayTitle --jq 'group_by(.workflowName)[] | .[0] | select(.conclusion == "failure") | "\(.url) \(.workflowName): \(.displayTitle)"' 2>/dev/null); done
---
A check is failing on a default branch in this workspace (the run, its workflow and the commit's title):

{{check}}

Find out why. `gh run view <run id> --log-failed`, run in that repo's folder, shows the step that failed. Say what broke, which commit did it and what the fix is.

If the fix is small and clearly right, make it in a git worktree of your own on a new branch, push it and open a pull request. Otherwise change nothing and report here. Never push to the default branch.
