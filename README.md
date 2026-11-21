# Workspaces for Herdr

A Herdr layout for multi-repo work: workspaces with their own agent
instructions, a task board that starts agents and follows their pull requests,
your GitHub project board beside it, a worktrees tab, agent presets, automations,
and agents that come back after a restart.

![Workspaces](preview.png)

The pictures here are drawings with demo names, not screenshots. `RECIPE.md`
describes everything in full: it's the brief an agent builds it from.

## What you get

### Workspaces

A workspace is a folder of repos with its own agent instructions; it groups
Herdr's spaces. The switcher at the top of the sidebar picks one, and the spaces
and agents lists show only what's in it. A dot on the switcher says an agent in
another workspace needs you or finished.

- **New space**: a click on the Spaces + makes one in the workspace's root. Hold
  it (or right-click) to name the space and choose its folder.
- **Scratch**, always last in the switcher, holds throwaway spaces for ideas that
  belong to no project. You name each one as you make it, and it gets a fresh
  folder carrying that name, tidied away when you're done unless you keep it.
- **Instructions**: a workspace's `AGENTS.md` goes to the agents you start
  there (Claude Code, Codex, Antigravity and Pi). A `BRIEF.md` beside it, where the work stands today, goes with it, and
  `~/.herdr/AGENTS.md` is a guide for the agents of every workspace.
- **Agent numbers**: a Claude Code, Pi or Antigravity agent's row in the Agents
  list also shows its model, how full its context is and how many times it was
  compacted (hover for the effort, tokens, last compaction and cost), and the
  status bar shows how much of your Claude and Antigravity plans you've used, as
  each one's own `/usage` gives it, with every limit and when it resets a click away.

### A task board

![The task board](previews/board.png)

Each workspace has a board, as columns or as a list. A task is one markdown
file, so agents can read and write them too. The board belongs to the workspace,
not to one space: once opened, it's a pill before the tabs of every space of the
workspace, and it opens even when the workspace has no spaces.

- **Start** on a card starts an agent on its task, in the repo or in a fresh git
  worktree, with the preset you pick. The card then shows that agent's live
  status, and Go to takes you to it.
- **A card follows its pull request.** It shows whether checks fail, changes are
  requested, it conflicts or it's ready to merge, tells the card's agent when a
  check fails or a review arrives, and moves to the last column when it merges.
  A card still in Todo when its pull request opens moves to Review.

### Your GitHub project board

