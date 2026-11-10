# Workspaces

Herdr's own layout with one more level above spaces: workspaces. A workspace is
a folder of repos (`~/work/acme` with `api`, `web` and `docs` in it). A switcher
at the top of the sidebar picks one, and the spaces and agents lists then show
only what is in it. Each workspace has its own `AGENTS.md`, which Claude Code
and Codex are given when they start from the + menu inside that workspace.
Spaces join their workspace by their folder, so there is nothing to sort by hand.
Each workspace also has a task board in a tab of its own: one markdown file per
task. A card starts an agent on its task, in the repo or a fresh worktree, and
then shows that agent's live status. Agent presets (a command plus instructions,
herdr-core's template format) can be global or per workspace; the tab bar's +
menu and the board's Start run them. Automations run them by themselves:
on a schedule, when a task enters a board column, when an agent finishes or needs
you, when files change, when a PR or issue is opened on GitHub, or when another
app calls `herdr-ws-run`. Each run is a
tab in the workspace's "Automations" space, and your view stays where it is.

![Workspaces](preview.png)

## What you see

Left to right, as in Herdr's `main` layout, with one row added to the sidebar:

- **Sidebar, 268px**, theme `chrome` background, top to bottom:
  - The brand row (46px, Herdr's `workspace-chrome`), unchanged.
  - **The switcher (44px).** One row 34px tall with 8px corners:
    - a 20px mark with 5px corners, filled with the workspace's color and showing its first letter in white bold;
    - the workspace's name at 13px medium;
    - a 6px dot when an agent in *another* workspace is blocked (theme `blocked`) or finished (theme `done`);
    - the count of spaces in the shown workspace (11.5px, `dim`);
    - an 11px chevron;
    - beside the row, for a chosen workspace, a 28px board button (`mods/ws-board/board.svg`, 15px, `muted`) that opens its board.

    With no workspace chosen, it reads "All spaces" behind an outlined mark with the layers icon. On the narrow rail (sidebar under 160px) it's a 32px cell with just the mark, the dot at its top right and the name as a tooltip.
  - **Spaces** (`ws-spaces`): Herdr's spaces list, showing only the shown workspace's spaces. A workspace with no spaces yet says "No spaces in Acme yet." and lists up to 12 of its folders (12px, `dim`, folder icon), each opening a space there.
  - **Agents** (`ws-agents`): Herdr's agents list, showing only the shown workspace's agents. When the workspace has none and other workspaces do, it says "No agents in Acme. Agents in other workspaces show in theirs."
  - The footer (125px, `ws-chrome`): Herdr's footer with an "Automations" row (`mods/ws-automations/automations.svg`, a lightning bolt) and an "Agent presets" row (the `presets.svg` robot icon) above Settings and Add machine. They open the Automations and Presets screens for the shown workspace.
- **Work area**: Herdr's tab bar (`ws-tabs`), panes as cards, Files and Changes panels, and status bar. Only the + menu changes: it also lists the agent presets.
- **The switcher menu**: a popup 288px wide and at most 600px tall, in theme `popover`, top to bottom:
  - "New workspace from a folder…" (the `folder-plus` icon), then a line;
  - "Workspaces" (11px, `dim`), then "All spaces" and every workspace, each a 30px row with an 18px mark, the name, the dot when one of its agents is blocked or finished, its count of spaces, and a check on the shown one;
  - a line, then the actions: "Open <workspace> board" (only on the narrow rail, where the board button is hidden), "Move “<shown space>” to…", "Open <workspace>'s files" ("Open the workspaces folder" with none chosen) and, for the shown workspace, "Rename <workspace>…" and "Delete <workspace>…" (in theme `blocked`, with the `archive` icon);
  - a line, then "<Workspace> folders": one row per folder, ending "Go" when a space is already there and "Open" when there isn't. It scrolls when long.
- **The Start dialog** (`ws-presets` with `props: { start, workspace }`, 560×430):
  - "Start <name>" with the program icon, the preset's description, its command (mono, `dim`), and where it will run ("A new tab in “<space>”, in <folder>");
  - a note on how the task arrives;
  - a Task textarea with an `accent` border, focused;
  - "⌘Enter starts it" (Ctrl+Enter elsewhere), Cancel and Start.
- **The + menu** (`ws-new-menu`, from the tab bar's +): Herdr's menu, at most 85% of the window tall, with one more section:
  - Terminal, then "Start an agent" with the installed agents and their number keys, as in Herdr;
  - "Agent presets" (11px, `dim`): the shown workspace's own presets, then the global ones it doesn't replace. Each 31px row has the program's icon (else the terminal icon), the name and its number key while it's among the first nine rows. The tooltip shows the description and "Only in <workspace>" or "Every workspace";
  - no "Agent presets" section when there are none, or when the shown space is on another machine;
  - a line, then New space, New worktree… and Open worktree…, as in Herdr.
- **The Presets screen** (`ws-presets`), a 900×640 dialog: "Agent presets" and "for <workspace>" in a 50px header, then two panes.
  - **The list** (250px, `chrome`, right border): a "New preset" button (theme `solid`), then "Only in <workspace>" and "Every workspace" sections. Each row (32px) has the program icon and the name, plus "replaces global" on a workspace preset that shadows a global one, "replaced here" on the global it shadows, and "error" in `blocked` when the file can't be used (its reason as a tooltip). The chosen row is `selected`.
  - **The editor**, top to bottom:
    - the program icon (20px), the name (16px semibold) or "New preset", a pill saying where it lives, "unsaved" in `working` while edited, and, for a new preset, two chips choosing where it goes;
    - Name (new presets only), Description, Command (in JetBrains Mono), and "Start from" chips: the installed agents from Herdr's list, which fill in the command;
    - for Claude, Codex and Pi commands:
      - **Model**: "Default", the agent's models and a small "another model, then Enter" field. Claude's models are its aliases fable, opus, sonnet and haiku; Codex's are every `model = "…"` in `~/.codex/config.toml`, its default shown as "Default (<model>)"; Pi has none listed;
      - **Effort**: "Default" and the agent's levels. Claude: low–max. Codex: minimal–max. Pi: off–max.

      The chip matching the command is highlighted;
    - Instructions, a textarea filling the rest. Its label says whether they arrive as system instructions or as the first message;
    - an error or "Saved." line;
    - a footer: Delete (in `blocked`, click twice), Duplicate, "Change for <workspace>" (on a global preset the workspace doesn't replace yet), the file's path, Start (when saved), and Save or Create.

    With nothing picked, the editor explains what presets are and where they live.
- **The Automations screen** (`ws-automations`), a 940×680 dialog: the bolt icon, "Automations" and "for <workspace>" in a 50px header, then two panes. With no workspace chosen it only says to pick one.
  - **The list** (260px, `chrome`): a "New automation" button (theme `solid`), then a 46px row per automation: a 7px dot (`done` when on, `dim` when off, `blocked` when its `when:` can't be read), the name, the trigger in words under it (11px, `dim`, e.g. "Weekdays at 09:00", "When a task enters Review"), and on the right the next run's time ("09:00", "Tue 09:00", "1 Dec 00:00") or "off". "None yet." when empty.
  - **The editor**, a scrolling form (each automation opens scrolled to the top) over a pinned footer:
    - the name (16px semibold) or "New automation", "unsaved" in `working` while edited, and On / Off chips on the right;
    - Name (new ones only; it suggests `automation-<n>`), Description;
    - **When**: kind chips (Schedule, Board, Agent, Files, GitHub, By hand), the `when:` line (JetBrains Mono), then quick chips for that kind: `every 30m`, `every 1h`, `daily 09:00`, `weekdays 09:00`, `mon 09:00`, `0 9 * * 1-5`; the board's columns; Finishes / Needs you; the workspace's folders; for GitHub, the workspace's folders that have a GitHub remote, then Pull requests / Issues and "By others only". Under them, the line in words plus "· next <time>" for a schedule or "· looks every 2 minutes, with your gh login" for GitHub, or the reason it can't be read in `blocked`. A files automation whose folder can't be watched, or a GitHub one whose repo can't be found or read, says why in `working`;
    - **Agent** chips: "Board's (<board.agent>)" and the workspace's presets;
    - **Folder** chips: Root ("Its repo's folder" for GitHub) and the workspace's folders;
    - **Each run** chips: "Just its tab" / "A tab and a board card";
    - **Prompt**: a 150px textarea, then the fill-ins for that kind and, for event kinds, "What set it off is added at the end, unless the prompt uses {{event}} or one of the fill-ins above.";
    - for a saved one, **Recent runs**: up to four rows with the time, why it ran (and a note for skipped or failed runs), its state (working, needs you, finished, open, closed, skipped, failed) and "Go to" while its tab is open; then "From another app or a script" and `herdr-ws-run <workspace> <name> "optional text"` in mono;
    - the footer: an error or notice line, Delete (in `blocked`, click twice), the file's path, Run now (saved ones), and Save or Create.

    With nothing picked, the editor explains what automations do, where runs go, that they run while Herdr is open, and where the files are.
- **The Automations space**: a space named "Automations" in each workspace that has run one, made the first time. Each run is a tab named after its automation.
- **The board** (`ws-board`), a tab named "Board" whose only pane is the board, in theme `canvas`:
  - **Header** (48px, bottom border): the workspace's 20px mark, "<name> board" (semibold), "N open · M done" (12px, `dim`), then on the right a Board | List toggle (two 26px segments with the `board.svg` and `list.svg` icons in a 1px-bordered `chrome` pill; the chosen one in `selected`) and a "New task" button (theme `solid`, plus icon).
  - **List view**: one section per column, top to bottom.
    - A 34px section header in `chrome` with a bottom border: a fold chevron, the column name (12px semibold, `muted`), its count, and a `+` on the right.
    - Under it, a 40px row per task with a bottom border, indented 36px. The row shows the id (64px, `dim`), the title (13px, truncated, takes the rest), the priority word (52px, colored as on cards), the folder chip and branch icon (120px), and the card's agent footer on one line, right-aligned (210px).
    - When there are no tasks at all, the list says "No tasks yet. New task adds one." 
  - **Columns** (12px padding, 10px apart, equal widths that always fit), one per status, in theme `chrome` with a 1px border and 10px corners. Each has a 38px header with the column name (12px semibold, `muted`), its count and a `+`, then a scrolling list of cards. A column being dropped on gets an `accent` border. An empty column says "Empty"; the first one says "No tasks yet. New task adds one." when there are none at all.
  - **Cards** (theme `background`, 1px border, 8px corners, 10px padding):
    - a top row: the task id (11px, `dim`), the folder's name in a small `raised` chip, a branch icon when it has a worktree, the task's preset name when it has one, and the priority word on the right (high in `blocked`, medium in `working`, low in `dim`);
    - the title at 13px;
    - a footer:
      - while starting, "Starting…" or "Making the worktree…";
      - with a live agent, a 7px dot in the agent's status color, "<program> · working / needs you / finished / idle / running" and a "Go to" button;
      - otherwise, except in the last column, "Agent ended" if its agent is gone, then "Start" and "Worktree" buttons (24px, 1px border).

    The footer and top row wrap on narrow cards. A card being dragged fades to 40%.
  - **The task dialog** (600×560): the id, or "New task in <workspace>", with Esc on the right. Then, in order:
    - Title (an input);
    - Status (chips, one per column);
    - "Folder: where Start runs the agent" (chips: Workspace root, then the workspace's folders);
    - Priority (None, Low, Medium, High);
    - "Agent: who Start runs (default: <board.agent>)" (chips: Default, then the presets);
    - Notes (a textarea that fills the rest);
    - a footer with Delete (in `blocked`; a second click deletes), the file's path, Cancel, and Save or "Add task".

## How it behaves

- **Agent states** work as in Herdr's lists (working, blocked, done, idle). The switcher's dot only speaks up for blocked and done agents in workspaces that aren't shown. Blocked wins over done.
- **The switcher menu is only about workspaces.** The board opens from the button beside the switcher. Presets start from the + menu and are managed from the footer's Agent presets; automations are the footer's Automations.
- **Choosing a workspace** (a click, or `0`–`9` while the menu is open; `0` is All spaces) filters both lists. It also shows the space you last had open in that workspace, else its first. A workspace with no spaces leaves the shown space where it is.
- **A space joins a workspace once and stays.** It joins when its first terminal is under the workspace's `root` or one of its `folders`; the longest matching folder wins, so a nested workspace beats its parent. A space in a herdr worktree (`~/.herdr/worktrees/<repo>/<branch>`) goes by the repo's name. A space with neither, made while a workspace is shown, joins that workspace once its first terminal has had 1.5s to report its folder. Spaces from before the workspace existed keep the workspace they were in.
- **The switcher follows you.** When a key, a toast or `space.next` shows a space from another workspace, the switcher switches to that workspace. A space in no workspace switches it to All spaces.
- **"Move “x” to…"** turns the menu into a list of workspaces plus "No workspace". Picking one moves the shown space there and shows that workspace. A space set to "No workspace" never joins one by its folder again.
- **"New workspace from a folder…"** opens the system folder picker. It writes `~/.herdr/workspaces/<slug>/workspace.jsonc` (listing the folder's subfolders, with the next unused color) and an `AGENTS.md` that is only a comment, then shows the new workspace.
- **"Open … files"** opens the workspace's folder in the first installed editor of `zed`, `cursor`, `code` and `subl`, else with `open` / `xdg-open` (Explorer on Windows).
- **"Rename…"** opens a 420×210 dialog: "Rename workspace", a Name field with the current name selected, and Cancel / Save. Enter saves and Esc cancels; an empty name is refused. It rewrites only the top-level `"name"` string in `workspace.jsonc`, keeping comments, other keys and the folder id. If there is no `"name"`, it adds one after the opening `{`. The write fails if the file changed since it was read.
- **"Delete…"** opens a 420×200 dialog: "Delete “Acme”?", saying the folder and its two files go to the Trash, your repos aren't touched, and its spaces stay open. Cancel / "Move to Trash"; Enter confirms and Esc cancels. The folder goes to the Trash with `trash` (macOS) or `gio trash` (Linux), else to `~/.herdr/workspaces/.trash/<id>-<time>`. A toast says where. Its spaces are decided again: they join the workspace their folder is in, else show under All spaces. A workspace deleted by hand is handled the same way.
- **The + menu** (when `programs.json` points at the launcher; see Built from): Claude Code and Codex started inside a workspace get its `AGENTS.md`, without HTML comments, plus `--add-dir` for the workspace root and for any folder outside it. Elsewhere they start as before. An `AGENTS.md` that is only a comment adds nothing.
- **The `+` in the Spaces header** makes a space in the shown workspace's root.
- Config edits apply within a second: the switcher watches `~/.herdr/workspaces`.
- **Folders reached through a symlink** (macOS's `/tmp` is `/private/tmp`) match by both paths. Terminals report the real one.

**Agent presets:**
- **What one is**: herdr-core's template format, a markdown file whose name is the preset's name. Front matter has `description` and `command` (a shell line, values taken as written, the model and flags included), and the body is its instructions. HTML comments in the body are left out.
- **Where they live**:
  - global presets are herdr-core's templates in `~/.config/herdr-core/templates/`, which agents can also start with `hc run <name> "<task>"`;
  - a workspace's own are in `~/.herdr/workspaces/<id>/agents/`, and win over a global one by name;
  - both folders are watched.
- **In the Presets screen**:
  - **Model and Effort chips** rewrite the command, setting, replacing or removing (Default) the agent's own flag:
    - Claude: `--model x`, `--effort x`;
    - Codex: `--model x` (it also reads `-m x`), `-c model_reasoning_effort="x"`;
    - Pi: `--model x`, `--thinking x`.

    `--flag=x` is read too. Rewriting re-quotes the command's words.
  - **Picking a preset** loads its file into the editor. With unsaved edits, the first click on another preset only warns, and a second click discards them.
  - **Save** rewrites `description` and `command` (one line each, as written) and the body, keeping the file's other front matter lines (`ready`, `submit`, …). It fails if the file changed on disk since it was opened.
  - **Create** writes `<name>.md` in the chosen place and refuses an existing name. A name is letters, digits, dots, dashes or underscores.
  - **Duplicate** opens a new preset filled in from this one, named `<name>-copy`.
  - **"Change for <workspace>"** opens a workspace copy with the same name, which then replaces the global one there.
  - **Delete** moves the file to the Trash.
  - **Start** closes the screen and opens the Start dialog.
  - The list updates at once after Save, Create and Delete.
- **Starting a preset by hand** goes through the Start dialog, from the + menu or the Presets screen's Start. Whatever is in Task becomes its first message: after the instructions for agents that get them in that message. Left empty, the agent starts idle.
- **A preset in the + menu** (a click or its number key), then **Start**, opens a tab named after it in the shown space, in its focused terminal's folder. With no space shown, it makes a new space in the workspace's root.
- **How a preset starts**:
  - with the launcher installed and a `claude` or `codex` command, the preset's instructions become system instructions, after the workspace's. The command runs as `herdr-ws-agent --instructions <file> <command>`, and the task, if any, is the first message;
  - any other agent gets the instructions, then the task, as its first message, as `hc run` does;
  - a leading `herdr-ws-agent` in the command is fine (it's added once), and `VAR=x` assignments go before it;
  - either way, the instructions start with a line naming the preset: `You are the "<name>" agent, started from the Herdr agent preset of that name (<file>). Its instructions:`. That's how the agent knows which preset it is.
- **An agent starting a preset** (an orchestrator starting its helpers): `hc run <name>` only knows herdr-core's templates, so the launcher has `herdr-ws-agent --preset <name> "<task>"`. It takes the workspace's own preset with that name, else the global one, and starts it the way Herdr's UI does. `herdr-ws-agent --presets` lists what the folder's workspace offers: its own presets with their descriptions, then the global ones (a global one the workspace replaces says so). A helper is started as `hc run --bg --name <name> --cwd <folder> herdr-ws-agent --preset <preset> "<task>"`, so it's the caller's child: it shows under it in the Agents list and ends when it does.
- **The orchestrator** (`examples/presets/orchestrator.md`): a Claude preset whose instructions teach it to coordinate through Herdr. It lists presets with `--presets`, starts one helper per piece with the line above (in the right repo, with a worktree each when several change one repo), waits with `hc wait --children`, steers with `hc send` and `hc interrupt`, reads results itself instead of trusting reports, hands a helper's permission questions to the person, runs slow commands in terminals of their own, checks the whole and reports, then stops the helpers it's done with. On a board card, it keeps a "## Helpers" list in the card's file. Its command allows `hc` and `herdr-ws-agent --presets` without asking, through `--settings` (`--allowedTools` takes several values and would swallow the task).

**The board:**
- **Opening it** (the switcher's board button, or "Open … board" in the menu on the narrow rail) shows the board tab that is already open in one of the workspace's spaces. Otherwise it makes one in the shown space (if that space is in the workspace), else in the workspace's first space, else in a new space in its root.
- **Columns** are the workspace's `board.columns`, by default `backlog, todo, doing, review, done`. A task whose status isn't a column shows in the first one. The last column counts as done: it has no Start buttons and isn't in the "open" count. Within a column, cards sort by priority (high first), then by id number.
- **Dragging a card** to another column sets its status, shown at once and written to its file. Dropping doesn't open the card. Clicking a card opens the task dialog.
- **Board | List** switches the view. Each board tab remembers its choice, and Board is the default.
- **In the list**:
  - clicking a section header folds or unfolds it. Each board tab remembers its folded sections, and the last column (done) starts folded;
  - a section's `+` adds a task in that column;
  - clicking a row opens the task dialog.

  Rows sort as cards do. There's no dragging in the list: change a status in the dialog.
- **"New task"** or a column's `+` opens the dialog for a new task in the first column or that column.
  - "Add task" writes `tasks/<PREFIX>-<n>.md`, one more than the highest number there. The prefix is `board.prefix`, by default the workspace id's first three letters in capitals.
  - A title is required; Enter in the title saves.
- **Saving an existing task** writes only the fields changed in the dialog, so an agent's edits made in the meantime stay. The notes replace the body only if they changed.
- **Delete** in the dialog asks with a second click, then moves the task's file to the Trash (else `~/.herdr/workspaces/.trash/`).
- **Start** runs the task's preset (its `agent:` field, set in the dialog), else `board.agent` (by default `claude`). Either one can be a preset's name, started as above, or a program from Herdr's agent list, started the way Herdr's + menu starts it (so through the launcher too). It runs in the task's folder:
  - as a new tab named after the task id in the workspace's space that holds that folder (the deepest one);
  - else as a new space there.
- **Worktree** first runs `git worktree add -b task/<id>-<title-slug> ~/.herdr/worktrees/<repo>/<slug>` from the repo's HEAD, the same place Herdr's worktree menu uses. It reuses the branch or folder if they already exist, then opens a new space there with a tab named after the task id. That space joins the workspace through the worktree rule above.
- **After either Start**, the card moves to `board.start` (default `doing`), and the task records:
  - `terminal`, the agent's address;
  - `started`;
  - for Worktree, also `worktree` and `branch`.
- **The agent's first message** is the id and title, the notes, then where the task file is and what to do when finished: set `status:` to `board.finish` (default `review`), put anything left open under "## Notes", and leave the other front-matter lines alone.
- **A card with an agent** shows that agent's status live, from `agents()` by address. When the address is a live terminal but not an agent, it says "running". When the terminal is gone, it says "Agent ended" and offers Start again. "Go to" runs `agent.focus`.
- **Task files are watched**: an agent's or a person's edit shows within a second.

**Automations:**
- **What one is**: `~/.herdr/workspaces/<id>/automations/<name>.md`, front matter then the prompt (HTML comments left out):
  - `when:` what sets it off (below);
  - `agent:` a preset or a program, by default the board's agent;
  - `folder:` where it runs, from the root (or absolute / `~`), by default the root;
  - `card: true` also adds a board card per run;
  - `enabled: false` turns it off: then only Run now and `herdr-ws-run` start it.
- **`when:`**, read the same way by the runner and the screen:
  - `every 30m`, `every 2h`, `every 1d`: an interval of at least a minute, counted from its last run (from when it was first seen, before that);
  - `09:00`, `daily 9:00`, `weekdays 09:00,17:30`, `weekends 10am`, `mon,wed 8:30`, `mon-fri 9:00`, `at 6pm`: days and times, on this computer's clock;
  - `0 9 * * 1-5`: cron's five fields, with `*`, lists, ranges and steps; with both day fields set, either one will do;
  - `task enters <column>`: a board task's status changes to that column, or a new task is written there;
  - `agent done` (it finished: working → done or idle) or `agent blocked` (it needs you), optionally followed by a tab name to listen to only that one;
  - `files <folder>`: something is made or changed under that folder (from the root);
  - `github <repo> pr opened` or `github <repo> issue opened`: a pull request or issue is opened on GitHub. `<repo>` is a workspace folder (its `origin` remote must be on github.com) or `owner/name`. `by others` leaves out your own (your `gh` login); `label:<name>` (or `label:"two words"`) only takes ones that have that label when they're first seen;
  - `link` (or empty): only Run now and `herdr-ws-run`.
- **GitHub** is asked with `gh api repos/<owner>/<name>/issues?state=all&sort=created&direction=desc&per_page=30` every 2 minutes: one call per repo, shared by every automation watching it, using your `gh` login. That list has issues and pull requests both.
  - The first look only notes the highest number there. After that, every higher number is new, oldest first, at most 10 per look; more than 30 at once (after a long time closed) loses the oldest.
  - PRs and issues opened while Herdr was closed are picked up when it opens. A repo nothing watches any more forgets what it saw, so watching it again starts afresh.
  - Each new PR or issue gets its own run, even while another is working. A run with no `folder:` runs in the repo's folder (the root for `owner/name`).
  - A repo that can't be read (gh missing or signed out, no access, a typo) shows the reason on the automation and is tried again on the next look.
- **A run** starts the agent like a preset's Start, with the prompt as its task, as a tab named after the automation in the workspace's "Automations" space. The first run makes that space in its folder, and the space joins the workspace at once. Making a tab shows it, so the runner puts back the space and tab you were on straight after. A toast says "<name> started", why and where; clicking it shows the tab.
- **Fill-ins** in the prompt: `{{event}}` (what set it off, in words or a block), `{{workspace}}`, `{{automation}}`, `{{folder}}`, `{{date}}`, `{{time}}`, and by kind: `{{task}}` (id, title, notes and file), `{{task.id}}`, `{{task.title}}`, `{{task.file}}`; `{{agent}}` (its tab's name), `{{terminal}}`, `{{space}}`; `{{files}}` (one per line, at most 50), `{{file}}`; `{{text}}` (what `herdr-ws-run` was given); `{{pr}}` or `{{issue}}` (number, title, author, link, labels and the first 4,000 characters of its description), `{{number}}`, `{{title}}`, `{{url}}`, `{{author}}`, `{{repo}}`, `{{labels}}`. Unknown ones stay as written. For anything but a schedule, what set it off is added at the end unless the prompt uses `{{event}}` or one of its kind's fill-ins.
- **With `card: true`**, a run first writes a task in the board's start column: title "<description or name> (<date> <time>)", `agent:`, `folder:`, `automation: <name>`, `created:`, and the prompt as its notes. The agent gets the board's brief for it, and the card gets `terminal:` and `started:`, as with Start.
- **When it doesn't start**:
  - an automatic run doesn't start within 50s of the same automation's last one;
  - a schedule, interval or files run is skipped while the automation's last run is still working or waiting on you, and the skip is logged;
  - a board, agent or GitHub run is per task, agent, PR or issue instead, so two tasks entering Review start two runs;
  - Run now and `herdr-ws-run` always start, even when the automation is off. Several calls at once start one after another.
- **Loops are cut off**:
  - agent automations ignore the agents automations started;
  - board automations ignore a card an automation has just made (its later moves count);
  - files automations ignore changes made while their own run is working, dotfiles, and anything under `.git` or `node_modules`. They wait for 3s of quiet, then start once for everything that changed, leaving out files that are gone again.
- **Missed schedules**: a schedule due while Herdr was closed runs once when Herdr opens, if it was due in the last 12 hours ("Missed 09:00 while Herdr was closed"). Older ones are skipped. An interval that came due while closed runs once.
- **Run tabs**: each automation keeps its newest three run tabs. Older ones close when a new run starts, unless their agent is working or waiting on you.
- **`herdr-ws-run <workspace> <automation> [text…]`** (or `-` for the text from stdin; `--list` lists what there is): `<workspace>` is the folder name in `~/.herdr/workspaces`. It checks the automation's file exists, leaves the call in `~/.herdr/workspaces/.inbox/<time>-<pid>.run`, and says whether Herdr is open. Herdr picks it up within two seconds and deletes the file. A call that waited over an hour (Herdr closed) is dropped and logged.
- **In the screen**:
  - kind chips switch the `when:` line to that kind's first example, and quick chips set it;
  - **Save** rewrites `description`, `when`, `agent`, `folder`, `card` (only when true) and `enabled` (only when false) and the prompt, keeping other front matter lines. It refuses a `when:` it can't read, and fails if the file changed on disk since it was opened;
  - **Create** refuses a name that's taken; **Delete** moves the file to the Trash;
  - **Run now** asks for a save first when there are unsaved edits;
  - **Go to** shows the run's space and tab.
- **The run history** is the last 100 runs (started, skipped, failed). A workspace that's gone takes its runs with it.

## Built from

**Layout** `layouts/workspaces.json`: Herdr's `main` (0.1.14) cloned. The sidebar column gets a block `{ "id": "workspace-switcher", "size": { "px": 44 }, "content": { "mod": "ws-switcher" } }` after `brand`. The `spaces` block uses `ws-spaces` and the `agents` block uses `ws-agents`. Root `"preview": "mods/ws-switcher/preview.svg"`. The `tabs` block uses `ws-tabs`. Everything else is `main` unchanged: `workspace-chrome`, `pane`, `files`, `changes` and `workspace-status` are Herdr's shipped mods.

**Workspace files** (not part of the package; people make their own), `~/.herdr/workspaces/<id>/`:

```jsonc
// workspace.jsonc: comments and trailing commas are fine
{
  "name": "Acme",            // shown in the switcher
  "color": "ansi4",          // ansi1..ansi6 or "#rrggbb"
  "root": "~/work/acme",     // spaces under it join
  "folders": ["api", "web", "~/shared/design-system"],  // relative to root, or absolute
  // "instructions": "AGENTS.md",   // default: AGENTS.md next to this file
  // "board": { "columns": ["backlog", "todo", "doing", "review", "done"],
  //            "prefix": "ACM", "agent": "claude", "start": "doing", "finish": "review" },
}
```

**`mods/ws-switcher`** (`mod.json`: `{ "place": "none" }`). The only mod that decides anything:
- reads every `workspace.jsonc` with a small JSONC parser and lists each root's subfolders (`fs/promises` `readdir`). It resolves each root and folder's real path with one `sh` call (`cd && pwd -P`), kept as `real` in each def; the matching uses both;
- waits on `watchFolder(~/.herdr/workspaces)`, falling back to a 5s timer if that fails;
- places spaces (`spaces()`, `panes()`) and records which ones it has decided, in `render()` and on a 500ms timer, because Herdr doesn't draw while its window is in the background;
- loads presets: it watches `~/.config/herdr-core/templates`, retrying every 10s while the folder doesn't exist, and each workspace's `agents/`. It publishes `workspaces.presets` (`{ global, workspaces: { id: [...] } }`, each preset `{ name, file, scope, description, command, body, error }`) and `workspaces.launcher` (whether `herdr-ws-agent` is on `PATH`);
- writes this shared state:
  - `workspaces.defs`: the parsed configs;
  - `workspaces.active`: the shown workspace's id, null for all;
  - `workspaces.assigned`: space id → workspace id, or `false` for "No workspace";
  - `workspaces.last`: workspace id → last shown space;
  - `workspaces.create`: the menu asks the sidebar copy to run the folder picker, because a popup's tasks end when it closes;
  - `workspaces.board`: `{ id, at }`, the menu (on the narrow rail) asks the sidebar copy to open a board, for the same reason;
  - it also reads `workspaces.launch` (`{ workspace, name, task, at }`) from the Start dialog and starts that preset with that task;
- handles those requests (create, launch, board) in `render()` and on the 500ms timer, because Herdr doesn't draw in the background. A request older than 15s is dropped, so a click from earlier never starts an agent late, and a reload drops what was pending;
- opens a board: finds a `panes()` entry with `mod: "ws-board"` in one of the workspace's spaces, else runs `tab.new { space, name: "Board", mod: "ws-board", props: { workspace } }`. It makes the space first with `herdr-app do space.new` when the workspace has none, because `run()` doesn't return what it made;
- opens its own menu as `openOverlay({ mod: "ws-switcher", kind: "popup", props: { popup: true } })`, and its rename and delete dialogs as `kind: "dialog"` with `props: { dialog: "rename" | "delete", id }`. Each dialog does its file work before it closes itself, because a closed overlay's tasks are cancelled;
- runs `space.select` and `space.new {folder}`;
- writes `~/.herdr/workspaces/.index` with `writeTextFile`, only when it changes: tab-separated `ws`, `dir` and `repo` lines for the launcher;
- runs automations: the sidebar copy makes the one `Runner` (`automations.js`), loads it after each config reload, passes it what its folder watch saw, and ticks it on the 500ms timer. While the runner is making a run's tab, `sync()` doesn't follow the shown space or remember it as the workspace's last. It also handles `workspaces.automation.run` (`{ workspace, name, at }`, from Run now) like the other requests;
- uses Herdr's icons from `mods/workspace-chrome/` (`layers`, `chevron-down`, `check`, `folder`, `folder-plus`, `file-text`, `square-pen`, `archive`), and `InputState` / `Input` from `gpui-base` for the Name field.

**`mods/ws-switcher/bin/herdr-ws-agent`**: the POSIX `sh` launcher, `herdr-ws-agent [--instructions FILE]... <agent> [args...]`. Each `--instructions` file's body (front matter and HTML comments left out) is added after the workspace's instructions, in or out of a workspace, under the line naming the preset (the file's name without `.md`).
- It reads `.index`, finds the workspace holding `pwd -P`, and puts its extra words before the caller's:
  - for Claude Code: `--append-system-prompt <text>` and `--add-dir`;
  - for Codex: `-c developer_instructions="<TOML string>"` and `--add-dir`.
- `awk` drops `<!-- -->` comments and `sed` escapes the text for TOML.
- `--preset NAME [task]`: finds `agents/NAME.md` in the folder's workspace, else `templates/NAME.md`, reads its `command:` with `eval "set -- …"` (as the shell would), exports leading `VAR=x` words, drops a leading `herdr-ws-agent`, and then runs itself again with `--instructions <file>` for Claude and Codex. Any other agent gets the line naming the preset, its body and the task as one last argument. `--presets` prints the list (descriptions from front matter). A name with a `/` or starting with `.` is refused.
- `HERDR_WS_AGENT_DRY=1` prints the command instead of running it.
- To wire it into the + menu, put it on `PATH` (for example `ln -s ~/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-agent ~/.local/bin/`), then add to `programs.json`:
  ```json
  { "programs": { "claude": { "run": ["herdr-ws-agent", "claude"] },
                  "codex":  { "run": ["herdr-ws-agent", "codex", "--no-daemon"] } } }
  ```

**`mods/ws-switcher/automations.js`**: the runner.
- **Reads** every workspace's `automations/*.md`, with the board's front matter rules. Its `tasks/` too, for workspaces that have a board automation. It publishes `workspaces.automations` (`{ <workspace>: [{ name, file, description, when, trigger, summary, agent, folder, card, enabled, body, error, next, warning }] }`) and `workspaces.automation.runs` (newest first: `{ id, ws, name, at, why, status, note, terminal, tab, space, card }`).
- **Remembers** in the switcher copy's `localStorage` (`automations`): when each last ran, when an interval was first seen, when Herdr last ticked (`seen`, every minute, for missed schedules), and the runs.
- **Schedules** are checked once a minute against that minute; intervals every tick.
- **Agents**: each tick compares `agents()` statuses with the last tick's. A run is recognised by its terminal and its tab together, because a terminal's address can be used again later.
- **Board**: on a change under `tasks/`, it reads the tasks again and compares statuses.
- **Files**: one `watchFolder` per folder a files automation names; a watch that fails is reported on that automation.
- **GitHub**: each github automation's repo is found once (`git -C <folder> remote get-url origin`, else `owner/name`), and every 2 minutes `gh api` lists each watched repo's newest 30 issues and PRs. Your login (`gh api user`) is asked once, for "by others". The highest number seen per repo is kept in `localStorage` (`github`).
- **Outside calls**: on a change under `.inbox` and every 2s, it reads the `.run` files (workspace, automation, time in ms, then the text) and deletes them with `rm`.
- **Starting** goes through the switcher's `presetLaunch()` (else `knownAgents()`), then `herdr-app do tab.new` (or `space.new { name: "Automations" }` the first time) through `exec`, then `space.select` / `tab.select` back to the `focused()` space and tab. Starts of one automation are queued, one after another. `fs` only reads under home, so whether a folder or file exists is asked of `test -e` when it's elsewhere.
- **Board helpers** (`boardOf`, front matter, `nextId`, `brief`, `folderPath`) are copies of `ws-board`'s, because mods can't import across folders.

**`mods/ws-switcher/when.js`**: the `when:` reader (`parseWhen`, `due`, `nextAt` up to 32 days ahead, `describe`, `shortTime`). `mods/ws-automations/when.js` is the same file; `scripts/sync-from-home.sh` stops when they differ.

**`mods/ws-switcher/bin/herdr-ws-run`**: POSIX `sh`. It writes the call to `<name>.tmp`, then moves it to `.run`, so the runner never reads half of one. `herdr-app status` tells it whether Herdr is open.

**`mods/ws-automations`** (`mod.json`: `{ "place": "none", "title": "Automations" }`, plus `automations.svg` and `when.js`): the screen, opened as `openOverlay({ mod: "ws-automations", kind: "dialog", width: 940, height: 680, props: { workspace } })` by the footer row. It reads the list and runs from shared state and each file afresh when it's picked, writes with `writeTextFile` (the text it read as `expected`, null for Create), updates `workspaces.automations` itself until the runner confirms, and sets `workspaces.automation.run` for Run now. Like the Presets screen, it makes its inputs once in `init` and redraws with the reading task's own `cx`.

**`mods/ws-board`** (`mod.json`: `{ "place": "none", "title": "Board" }`, plus `board.svg` and `list.svg`). It's a pane mod with `props: { workspace }`. The same mod draws the task dialog, opened as `openOverlay({ mod: "ws-board", kind: "dialog", width: 600, height: 560, props: { dialog: "task", workspace, task, status } })`.

- **Task file**: `~/.herdr/workspaces/<id>/tasks/<ID>.md`:
  ```md
  ---
  id: ACM-3
  title: Fix the login redirect
  status: todo
  folder: api
  priority: high
  created: 2026-11-09
  ---

  Keep the return path in the login URL.
  ```
  - The front matter is simple `key: value` lines. Values are quoted (JSON style) only when YAML would read them differently.
  - Unknown lines and inline `# comments` are kept. Fields are set by rewriting or appending their line, and an empty value removes the line.
  - `folder` is relative to the root, or absolute / `~`.
  - `created` and `started` are dates on this computer's clock.
- **Live data**: it waits on `watchFolder(~/.herdr/workspaces/<id>)` (`tasks/` may not exist yet), reads `agents()` and `terminals()` for card status, and gets the board settings from the switcher's `workspaces.defs` (`board`).
- **Writes**: `writeTextFile` with the text it just read as `expected`. It reads again and retries up to three times when the file changed under it, and a new task's write uses `expected: null`, so a taken ID moves on to the next.
- **Start**:
  - a preset goes through `presetLaunch()`, with the brief as its task. `presetLaunch()` and `words()` are copies of the switcher's and must stay the same;
  - otherwise the agent's `run` from `knownAgents()` (else `[agent]`) is the `argv`, and the brief is the `task` (Herdr appends it as the agent's last argument);
  - it calls `herdr-app do tab.new` / `space.new` through `exec`, to learn the new terminal's address, because `run()` returns nothing;
  - Worktree runs `git` in the task's folder: `rev-parse --git-common-dir`, `show-ref`, `worktree add`.
- **View and folds** live in the copy's `localStorage` (`view`: `"board"` or `"list"`; `folded`: a JSON array of columns). The card and the list row share one helper for the agent footer: wrapping on a card, one right-aligned line in a row.
- **Dragging** is `on_mouse_down` on the card plus `on_mouse_move` / `on_mouse_up` on the columns. A drop sets a timestamp that keeps the card's `on_click` from opening the dialog for 300ms.
- **The columns row** uses `items_stretch()` so the columns fill the height. Cards must not use `line_height`: it's a multiple, not pixels.

**`mods/ws-presets`** (`mod.json`: `{ "place": "none", "title": "Agent presets" }`):
- **Opening it**: the footer's Agent presets row opens it as `openOverlay({ mod: "ws-presets", kind: "dialog", width: 900, height: 640, props: { workspace } })`. The + menu opens its Start dialog as `openOverlay({ mod: "ws-presets", kind: "dialog", width: 560, height: 430, props: { start, workspace } })`.
- **Reading**: it reads the list from `workspaces.presets`, but each file afresh when it's picked, because the shared copy has HTML comments taken out.
- **Writing**: `writeTextFile`, with the text it read as `expected` (null for Create). It then updates `workspaces.presets` itself.
- **Delete** uses the same Trash script as the rest.
- **Start** sets shared `workspaces.launch` (`{ workspace, name, at }`) and closes. The switcher's sidebar copy starts the preset, because a dialog's tasks end when it closes.
- **Inputs**: three `InputState`s and a `TextareaState` are made once in `init` and refilled with `set_value` when another preset is picked. Each field gets the `accent` border while it has focus. A preset is read in a `cx.spawn` after the click, and that task's `cx` must make the redraw. The click's own `cx` is gone by then, and using it leaves the editor blank until something else redraws.

**`mods/ws-chrome`**: Herdr's `workspace-chrome` (0.1.14), cloned for the footer only (`props: { footer: true }`; the brand row keeps Herdr's own). It adds `openOverlay` and "Automations" and "Agent presets" rows above Settings; a row's icon can be a path into another mod. The layout's `sidebar-footer` block uses it and is 125px tall.

**`mods/ws-tabs`** and **`mods/ws-new-menu`**: Herdr's `tabs` and `new-menu` 0.1.14, cloned with `mod.clone`. The changes are listed at the top of each file:
- **ws-tabs**: the + opens `ws-new-menu` instead of `new-menu`, with `height: 0.85` (a share of the window) instead of 512px. A popup is as tall as its content, so `height` is only the most it can take.
- **ws-new-menu**:
  - reads the switcher's `workspaces.presets`, `workspaces.active` and `workspaces.defs`, and lists the presets after the agents with a copy of the switcher's `presetsFor()`;
  - a row's icon is the preset command's program (past `VAR=x`, `env` and `herdr-ws-agent`) matched against `knownAgents()`;
  - a click or number key opens the Start dialog, which asks the switcher's sidebar copy to start it (`workspaces.launch`);
  - its height estimate goes up to 659px instead of 491;
  - it keeps Herdr's shared `new-menu.agents` key, which the switcher and the Presets screen read for icons.

**`mods/ws-spaces`** and **`mods/ws-agents`**: Herdr's `spaces` and `agents` 0.1.14, cloned with `mod.clone`. The changes are described at the top of each file:
- **ws-spaces**:
  - `workspace()` and `inWorkspace()` helpers;
  - `grouped()` filters rows by `workspaces.assigned`, keeping the shown space while it is still being placed;
  - other machines with nothing in the workspace are left out;
  - `emptyWorkspace()` lists the folders;
  - the header `+` runs `space.new {folder: root}`.
- **ws-agents**:
  - `inWorkspace()` takes an agent's workspace from its `space`;
  - `render()` filters the list after `hold()`, so `setAgentOrder` and `agent.next`/`agent.prev` follow the filtered list;
  - the empty text names the workspace.

**What it touches:**
- It reads `~/.herdr/workspaces` and lists the subfolders of each workspace's root.
- It writes `~/.herdr/workspaces/.index`, a new workspace's two files when you make one, and `workspace.jsonc` when you rename one. The board writes task files in `~/.herdr/workspaces/<id>/tasks/`; the Automations screen writes `~/.herdr/workspaces/<id>/automations/`, and an automation with `card: true` writes a task per run.
- It moves a workspace's folder, a task's file or an automation's file to the Trash when you delete it, and only after you confirm.
- Automations watch the folders files automations name, delete the calls `herdr-ws-run` leaves in `~/.herdr/workspaces/.inbox`, and close an automation's run tabs beyond its newest three once their agent isn't working or waiting on you.
- It runs programs:
  - `sh`, to open an editor, move things to the Trash and resolve symlinked folders;
  - `herdr-app do`, for the board's and automations' new tabs and spaces;
  - `rm` (handled calls) and `test` (folders outside home), for automations;
  - `git remote get-url` and `gh api`, for GitHub automations;
  - `git worktree add`, for a task's Worktree;
  - `explorer`, on Windows;
  - your agents, through the launcher, the board's Start and automations.
- The network: only GitHub automations use it, through `gh api` with your login, every 2 minutes per watched repo. Without one, nothing goes over the network.

## Watch out

- `ws-spaces`, `ws-agents`, `ws-tabs`, `ws-new-menu` and `ws-chrome` are copies of Herdr 0.1.14's mods and won't get Herdr's later fixes. On another version, rebuild them from this recipe on top of that version's `spaces`, `agents`, `tabs`, `new-menu` and `workspace-chrome`: the changes are small and listed above.
- The + menu leaves presets out for a space on another machine, because the launcher and the preset files are on this computer.
- With more agents and presets than fit in 85% of the window, the + menu's middle scrolls; New space and the worktree rows stay in view.
- `ctrl-1…9` (`space.select:N`) and `space.next` still count every space. The switcher follows, so they jump between workspaces.
- Workspaces are folders on this computer. A space on another machine only joins a workspace when it's made while that workspace is shown, or with "Move to…".
- Spaces keep their workspace, even after a `cd` elsewhere or when a nested workspace is added later. Use "Move to…".
- `programs.json` runs a quoted command: `~` isn't expanded. Use a name on `PATH` or an absolute path.
- The launcher is `sh`, `awk` and `sed`: macOS and Linux. On Windows the + menu works, but agents don't get the instructions.
- The launcher reads `.index`, which the switcher rewrites while Herdr runs. Config edits made while Herdr is closed reach the launcher on Herdr's next start.
- `--add-dir <root>` lets the agent read and edit the whole workspace, sibling repos included. That's the point of a multi-repo workspace, but it's broader than one repo.
- Codex gets the instructions through `developer_instructions`. The TOML quoting is checked; how a given Codex version weighs those instructions is up to Codex.
- A popup's tasks end when it closes. That's why "New workspace" goes through `workspaces.create` to the sidebar copy, and why "Edit" is a single `exec`.
- `preview.png` is a drawing of the layout with demo names, not a screenshot.
- The board needs `herdr-app` on `PATH` (an installed macOS app makes the `~/.local/bin` link) to learn the terminal a Start made. Without it, Start shows an error toast.
- The brief is the agent's last argument, so it's limited by the system's argument length; very long notes are better as a file the notes link to.
- An agent can break a task's front matter. The card then falls back to the file name for its id and the notes' first line for its title, and its status goes to the first column.
- A task's `terminal` is an address on this machine. After Herdr-core restarts or the terminal ends, the card shows "Agent ended". Start runs a new one, and Worktree reuses the task's branch and folder.
- The board only finds a board tab by the workspace of its space: a board left in a space moved to another workspace isn't found, and a new one is made.
- Boards, Start and Worktree work on this computer's spaces only.
- A first click on a background window only focuses it in some setups, so a chip or button may need a second click when the window wasn't in front.

- Herdr's own Settings screen can't take new sections (Herdr rewrites it), which is why Agent presets is a footer row of its own.
- The model lists are short on purpose: Claude's aliases always mean its latest models, Codex's come from your config, and any other model is typed in. Effort levels a given CLI version doesn't accept fail when the agent starts.
- Mods can't read environment variables, so presets are always read from `~/.config/herdr-core/templates`. A changed `XDG_CONFIG_HOME` isn't followed.
- herdr-core reads front matter values exactly as written, so don't quote a preset's `command`.
- Asked "were you started with an agent?", Claude can take "agent" to mean a helper agent it called, and say no. Ask which preset it is instead.
- An agent started before this line was added doesn't have it. Starting it again does.
- A preset whose command starts with `herdr-ws-agent` also gets the workspace's instructions when an agent starts it with `hc run`. Then the preset's own instructions arrive as its first message, the way hc sends them.
- `herdr-ws-agent --preset` reads a preset's `command:` with `eval`, so `$(…)` in it runs. Presets are your own files; don't start one you didn't write or read.
- A helper reports with `hc send`, which it may not be allowed to run (a reviewer in plan mode, say). The orchestrator then learns it stopped from `hc wait` and reads its screen. To let a preset report, allow it in its command: `--settings '{"permissions":{"allow":["Bash(hc send *)"]}}'`.
- Helpers end when their orchestrator ends (hc's rule), unless it starts them with `--outlive-parent`.
- A helper in a folder Claude hasn't been told to trust stops at the trust question, which Herdr doesn't report as "needs you". The orchestrator sees no progress and should read its screen; answering it is the person's call.

- Automations run inside Herdr, in the switcher: nothing fires while Herdr is closed or while another layout is shown.
- Starting a run shows its tab for a moment before your view comes back. Keys typed in that moment can land in the new tab.
- A schedule missed more than 12 hours ago is skipped, not run late.
- An `agent blocked` automation only hears what Herdr reports as blocked. Claude's folder trust prompt, for one, isn't.
- `herdr-ws-run` takes the workspace's folder name (`ls ~/.herdr/workspaces`), not its display name.
- There's no clickable `herdr://` link yet: it needs a small helper app to register the scheme. `herdr-ws-run` covers apps and scripts on this computer.
- GitHub is asked every 2 minutes rather than told: a new PR can take that long to start its run. Webhooks would be instant, but GitHub can't reach `localhost`, so they'd need a server and a tunnel; `gh webhook forward` is for testing only, one person per repo.
- A GitHub label added after a PR or issue was first seen doesn't count. Comments, reviews, CI and closed or reopened ones aren't events yet.
- GitHub automations need `gh` signed in with access to the repo. A GitHub Enterprise remote isn't recognised as a GitHub repo; write it as `owner/name` only if `gh` is signed in to that host by default.
- The Automations screen's fields take typing only when Herdr's window is in front; the chips work either way.
- `when.js` is in two mods. Change both, or the screen and the runner read `when:` differently; the sync script stops if they differ.

## Done when

- `herdr-app check` passes for `mods/ws-switcher`, `mods/ws-spaces`, `mods/ws-agents`, `mods/ws-board`, `mods/ws-tabs` and `mods/ws-new-menu`, and `herdr-app status` shows no errors with `layout.switch {"name": "workspaces"}`.
- With two workspaces whose roots hold existing spaces, those spaces show under their workspace and the counts in the menu add up to "All spaces".
- Choosing a workspace with no spaces lists its folders in the sidebar, and clicking one makes a space that stays in that workspace.
- `herdr-app do space.select --id <a space in another workspace>` switches the switcher to that workspace.
- With an agent running in workspace A, workspace B's agents list says "No agents in B…", and a blocked agent in A puts the dot on B's switcher row.
- "Move “x” to… → No workspace" moves the space to All spaces only, and it doesn't rejoin by its folder.
- "Rename…" with a new name changes it in the switcher within a second, and `workspace.jsonc` keeps its comments.
- "Delete…" → "Move to Trash" removes the workspace from the menu, puts its folder in the Trash, and its spaces show under the workspace their folder is in (else All spaces). Cancel and Esc change nothing.
- Writing `Use pnpm.` in a workspace's `AGENTS.md`, then running `HERDR_WS_AGENT_DRY=1 herdr-ws-agent claude` in one of its folders, prints `--append-system-prompt` with that text and `--add-dir <root>`. In a folder outside every workspace it prints `claude` alone.
- With a workspace whose root is under `/tmp` (macOS), a space opened in one of its folders joins that workspace, not the shown one.
- The board button opens a "Board" tab showing the workspace's columns; three hand-written task files appear in their columns, sorted high priority first.
- Dragging a card to another column changes its `status:` line and nothing else, and doesn't open the dialog.
- In the dialog, changing only Priority and saving adds or changes just the `priority:` line; an `# inline comment` an agent left on `status:` survives.
- With `"board": { "agent": "echo" }`, Start on a card with `folder: app` opens a tab named after the task in the space at `app`, which prints the brief. The card moves to `doing` and its file gets `terminal:` and `started:`.
- Worktree on a card in a git repo makes `task/<id>-<slug>` and `~/.herdr/worktrees/<repo>/<slug>`, opens a space there that stays in the workspace, and the file gets `worktree:` and `branch:`.
- Board | List switches the view, and the choice survives the mod reloading. In the list, Done starts folded; clicking its header unfolds it, and a row with a live terminal shows "<program> · running" and Go to.
- A workspace preset `agents/x.md` with `command: HERDR_WS_AGENT_DRY=1 claude --permission-mode plan` and a body, started from the + menu in one of the workspace's folders, prints `--append-system-prompt` with the workspace's instructions, then the line naming `x` and its instructions, plus `--add-dir <root>` and `--permission-mode plan`. A preset with `command: echo` prints its body.
- A task with `agent: x` started from the board runs that preset with the task's brief as its first message.
- In the Presets screen, Create on a new workspace preset adds it under "Only in <workspace>" with the file in `agents/`. Changing its instructions and saving keeps any other front matter lines. Delete puts the file in the Trash, and Start opens it as a tab.
- In the Presets screen, picking Model "opus" and Effort "high" on `herdr-ws-agent claude` makes the command `herdr-ws-agent claude --model opus --effort high`; Default takes each flag out again. On a Codex command, Effort sets `-c 'model_reasoning_effort="high"'`.
- The sidebar footer shows Agent presets above Settings, and it opens the Presets screen.
- The workspace menu starts with "New workspace from a folder…" above the workspace list, and has no board, agent, preset or automation rows. On the narrow rail it has "Open <workspace> board" instead of the hidden board button. The tab bar's + lists the shown workspace's presets under "Agent presets", after the installed agents. Three presets fit without scrolling, and a click on one opens the Start dialog. A task typed there arrives as the agent's first message, and Start with no task starts it idle. A test preset with `command: echo` prints its instructions in its new tab.
- Asked which preset it is, a Claude started from the implementer preset answers "implementer" and names its file.
- `herdr-ws-agent --presets` in a workspace with its own `orchestrator` lists it under "Only in this workspace" and marks the global one as replaced. `HERDR_WS_AGENT_DRY=1 herdr-ws-agent --preset reviewer "x"` prints `claude`, the workspace and reviewer instructions, `--permission-mode plan` and `x` last; `--preset nope` and `--preset ../x` fail with a message.
- The orchestrator, given "two helpers with the zz-writer preset write alpha into one/a.txt and beta into two/b.txt", starts `write-alpha` and `write-beta` from `one` and `two`, gets both reports, checks both files itself, reports, and stops and removes both helpers. Asked to leave them running, they show under it in the Agents list (├ └), and it says it left them.
- `herdr-app check` passes for `mods/ws-automations` too, and the footer shows Automations above Agent presets.
- In a test workspace with a preset whose command prints its task (`sh -c 'printf "%s\n" "$1"; sleep 25' sh`):
  - `herdr-ws-run <ws> <link automation> "hello"` makes the workspace's Automations space with a tab that prints the prompt with `{{text}}` filled. The space joins that workspace, and the shown workspace, space and tab stay as they were;
  - a schedule set one minute ahead starts at that minute;
  - a file written in a files automation's folder starts it once (a dotfile doesn't), and with `card: true` a card appears in Doing with `terminal:`;
  - moving that card to Review starts a `task enters review` automation, with the task added to its prompt;
  - a Claude in the workspace finishing starts an `agent done` automation with `{{agent}}` and `{{terminal}}` filled;
  - three `herdr-ws-run` calls at once start three runs, and the oldest run tab beyond three closes.
- In the screen: kind and quick chips change the When line and its preview; Save writes the file; Run now adds a "Started by hand" row with Go to; Create adds `automation-<n>`; Delete (twice) moves it to the Trash.
- With `github <folder> pr opened` (the folder's origin a busy public repo) and `github <owner/name> issue opened by others`, nothing starts on the first look; then each new PR and issue starts its own run in the repo's folder, with `{{number}}`, `{{author}}` and the rest filled. A `github nowhere pr opened` shows "There's no folder nowhere in this workspace, and it isn't owner/name." under its When line.
- With the runner's memory set to "last ticked 21:00" and a `daily 21:30` automation, opening at 21:50 runs it once ("Missed 21:30 while Herdr was closed"); a `daily 08:00` one 13 hours late doesn't run.
