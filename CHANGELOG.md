# Workspaces changelog

What changed between versions, in the words you'd notice it. `RECIPE.md`
describes the whole thing as it is now; this file says what's new since the
version you have (`mods/ws-switcher/VERSION` in your copy). To update, see
"Updating" in the README.

## [Unreleased]

### New
- **Your GitHub project board, in the board tab.** Tasks | GitHub in a board's header shows the workspace's GitHub project board: its own status columns, or a list with a section per status, with Everyone / Mine / Unassigned, a repo filter, search, and Newest or Oldest in place of the board's own order. **Take** on any item, yours or not, makes a card on your board with the issue's title, text, folder and priority. A taken card then shows the item's status on GitHub, follows a changed title, moves to your last column when the issue closes, and picks up a pull request of yours that closes it. Link a board by pasting its link in the view, or pick one it finds; it's saved as `"board": { "github": "<link>" }` in `workspace.jsonc`. A read is kept for 10 minutes (in `~/.herdr/cache/github-boards/`), so going back to the view, in any board tab or after a restart, shows the board at once without reading GitHub again; **Refresh** reads it now. It only reads: nothing changes on GitHub, so assign yourself there when your team expects it. It needs `gh` with the `read:project` scope (`gh auth refresh -s read:project`). To update, copy `mods/ws-board` and `mods/ws-switcher`.
- **A guide for every agent.** Write what every agent should know about Herdr (how to set up automations, start hc helpers, keep a card's notes) in `~/.herdr/AGENTS.md`, and Claude and Codex started through the launcher get it first, before the workspace's instructions: from the + menu, a preset, a card, an automation or `hc run`. It replaces the built-in line about `herdr-ws-run --add`. In Agent presets, under "Herdr guide", **Write one** starts it from a starter and **Edit** opens it; the switch beside them turns it off for every agent (on by default; `herdr-ws-agent --guide off` too), and a preset's **Goes without** (`guide: off`) leaves it out for that preset alone. The example `watcher` preset goes without it. To update, copy `mods/ws-switcher` and `mods/ws-presets`, and add `guide: off` to your copy of `watcher`.
- **The README shows each screen.** It's now a section per feature, with drawings of the task board, the GitHub view, the Worktrees tab and the Automations screen (`previews/`, from a `preview.svg` beside each mod). Nothing to do in an install.

### Fixed
- **An empty workspace no longer shows another project's terminal.** Closing a workspace's last space (exiting its agent, then its shell) kept the workspace chosen but showed a space from another workspace beside it, tabs and all; choosing a workspace with no spaces did the same. The work area is now empty instead, with "No spaces in <workspace>" and a New space button, until you show a space or choose another workspace. To update, copy `layouts/workspaces.json` (it wraps the work column in a `center` stack beside an `empty` block) and `mods/ws-switcher`.
- **Picking Scratch in the switcher menu shows it.** A click on the Scratch workspace did nothing: its row and New scratch space shared an id inside the menu, so the click got lost. Picking it from All spaces still worked. Every workspace row now has an id of its own, which also covers a workspace you call new, all, edit, move, rename or delete. To update, copy `mods/ws-switcher`.

## [0.6.1] - 2026-11-18

### Fixed
- **A toast about an automation opens that automation.** "Allow <name>'s check?", "<name> didn't start", a failed check and a toast about one missed run opened the Automations screen on the first check waiting to be allowed, looking in the shown workspace first. With a check waiting in the workspace on screen, a toast about another workspace's automation landed on the wrong one. The click now opens that automation's workspace with it picked, from Herdr's toast and from the desktop notification. With the sidebar hidden, the desktop notification's click opens the screen as it did before. To update, copy `mods/ws-switcher`, `mods/ws-automations` and `mods/ws-toast`.

## [0.6.0] - 2026-11-18

### New
- **Notifications reach your desktop.** While Herdr isn't the app in front, every toast (an agent needs you or finished, an automation's news, a pull request's) also shows as a system notification with the same words, and a click on it brings Herdr forward and goes where the toast would. With Keep running on and Herdr closed, the background runner's news goes to the desktop too, with the system's sound. `herdr-ws-notify --off` turns them off. To update: copy the new `mods/ws-toast` folder, copy `layouts/workspaces.json` again (or add `"toast": "ws-toast"` at its root), and link `bin/herdr-ws-notify` into `~/.local/bin` like the other scripts. On macOS, `brew install terminal-notifier` makes a click go to Herdr; without it the notification shows under Script Editor's name and a click does nothing.
- **A brief for each workspace.** `~/.herdr/workspaces/<id>/BRIEF.md` says where the workspace's work stands today, and whatever knows keeps it: an automation, a script, you. Claude and Codex started there with no preset get it after the workspace's instructions; a preset's agent is told where the file is. Nothing to do by hand: without the file nothing changes.

## [0.5.0] - 2026-11-18

### New
- **Hold the Spaces + to name a space and choose its folder.** A click still makes a space in the workspace's root at once. Holding it (or right-clicking) opens New space: a name, a folder (the workspace's folders one click away, or Choose…), and a line saying which workspace it will join. In Scratch it names the new scratch space. Copy `ws-switcher` and `ws-spaces` again.

## [0.4.0] - 2026-11-18

### New
- **A Scratch workspace for ideas that belong to no project.** It's always last in the switcher. "New scratch space" (top of the switcher menu, from any workspace) opens a space there in a fresh folder under `~/.herdr/scratch/`, one per idea, and its kept folders are listed to go back to. Close one empty and its folder is deleted; with files, a toast offers Keep, and otherwise it goes to the Trash after 7 days unused. Delete Scratch… clears it all: its spaces close and its folders go to the Trash with it. Bind a key to `ws-switcher.scratch-new` to make one from the keyboard. Copy `ws-switcher` and `ws-spaces` again; Scratch appears on the next start.

## [0.3.1] - 2026-11-18

### Fixed
- **The layout's picture shows today's look:** the board button, Automations and Agent presets in the footer, and the switcher menu's current rows, in the README and in Herdr's layout settings.

## [0.3.0] - 2026-11-18

### New
- **A Worktrees tab for each workspace.** "Open … worktrees" in the switcher menu lists every git worktree of the workspace's repos, wherever it was made, with where its work stands (merged, a pull request open, commits with no pull request), uncommitted changes and whether anything is in it. "Remove N finished…" clears the merged, clean, unused ones; the branches stay. Checkboxes (shift-click for a run of rows) pick any others to remove together. Copy the new `ws-worktrees` folder into your mods.
- **Setup and archive scripts per repo.** A line to run in a new worktree (install, copy `.env`) and one to run before a worktree is removed, set under Scripts in the Worktrees tab. The board's Worktree runs setup before the agent starts.

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