![The board's GitHub view](previews/github.png)

Tasks | GitHub in the board's header shows the workspace's GitHub project board
with its own status columns, or as a list with a section per status.

- **Filters**: Everyone, Mine or Unassigned, one repo, a search, and Newest or
  Oldest in place of the board's own order.
- **Take** on any item, yours or not, makes a card on your board with the
  issue's title, text, folder and priority. The card then shows the item's
  status on GitHub, follows a changed title, moves to your last column when the
  issue closes, and picks up a pull request of yours that closes it.
- **It only reads.** Nothing changes on GitHub, so assign yourself there when
  your team expects it. It needs `gh` with the `read:project` scope
  (`gh auth refresh -s read:project`).
- **A read is kept for 10 minutes**, so going back to the view shows the board
  at once. Refresh reads it now.

### Worktrees

![The Worktrees tab](previews/worktrees.png)

"Open … worktrees" in the switcher menu lists every git worktree of the
workspace's repos, wherever it was made. Like the board it belongs to the
workspace: a pill in the tab bar of each of its spaces.

- **Where each one stands**: merged, a pull request open, commits with no pull
  request, uncommitted changes, and whether a card, a space or a terminal is in it.
- **Remove N finished…** clears the merged, clean, unused ones; the branches
  stay. Checkboxes pick any others to remove together.
- **Scripts per repo**: a line to run in a new worktree (install, copy `.env`)
  and one to run before a worktree is removed. Only a line you saved or allowed
  runs.

### History

![The History screen](previews/history.png)

**History** in the sidebar footer (or "Resume a conversation…" in the + menu)
lists the conversations your agents saved, newest first, whichever agent it
was: Claude Code, Codex, Pi, Grok, OpenCode and Antigravity. Like the board it belongs to
the workspace: a pill in the tab bar of each of its spaces.

- **Resume** continues a conversation in a new tab, in the folder it ran in.
  One started from a preset comes back as that preset.
- **Open ones say so** and offer Go to instead, so a conversation isn't opened
  twice.
- **This workspace or everywhere**, a chip per agent, and search across titles,
  prompts, folders and models.
- **Compactions**: a Claude Code, Pi or Antigravity conversation shows how many
  times it was compacted; opened, when each one was, how, how big the context
  was before and after, and what was in it at the end.
- It only reads what the agents already keep; nothing is copied or changed.
  It needs Node 20.6 or newer.

### Automations

![The Automations screen](previews/automations.png)

An automation starts an agent by itself. You make one by saying what it should
do and when, in your own words: Claude drafts the trigger, the agent, its model
and the prompt, and you read the draft before it's saved.

- **What sets one off**: a schedule (once or repeating), a task entering a board
  column, an agent finishing or needing you, files changing, a PR or issue
  opened on GitHub (asked every 2 minutes through `gh`), or another app calling
  `herdr-ws-run`.
- **Seven ready-made ones** to start from (issue to pull request, PR review, a
  broken default branch, a morning review and more): open one, read it, and
  Create adds it.
- **One workspace's own or for every workspace**
  (`~/.herdr/workspaces/<id>/automations/` or `~/.herdr/automations/`). A global
  one runs in each workspace as that workspace's own, a workspace's own of the
  same name replaces it there, and its switch turns it off for one workspace
  alone. `github * issue opened` watches every repo of the workspace it runs in.
- **A check first**: a command that runs before the agent, so no agent starts
  when there's nothing to do. It runs only once you've allowed it.
- **Keep running**, at the foot of the list: a background process herdr-core
  keeps going while Herdr is closed (it needs Node 20.6 or newer). Without it
  they run while Herdr is open. A schedule missed while nothing was running
  runs when Herdr opens if it was due in the last 12 hours; older ones are
  reported as missed, with a toast, for Run now.
- **Each run is a tab** in the workspace's Automations space.
- **Agents can add one** themselves with `herdr-ws-run --add`, so you can tell
  one "tomorrow at 6, check X and if so do Y".

### Agent presets

A preset is an agent you start by name: a command (the program, its model and
effort) plus instructions. They're herdr-core templates, global or per
workspace, managed in the Agent presets screen (open it from the sidebar
footer), and they start from the tab bar's + menu, a card's Start or an
automation.

`examples/presets/` has nine to start from. Five are the usual roles: an
implementer, a reviewer, a watcher that can't push or write to GitHub (for
automations that only look), an orchestrator that splits a task across helper
agents with herdr-core's `hc`, and a foreman for when Claude's safety check
keeps cutting its helpers' replies. A helper shows under its orchestrator or
foreman in the Agents list, and a click on one opens it as a tab.

A **foreman** runs on Pi with a non-Claude model (an uncensored one by default),
cuts the work into steps of one or two tool calls, and gives each to a fresh
**hand** worker. It reads every stop, resumes the smallest missing step, halves
it if it is stopped again, and does it itself after a third. It also takes
Claude's "switch to Opus" offer for you. A **hand** works in Sonnet at low
effort and keeps its answer to a line or two; **hand-strong** is the same on Opus
at high effort, for a step Sonnet got wrong.

The other three are for what an agent would otherwise hand to a subagent of its
own, where you can't watch it or type to it:

- a **scout** finds where something is and how it works in the code, and
  answers with files and lines;
- a **researcher** answers what the repo can't, from docs, source and the web,
  with a source for each finding;
- a **planner** reads the code and writes a plan an implementer can follow.

None of them changes code. With the starter guide (see Install), Claude and
Codex start one of these where they'd use their own subagent.

### And when you're away

- **After a reboot or a logout**, the Claude and Antigravity agents you hadn't closed come back
  in their tabs, resumed with their conversations, helpers included.
