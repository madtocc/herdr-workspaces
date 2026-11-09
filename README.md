# Workspaces for Herdr

A Herdr layout that groups spaces into workspaces: a folder of repos, with its
own agent instructions. A switcher at the top of the sidebar picks one; the
spaces and agents lists show only what's in it. Each workspace has a task board (as columns or a list):
one markdown file per task, cards that start an agent on their task (in the
repo or a fresh worktree) and then show that agent's live status. Agent presets
(herdr-core templates: a command plus instructions) can be global or per
workspace, are managed in the Agent presets screen (model and effort included;
open it from the sidebar footer or the switcher), and run from
"New agent…" or a card's Start;
`examples/presets/` has two to start from.

![Workspaces](preview.png)

`RECIPE.md` describes it in full: it's the brief an agent builds it from.

## Install

Ask your agent to add this layout (Herdr's own guide, `~/.config/herdr-app/AGENTS.md`,
says how), or by hand:

1. Copy `layouts/workspaces.json` to `~/.config/herdr-app/layouts/` and the six
   folders in `mods/` to `~/.config/herdr-app/mods/` (rename them if a name is taken).
2. For agent instructions from the + menu, put the launcher on your `PATH` and
   point `programs.json` at it:
   ```sh
   ln -s ~/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-agent ~/.local/bin/
   ```
   ```json
   { "programs": { "claude": { "run": ["herdr-ws-agent", "claude"] },
                   "codex":  { "run": ["herdr-ws-agent", "codex", "--no-daemon"] } } }
   ```
3. Switch to it: `herdr-app do layout.switch '{"name":"workspaces"}'`
   (`ctrl-shift-l` cycles back).
4. Open the switcher and pick **New workspace from a folder…**. The board button
   beside the switcher opens the workspace's board.

**What it touches:** it reads `~/.herdr/workspaces` and the folders of
each workspace's root. It writes `~/.herdr/workspaces/.index`, a new
workspace's files when you make one, its `workspace.jsonc` when you rename it,
and task files in `~/.herdr/workspaces/<id>/tasks/`. Deleting a workspace or a
task (after a confirmation) moves it to the Trash. The board's Worktree runs
`git worktree add` on a new `task/…` branch; otherwise your repos aren't
touched. It runs `sh` (editor, Trash, symlinked folders), `herdr-app do` (the
board's new tabs) and, through the launcher and Start, your agents. It doesn't
use the network.

Built for Herdr 0.1.14; `ws-spaces` and `ws-agents` are copies of that version's
`spaces` and `agents` lists.

## License

Apache License 2.0. `ws-spaces` and `ws-agents` are modified copies of Herdr's
own mods, also Apache 2.0; see `NOTICE`.

## Working on it

Edit the live files in `~/.config/herdr-app`, then copy them here with
`scripts/sync-from-home.sh`.
