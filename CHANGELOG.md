# Workspaces changelog

What changed between versions, in the words you'd notice it. `RECIPE.md`
describes the whole thing as it is now; this file says what's new since the
version you have (`mods/ws-switcher/VERSION` in your copy). To update, see
"Updating" in the README.

## [0.2.0] - 2026-11-18

### New
- **Keep running: automations and pull requests are followed with Herdr closed.** A switch at the foot of the Automations list (or `herdr-ws-runner --on`) moves that work to a background process herdr-core keeps going. It needs Node 20.6 or newer. Link `bin/herdr-ws-runner` into `~/.local/bin` like the other two.
- **Automations for every workspace.** Files in `~/.herdr/automations/` run in each workspace as its own; a workspace's own file of the same name replaces it there, and the row's switch turns it off for one workspace. `github * issue opened` watches every repo of the workspace. `herdr-ws-run --add --global` makes one.
- **Ready-made automations in the Automations screen.** Seven to start from (issue to pull request, PR review, a broken default branch, a morning review and more): open one, read it, and Create adds it. They replace `examples/automations/`.
- **A watcher preset** (`examples/presets/watcher.md`): Claude that can't push or write to GitHub, for automations that only look and write a note.
- **A run stuck before it starts says so.** A run whose agent reports nothing for a minute (Claude's folder trust question, say) shows "needs you" and a toast.
- `scripts/sandbox.sh`: a second Herdr with demo workspaces for trying changes without touching your own window.

### Fixed
- **Closing the shown space keeps you in its workspace.** Herdr used to show its next space, which could be in another workspace, and the switcher followed it there. It now shows the closed space's neighbour in the same workspace.

## [0.1.0] - 2026-11-13

The first published version, built for Herdr 0.1.14.

### New
- **Workspaces:** a switcher above the spaces list; the spaces and agents lists show only the chosen workspace. Each workspace has its own agent instructions, which Claude and Codex get from the + menu.
- **A task board** per workspace: one markdown file per task, cards that start an agent in the repo or a fresh worktree and show its live status.
- **Board cards follow their pull request:** checks, reviews, conflicts and merges show on the card, and the card's agent is told when a check fails or a review arrives.
- **Agent presets,** global or per workspace, started from the tab bar's + menu or a card's Start; an orchestrator preset that splits a task across helper agents.
- **Automations:** on a schedule (once or repeating), a board column, an agent finishing or needing you, file changes, a GitHub PR or issue, or a call from another app. Describe one in words and Claude drafts it. Quiet checks skip runs when there's nothing to do, and run only once you've allowed them.
- **Missed schedules** catch up when Herdr opens if they're under 12 hours old; older ones are reported.
- **Claude agents come back after a restart,** resumed with their conversations (a switch at the foot of the Agent presets screen).
- **A click on a sub-agent opens it as a tab.**