- **Desktop notifications**: while you're in another app, Herdr's notifications
  (an agent needs you or finished, an automation's news) also show on your
  desktop, and a click takes you to the agent. With Keep running on they come
  while Herdr is closed too.

## Install

Ask your agent to add this layout (Herdr's own guide, `~/.config/herdr-app/AGENTS.md`,
says how), or by hand:

1. Copy `layouts/workspaces.json` to `~/.config/herdr-app/layouts/` and the thirteen
   folders in `mods/` to `~/.config/herdr-app/mods/` (rename them if a name is taken).
2. For agent instructions from the + menu, put the launcher on your `PATH` and
   point `programs.json` at it. `herdr-ws-run` starts automations from other
   apps and lets agents add them, and `herdr-ws-notify --off` / `--on` is the
   switch for the desktop notifications (on macOS, `brew install terminal-notifier`
   makes a click on one go to Herdr):
   ```sh
   ln -s ~/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-agent ~/.local/bin/
   ln -s ~/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-run ~/.local/bin/
   ln -s ~/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-runner ~/.local/bin/
   ln -s ~/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-notify ~/.local/bin/
   ```
   ```json
   { "programs": { "claude": { "run": ["herdr-ws-agent", "claude"] },
                   "codex":  { "run": ["herdr-ws-agent", "codex", "--no-daemon"] } } }
   ```
   If you use Antigravity, add `"antigravity": { "run": ["herdr-ws-agent", "agy"] }`
   too, and for Pi, `"pi": { "run": ["herdr-ws-agent", "pi"] }`. Add only the agents you have: Herdr looks for the first word of the line,
   here the launcher, so a missing agent would still show as installed.
3. To bring Claude and Antigravity agents back after a restart, add this line to
   `~/.config/herdr-core/config.toml`. herdr-core then starts terminals through
   `herdr-ws-resume`, which resumes a terminal's agent, else runs your usual shell.
   The switch at the foot of the Agent presets screen turns it off and on again
   (or `herdr-ws-resume --off` / `--on`). The `ln` line puts `herdr-ws-resume`
   (`--status`, `--list`, `--forget`) on your `PATH`:
   ```toml
   shell = ["/bin/sh", "-c", "r=\"$HOME/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-resume\"; [ -x \"$r\" ] && exec \"$r\"; exec \"${SHELL:-/bin/sh}\" -l"]
   ```
   ```sh
   ln -s ~/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-resume ~/.local/bin/
   ```
4. Switch to it: `herdr-app do layout.switch '{"name":"workspaces"}'`
   (`ctrl-shift-l` cycles back).
5. Open the switcher and pick **New workspace from a folder…**. The board button
   beside the switcher opens the workspace's board.
6. To start from the examples, copy them where Herdr reads them:
   - presets for every workspace: `examples/presets/*.md` to
     `~/.config/herdr-core/templates/` (where `hc run <name>` finds them too);
   - presets for one workspace: to `~/.herdr/workspaces/<id>/agents/`;
   - the scout, the researcher and the planner run Claude in auto mode
     (`--permission-mode auto` in their commands), so a helper never waits for
     someone to answer a prompt. If you can't use auto mode, change that word
     in Agent presets;
   - the foreman's command runs `pi` on the uncensored model
     `deepseek-v4.1-flash-uncensored`. Have `pi` set up with it, or change its
     `--model` in Agent presets to another non-Claude model you have;
   - automations need no copying: the Automations screen lists the ready-made
     ones (`mods/ws-automations/starters/`), and Create adds the one you open.
     They're written for the `implementer` and `reviewer` presets;
   - a guide for every agent the launcher starts (how to use automations, hc
     helpers and the board): open Agent presets in the footer and pick
     **Write one** under "Herdr guide", which writes the starter to
     `~/.herdr/AGENTS.md` and opens it. The switch beside it turns it off.

**What it touches:** it reads `~/.herdr/workspaces` and the folders of
each workspace's root. The `foreman` preset writes its plan under
`~/.herdr/scratch/` and starts `hand` terminals with `hc run`; those helpers
edit the folders they are given, by their own tasks. Two of the ready-made
automations (`issue-to-pr`, `main-is-red`) tell their agent to make git worktrees under
`~/.herdr/worktrees/` and to push branches and open pull requests with your
`gh` login; two have a check that runs `git log` and `gh` in the workspace's
folders, and `morning-review`'s also runs `git fetch` in each repo. It writes `~/.herdr/workspaces/.index`, a new
workspace's files when you make one, its `workspace.jsonc` when you rename it
or change its group, `~/.herdr/workspaces/.order.json` when you drag or fold in
the switcher menu,
task files in `~/.herdr/workspaces/<id>/tasks/` and automation files in
`~/.herdr/workspaces/<id>/automations/` and `~/.herdr/automations/` (the
ones for every workspace; from the Automations screen, a ready-made one
included, from
`herdr-ws-run --add`, `--off` and `--on`, and `enabled: false` after a one-time
one runs). Following a card's pull request writes `pr:` into its task and, when
it opens on a card still before the start column or merges, its `status:`, and types a message into the card's agent with
`hc send` when a check fails, a review arrives or it conflicts. With Keep running
on, that work is done by a Node process herdr-core holds as the terminal
`herdr-ws-runner`: it writes `~/.herdr/runner/`, starts runs with `hc run`, ends
old run terminals with `hc kill`, and reads herdr-core's terminal list, the app's
layout document, `shared.json` and `programs.json`. Deleting a workspace, a task or an
automation (after a confirmation) moves it to the Trash. The board's Worktree runs
`git worktree add` on a new `task/…` branch; otherwise your repos aren't
touched. It runs `sh` (editor, Trash, symlinked folders), `herdr-app do` (the
board's and automations' new tabs) and, through the launcher, Start and
automations, your agents. The Worktrees tab reads git in the workspace's repos and
their worktrees (`worktree list`, `for-each-ref`, `status`) and each repo's pull
requests with `gh pr list`. Removing a worktree there (after a confirmation)
deletes its folder with `git worktree remove`; the branch stays. History reads the
conversations your agents keep on this computer (`~/.claude/projects`, `~/.codex/state_*.sqlite`,
`~/.pi/agent/sessions`, `~/.grok/sessions`, `~/.local/share/opencode/opencode.db`,
`~/.gemini/antigravity-cli`): titles, the
first and last thing asked, folder, branch, model and the newest reply's token counts, and in Claude's,
Pi's and Antigravity's transcripts the lines that record a compaction (the whole file once, then
only what it gained), never the rest, and it changes nothing there.
It runs `node` (and `sqlite3` when Node is older than 22.13) to read them, keeps what it read in
`~/.herdr/cache/history/index.json`, and starts your agent with its resume command when you click
Resume. With restart resume on, the launcher's hook also notes each Claude session's start command
in `~/.herdr/resume/started`. Nothing it reads leaves the computer. The Agents list's numbers
come from the same places, read by `node` every few seconds while an agent works: what Claude
Code hands its status line, which `herdr-ws-statusline` keeps in `~/.herdr/agents/<core>/`
(the launcher sets it as the status line, in that session's `--settings`, where you have none),
Claude's `~/.claude/sessions/<pid>.json` (which session a running Claude is) and its transcript,
the file the launcher's Pi extension writes there, and Antigravity's transcript; the launcher's
restart note says which. It reads only the newest reply's model and token counts, the
compactions and the cost, keeps where it stopped in each transcript in
`~/.herdr/cache/agentstats.json`, asks `hc get` which program each agent's terminal runs, and
removes its files of terminals gone two days. For the plan usage in the status bar it runs
`claude -p /usage` (no session kept, hooks and MCP servers off) and `agy -p /usage` (no
conversation kept, its log to `/dev/null`) every 10 minutes: each agent's own usage report,
which it asks Anthropic or Google for with your sign-in; the package never reads a sign-in
itself. Until that answers, the status bar reads the limits from the status line
files in `~/.herdr/agents/`. On its first run it makes
the Scratch workspace (`~/.herdr/workspaces/scratch/`); New scratch space makes folders in
`~/.herdr/scratch/`, and there it deletes empty ones nobody is in (`rmdir`) and moves ones
with files to the Trash after 7 days unused, unless they have a `.keep` file. It looks at
nothing else there. Deleting Scratch closes its spaces and moves `~/.herdr/scratch`, kept
folders included, to the Trash with it. A repo's two
worktree scripts (`~/.herdr/workspaces/<id>/worktrees.json`) are shell lines Herdr
runs as you: setup in a new worktree the board makes, archive before a removal.
Like a check, only a line you saved or allowed in the screen runs
(`~/.herdr/workspaces/.worktree-scripts.json`). The launcher reads `~/.herdr/AGENTS.md`, your global guide, and `~/.herdr/guide/switch`, which the Presets screen's guide switch writes; the screen's Write one creates the guide from the starter and opens it in your editor. The launcher lets Claude, Codex and Antigravity read and edit
the workspace's root, its folders elsewhere and its `tasks` folder; Claude gets Herdr's own folders in that one session's `--settings`, and no settings file is written. For Antigravity it writes the instructions as a rules file under `~/.herdr/agy/`, gives Antigravity that folder, and removes the folders there that no launch has used for 90 days. Pi takes no folders, so the launcher names them in Pi's instructions, and passes your `~/.pi/agent/APPEND_SYSTEM.md`, when you have one, along with them. Automations watch the folders a files automation
names, read calls `herdr-ws-run` leaves in `~/.herdr/workspaces/.inbox` (and
delete them), and close an automation's older run tabs once their agent is done.
An automation's `check:` is a shell command Herdr runs by itself, as you, in the
automation's folder before each run, to see whether there's anything to do. It runs only a line you've allowed: one you saved in the Automations screen, or one you allowed there after an agent or a file brought it.
For restarts, the launcher keeps notes of the Claude agents it starts in
`~/.herdr/resume/` (their command and session), runs `hc ls` to drop the notes
of closed tabs, and gives Claude two hooks (`--settings`) that note its session
and drop the note when you leave it. Antigravity's hook is a `.agents/hooks.json` in its
rules folder that notes its conversation. The Presets and Automations screens run
`agy models` (it asks Antigravity's server) at most once a day and keep its answer in
`~/.herdr/cache/agy-models.json`. With the `shell` line in herdr-core's
config, every new terminal starts through `herdr-ws-resume`.
Every notification Herdr shows is also handed to `herdr-ws-notify`, and so is the
background runner's news while no window is open. It asks macOS which app is in
front (`lsappinfo`), then runs `terminal-notifier`, else `osascript`, or
`notify-send` on Linux, with the notification's title and text, and nothing when
none is installed. A click on a terminal-notifier one runs `herdr-app do` with
the toast's own action. Its switch is `~/.herdr/notify/switch`. The launcher
reads a workspace's `BRIEF.md`, when there is one, and puts it in the
instructions of the agents started there.
Four things use the network: GitHub automations (`gh api` with your login, every
2 minutes per watched repo), cards with a `pr:` or `branch:` line (`gh pr view`
with your login, every minute per open pull request), the board's GitHub view
(`gh api graphql` and `gh project list` with your login: the linked project board
when its last read is over 10 minutes old and the view is open, and the items you
took every 5 minutes; it only reads, writes the board's link into `workspace.jsonc`
and keeps the board as last read in `~/.herdr/cache/github-boards/`), and the Automations screen's Draft it and Change it,
which run `claude -p` with your Claude login and no tools. That sends Anthropic
your words, the workspace's name, root, folder names, GitHub repos and presets,
and, for a change, the automation as it stands.

Built for Herdr 0.1.14; `ws-spaces`, `ws-agents`, `ws-tabs`, `ws-new-menu` and
`ws-chrome` are copies of that version's `spaces`, `agents`, `tabs`, `new-menu`
and `workspace-chrome`. `ws-toast` and `ws-status` are copies of 0.1.16's `toast`
and `workspace-status`.

## Updating

`CHANGELOG.md` lists what changed in each version, and your copy says which
one you have in `~/.config/herdr-app/mods/ws-switcher/VERSION` (none: older
than 0.1.0's notes, so read them all). To hear about new versions, watch the
repo on GitHub for releases (Watch → Custom → Releases).

- **You copied the files as they are:** copy `layouts/workspaces.json` and the
  thirteen folders in `mods/` again, and do what the new versions' notes say
  (a new script to link, say). Your workspaces, tasks, presets and automations
  live elsewhere and aren't touched.
- **You or your agent changed them:** tell your agent "apply what's in this
  repo's `CHANGELOG.md` after version <yours>, keeping my changes", with
  `RECIPE.md` for the details of each one.

## License

Apache License 2.0. `ws-spaces`, `ws-agents`, `ws-tabs`, `ws-new-menu`,
`ws-chrome`, `ws-toast` and `ws-status` are modified copies of Herdr's own mods, also Apache 2.0; see `NOTICE`.

## Working on it

`AGENTS.md` is the checklist for a change (for you or your agent): what to update
with it, the picture, what the mods share, how to test and release.

Edit the live files in `~/.config/herdr-app`, then copy them here with
`scripts/sync-from-home.sh`.

Every change people would notice gets a line under `## [Unreleased]` in
`CHANGELOG.md`, in the same commit. `scripts/release.sh <version>` turns that
into a version (the middle number for anything new, the last for fixes only),
writes `VERSION`, commits and tags it; `--publish` also pushes and makes the
GitHub release from those notes.

The pictures are drawn, not screenshots: `preview.png` from
`mods/ws-switcher/preview.svg` (also the picture in Herdr's layout settings), and
the ones in `previews/` from the `preview*.svg` beside each mod. Edit the live
drawing, sync, and run `scripts/render-preview.sh`.

To try a change without touching your own window, `scripts/sandbox.sh up`
opens a second Herdr with its own core, home and two demo workspaces under
`/tmp/herdr-ws-sandbox`, running copies of the live mods. `sandbox.sh app …`
and `sandbox.sh hc …` talk to it, `sync` copies the live mods in again, and
`down` ends and deletes it. Agents and `gh` aren't signed in there: Claude
stops at its first-run question, which is enough to see a run start.
