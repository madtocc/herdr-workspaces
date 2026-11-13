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
on a schedule (once or repeating), when a task enters a board column, when an
agent finishes or needs you, when files change, when a PR or issue is opened on
GitHub, or when another app calls `herdr-ws-run`. Each run is a tab in the
workspace's "Automations" space, and your view stays where it is. You describe a
new one in your own words and Claude drafts it, model included; an agent in a
workspace can set one up itself: "tomorrow at 6, check X and if so do Y".

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
  - **The list** (260px, `chrome`): a "New automation" button (theme `solid`), then a 46px row per automation: a 7px dot (`done` when on, `dim` when off, `blocked` when its `when:` can't be read), the name, the trigger in words under it (11px, `dim`, e.g. "Weekdays at 09:00", "When a task enters Review"), and on the right the next run's time ("09:00", "Tue 09:00", "1 Dec 00:00") or "off", or "working" (`working`) or "needs you" (`blocked`) while its newest run's agent is, then a 26×15 switch (an `accent` track with its knob at the right when on, `input` with the knob at the left when off). "None yet." when empty.
  - **The editor**, a scrolling form (each automation opens scrolled to the top) over a pinned footer:
    - **A new automation** shows only "New automation", the line "Say what it should do and when, in your own words. Claude drafts it, and you read the draft before it's saved." (12.5px, `muted`), a 92px textarea (placeholder "For example: every weekday at 9, list yesterday's merged PRs in api that still need docs"), and a row with "Or fill it in yourself" (11.5px, `dim`) on the left and a "Draft it" button (theme `solid`) on the right, dimmed until something is typed. While Claude drafts, the left of that row is a 13px spinner (`workspace-chrome/spinner.svg`, `working`, one turn per 900ms) and "Claude (sonnet) is drafting it…".
    - **Drafted, filled in by hand, or saved**, the form is:
      - the name (16px semibold), "drafted, not saved" or "unsaved" in `working`, and On / Off chips on the right;
      - one line to change it: a 34px input, "Change it in words: make it hourly, only on Mondays, use opus…", with a "Change it" button beside it (plain). The spinner line shows under it while Claude works;
      - "Check: <note>" in `working` when the draft came with something to check, or "Couldn't draft it: <why>" in `blocked`;
      - **What it does**: the trigger in words (13px, `foreground`), "· next <time>" for a schedule or "· looks every 2 minutes, with your gh login" for GitHub, or why the line can't be read in `blocked`; under it (12px, `muted`) "Starts <agent> on <model>, <effort> effort, in <folder>." with "with a board card each run" when it has one. The model and effort shown are the automation's own, else what its preset's command sets. A preset shows its program in brackets ("implementer (claude)"). An agent that takes neither, given a model or effort, gets a `working` line saying they're left out. A files automation whose folder can't be watched, or a GitHub one whose repo can't be found or read, says why in `working`;
      - **Prompt**: a 150px textarea, then the fill-ins for that kind and, for event kinds, "What set it off is added at the end, unless the prompt uses {{event}} or one of the fill-ins above.";
      - a **Details** row over a top border: a 13px chevron (`chevron-right.svg`, `chevron-down.svg` when open), "Details" (12.5px medium) and "name, when, agent, model, folder" (11.5px, `dim`; no "name" on a saved one). It's folded unless you open it, "Or fill it in yourself" opens it, and Save opens it when it refuses something there. Open, it shows:
        - Name (new ones only; it suggests `automation-<n>`, or the draft's name), Description;
        - **When**: kind chips (Schedule, Board, Agent, Files, GitHub, By hand), the `when:` line (JetBrains Mono), then quick chips for that kind: `every 30m`, `every 1h`, `daily 09:00`, `weekdays 09:00`, `mon 09:00`, `0 9 * * 1-5`, and "once tomorrow 09:00" (`once <tomorrow's date> 09:00`); the board's columns; Finishes / Needs you; the workspace's folders; for GitHub, the workspace's folders that have a GitHub remote, then Pull requests / Issues and "By others only";
        - **Agent** chips: "Board's (<board.agent>)" and the workspace's presets;
        - for an agent that runs Claude, Codex or Pi: **Model** chips ("Default", "Default (<model>)" when the preset sets one, the agent's models as in the Presets screen, and a small "another model, then Enter" field) and **Effort** chips ("Default", or "Default (<level>)", and the agent's levels). The label says "Model: Default is what <preset> sets" for a preset;
        - **Folder** chips: Root ("Its repo's folder" for GitHub) and the workspace's folders;
        - **Each run** chips: "Just its tab" / "A tab and a board card";
      - for a saved one, **Recent runs**: up to four rows with the time, why it ran (and a note for skipped or failed runs), its state (working, needs you, finished, open, closed, skipped, failed), "Stop" (in `blocked`; "Click again to stop" after one click) while it's working, needs you or is a program still open, and "Go to" while its tab is open; then "From another app or a script" and `herdr-ws-run <workspace> <name> "optional text"` in mono;
    - the footer: an error or notice line, Delete (in `blocked`, click twice), the file's path, Run now (saved ones), and Save or Create (Create dimmed until there's a draft or you fill it in).

    With nothing picked, the editor explains what automations do, that New automation asks in your words and Claude drafts it, where runs go, that they run while Herdr is open, and where the files are.
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
  - with the launcher installed and a `claude` or `codex` command, the preset's instructions become system instructions, after the workspace's. The command runs as `herdr-ws-agent --instructions <file> <command>`, and the task, if any, is the first message, passed as `--task` so a restart doesn't send it again;
  - any other agent gets the instructions, then the task, as its first message, as `hc run` does;
  - a leading `herdr-ws-agent` in the command is fine (it's added once), and `VAR=x` assignments go before it;
  - either way, the instructions start with a line naming the preset: `You are the "<name>" agent, started from the Herdr agent preset of that name (<file>). Its instructions:`. That's how the agent knows which preset it is.
- **An agent starting a preset** (an orchestrator starting its helpers): `hc run <name>` only knows herdr-core's templates, so the launcher has `herdr-ws-agent --preset <name> "<task>"`. It takes the workspace's own preset with that name, else the global one, and starts it the way Herdr's UI does. `herdr-ws-agent --presets` lists what the folder's workspace offers: its own presets with their descriptions, then the global ones (a global one the workspace replaces says so). A helper is started as `hc run --bg --keep --name <name> --cwd <folder> herdr-ws-agent --preset <preset> "<task>"`, so it's the caller's child: it shows under it in the Agents list and ends when it does. `--keep` lets a restart bring it back (see After a restart).
- **The orchestrator** (`examples/presets/orchestrator.md`): a Claude preset whose instructions teach it to coordinate through Herdr. It first reads herdr-core's own manual, `hc --skill` (current for the installed hc), and follows it on how hc works; its own instructions add the workspace's ways. It lists presets with `--presets`, starts one helper per piece with the line above (in the right repo, with a worktree each when several change one repo), waits with `hc wait --children`, steers with `hc send` and `hc interrupt`, reads results itself instead of trusting reports, writes its own address (`echo $HC_TERMINAL_ID`) into each helper's report line, hands a helper's permission questions to the person but accepts Claude's folder trust question for a folder of the workspace (its root, its folders, a worktree it made), reads an `error` and fixes or stops the helper, reports to the agent that started it when its task came with `reach=`, never stops hc's server, runs slow commands in terminals of their own, checks the whole and reports, then stops the helpers it's done with. It starts helpers with `--keep`, and knows that a restart brings them back and that a stopped one stays closed. On a board card, it keeps a "## Helpers" list in the card's file. Its command allows `hc` and `herdr-ws-agent --presets` without asking, through `--settings` (`--allowedTools` takes several values and would swallow the task).

**After a restart:**
- **Agents come back where they were.** A reboot, a logout or a crash of herdr-core ends every program. herdr-core then puts a new shell in each kept terminal, with the same tab, folder and address, and never runs the program again. With this package's line in herdr-core's `config.toml` (see Built from), a terminal that ran Claude Code through the launcher gets that Claude instead, resumed with its conversation (`--resume <session>`), its flags, its preset's instructions and the workspace's current ones. It starts from your login shell, as the + menu starts agents, so the shell stays when it ends. Each comes back by itself, all at once, without Herdr being open.
- **What comes back**: Claude started through the launcher in a Herdr terminal: from the + menu, a preset's Start, a card's Start, an automation, or an agent's `hc run --keep … herdr-ws-agent …`. Its first message isn't sent again. A Claude that never got a message starts again, fresh.
- **What stays closed**: an agent you left (`/exit`, Ctrl-D, Ctrl-C twice, or logging out of Claude) stays a shell, and a closed tab ended its terminal, so nothing comes back there. A helper started without `--keep` isn't kept by herdr-core and ends at a restart, as before. Codex and other agents come back as a shell, as before.
- **Helpers** started with `--keep` come back under their orchestrator, with the same addresses, so its conversation still names the right ones. A resumed agent waits at its prompt with the conversation as it was: work it was in the middle of doesn't carry on by itself.
- `herdr-ws-resume --list` shows what comes back, by terminal. `herdr-ws-resume --forget t12` drops one, and `--forget` alone drops the current terminal's.

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
  - `model:` and `effort:` for an agent that runs Claude, Codex or Pi: they replace what the preset's command sets (`--model`, and `--effort` for Claude, `-c model_reasoning_effort="…"` for Codex, `--thinking` for Pi), added at the end of the command. Other agents ignore them;
  - `folder:` where it runs, from the root (or absolute / `~`), by default the root;
  - `card: true` also adds a board card per run;
  - `enabled: false` turns it off: then only Run now and `herdr-ws-run` start it.
- **`when:`**, read the same way by the runner and the screen:
  - `every 30m`, `every 2h`, `every 1d`: an interval of at least a minute, counted from its last run (from when it was first seen, before that);
  - `09:00`, `daily 9:00`, `weekdays 09:00,17:30`, `weekends 10am`, `mon,wed 8:30`, `mon-fri 9:00`, `at 6pm`: days and times, on this computer's clock;
  - `0 9 * * 1-5`: cron's five fields, with `*`, lists, ranges and steps; with both day fields set, either one will do. Common shapes read in words ("Every 30 minutes from 09:00 to 18:30, weekdays", "Weekdays at 09:00", "Every hour at :15"); others read "On the cron schedule <line>";
  - `once 2026-11-12 06:00` (or `once 2026-11-12 at 6am`): one time, on this computer's clock. When its time comes the runner writes `enabled: false` into the file, so it stays as a record and doesn't run again. One that's on with its time passed (missed by more than 12 hours, or written with a past date) says "Its time has passed and it didn't run";
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
- **Missed schedules**: a schedule due while Herdr was closed runs once when Herdr opens, if it was due in the last 12 hours ("Missed 09:00 while Herdr was closed"). The same goes for minutes the Mac slept through with Herdr open: they run once when it wakes ("Missed 06:00 while the Mac was asleep"). Older ones are skipped. An interval that came due while closed runs once.
- **Run tabs**: each automation keeps its newest three run tabs. Older ones close when a new run starts, unless their agent is working or waiting on you.
- **`herdr-ws-run --add`** adds an automation from the command line, for agents above all:
  - `--at TIME` makes a one-time one: "tomorrow 6am", "today 18:30", "6am tomorrow", "in 2 hours", "in 90 minutes", "monday 9am" or "next friday 17:00" (the next one), "2026-11-12 06:00", or just "6am" (the next 6:00). It's written as `once <date> <time>`; a time that has passed or a date that doesn't exist is refused;
  - `--when LINE` writes a repeating `when:` line as given, and needs `--name`. A line that happens once ("tomorrow …", "in …") is sent to `--at`;
  - `--name` (default for `--at`: `once-<date>-<time>`, with `-2`, `-3` when taken; a taken `--name` is refused), `--agent` (a preset of the workspace, a global one, or a program on `PATH`, else refused), `--model` and `--effort` (letters, digits and `._:/@-`, else refused; `--help` tells agents to pick the smallest model that does the job), `--folder` (default: the current folder), `--card`, `--workspace`, `--description` (default: the prompt's first line, up to 80 characters);
  - the prompt is the rest of the words, or `-` for stdin;
  - the workspace is found from the current folder, as the launcher does; outside every workspace it asks for `--workspace`;
  - it writes `description`, `when` (in double quotes), `agent`, `model`, `effort`, `folder` (from the root, else in full), `card`, then the prompt, to a dotfile that it then moves in. It prints when it runs, where, the file, and how to cancel.
- **`herdr-ws-run --off <name>`** writes `enabled: false` into the automation's front matter. **`--on <name>`** takes it out again. A one-time automation whose time has passed isn't turned on without a new time: `--on <name> --at "tomorrow 6am"` rewrites its `when:` too. `--at` is refused for a repeating one. **`--list`** prints each one's workspace, name, `when:` line and "(off)". **`--help`** explains it all for an agent.
- **Agents are told**: Claude and Codex started in a workspace through the launcher get one more line in their instructions: when asked to do something later or on a schedule, set it up with `herdr-ws-run --add`, read `--help` first, and write a prompt that says everything the new agent needs.
- **`herdr-ws-run <workspace> <automation> [text…]`** (or `-` for the text from stdin): `<workspace>` is the folder name in `~/.herdr/workspaces`. It checks the automation's file exists, leaves the call in `~/.herdr/workspaces/.inbox/<time>-<pid>.run`, and says whether Herdr is open. Herdr picks it up within two seconds and deletes the file. A call that waited over an hour (Herdr closed) is dropped and logged.
- **Describe it** (the screen's Draft it and Change it):
  - **Draft it** (or Enter in the box; Shift-Enter is a new line) sends what you typed to Claude, with what it needs to fill every field: the workspace's name, id and root, its folders, which of them are GitHub repos, the board's columns and agent, the presets with their commands and descriptions, the installed agents, the names taken, and the time now. Claude answers with name, description, `when:`, agent, model, effort, folder, card, prompt and a note. Nothing is saved: the draft fills the editor, marked "drafted, not saved", and the typed text clears.
  - **Change it** (or Enter in its line) sends the automation as it stands with what you typed, and Claude changes only that, copying every other field, the prompt included.
  - **What Claude is told**: the `when:` forms (preferring the plain ones to cron), that a GitHub trigger only sees new PRs and issues (so edits, moves and closes need a schedule that checks), to pick the smallest model that does the job (Claude's haiku for checks, syncs and summaries; sonnet for code changes and reviews; opus for hard or long work; fable only when asked), to keep a preset's model when it suits, to use a model or effort you name, and to leave both empty for agents other than Claude, Codex and Pi. The prompt it writes starts the agent fresh: full paths, what to leave alone, a one-line report; it only reads and reports unless you asked for changes, and never pushes, posts, comments, merges, deletes or messages anyone unless you asked for exactly that. Where it can't know something (a project number), it has the agent find it and says so in the note.
  - **Kept to the workspace**: a name is made lowercase with dashes, and `-2`, `-3` when taken (a saved one keeps its name); an agent that isn't a preset or an installed agent, or a folder that isn't one of the workspace's, keeps what was there; a model with other characters, or an effort the agent doesn't take, is left empty. A `when:` line the screen can't read is sent back once with the reason, for another answer.
  - **Failures** show as "Couldn't draft it: <why>" (claude missing, signed out, timed out after 2 minutes, or no answer) and change nothing.
  - Picking another automation while Claude works drops that draft. Closing the dialog ends it.
- **In the screen**:
  - kind chips switch the `when:` line to that kind's first example, and quick chips set it;
  - **Save** rewrites `description`, `when`, `agent`, `model`, `effort`, `folder`, `card` (only when true) and `enabled` (only when false) and the prompt, keeping other front matter lines. It refuses a `when:` it can't read (and opens Details to show it), and fails if the file changed on disk since it was opened;
  - **Create** refuses a name that's taken; **Delete** moves the file to the Trash;
  - **Run now** asks for a save first when there are unsaved edits;
  - **Go to** shows the run's space and tab;
  - **a row's switch** turns that automation on or off at once: it rewrites only the `enabled` line (the text it read as `expected`), without opening it, and the list shows the change straight away. While the open automation has unsaved edits, its own switch asks to save or discard them first. A failed write puts the switch back and says why in a toast;
  - **Stop** (two clicks) closes the run's tab, which ends its agent or program. The row then says "closed".
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

**`mods/ws-switcher/bin/herdr-ws-agent`**: the POSIX `sh` launcher, `herdr-ws-agent [--instructions FILE]... [--task TEXT] <agent> [args...]`. Each `--instructions` file's body (front matter and HTML comments left out) is added after the workspace's instructions, in or out of a workspace, under the line naming the preset (the file's name without `.md`).
- It reads `.index`, finds the workspace holding `pwd -P`, and puts its extra words before the caller's:
  - for Claude Code: `--append-system-prompt <text>` and `--add-dir`;
  - for Codex: `-c developer_instructions="<TOML string>"` and `--add-dir`.
- `awk` drops `<!-- -->` comments and `sed` escapes the text for TOML.
- `--preset NAME [task]`: finds `agents/NAME.md` in the folder's workspace, else `templates/NAME.md`, reads its `command:` with `eval "set -- …"` (as the shell would), exports leading `VAR=x` words, drops a leading `herdr-ws-agent`, and then runs itself again with `--instructions <file>` for Claude and Codex. Any other agent gets the line naming the preset, its body and the task as one last argument. `--presets` prints the list (descriptions from front matter). A name with a `/` or starting with `.` is refused.
- `--task TEXT` is the first message, put last on the agent's command line. Herdr puts a tab's task there itself, so the switcher, the board and the runner pass it as `--task` instead (`withTask()`, after `env` and `VAR=x`), and `--preset` passes its task the same way.
- **Notes for a restart**: for Claude in a herdr-core terminal (`$HC_TERMINAL_ID` and `$HC_TERMINAL_SOCKET` set), it writes `~/.herdr/resume/<core>/<terminal>.cmd` (`<core>` is the socket's name without `.sock`), removing that terminal's old `.session`. The note is the launcher's words, quoted for `eval`, without the prompt and without `--resume`, `-r`, `--session-id`, `--continue`, `-c` and `--fork-session` (and their values). It reads Claude's words the way Claude does: a fixed list of flags takes no value, `--add-dir`, `--allowedTools`, `--mcp-config` and the other variadic ones take every word up to the next flag, any other flag takes the next word, and a word no flag takes is the prompt. In the background it runs `hc ls --json` and removes the notes of terminals that aren't live, never the current one's.
- **The hooks**: it adds a `SessionStart` hook and a `SessionEnd` hook (matcher `prompt_input_exit|logout`), both running `herdr-ws-resume --hook`. They go into the command's own inline `--settings` JSON (as `--settings X` or `--settings=X`, an empty object included), because a second `--settings` replaces the first. A `--settings` file, or settings with their own `"hooks"`, get neither the hooks nor a note. Otherwise it adds `--settings '{"hooks":…}'`. It finds `herdr-ws-resume` beside itself, following its own symlink, else on `PATH`.
- `HERDR_WS_AGENT_DRY=1` prints the command instead of running it, the hooks included, and writes no note.
- To wire it into the + menu, put it on `PATH` (for example `ln -s ~/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-agent ~/.local/bin/`), then add to `programs.json`:
  ```json
  { "programs": { "claude": { "run": ["herdr-ws-agent", "claude"] },
                  "codex":  { "run": ["herdr-ws-agent", "codex", "--no-daemon"] } } }
  ```

**`mods/ws-switcher/bin/herdr-ws-resume`**: POSIX `sh`, the shell herdr-core starts in a terminal.
- **With no arguments** it reads the terminal's note (`$HC_TERMINAL_ID` under the core named by `$HC_TERMINAL_SOCKET`), `eval`s it, and puts the launcher beside it in place of a leading `herdr-ws-agent`. When the `.session` names a transcript that exists, it adds `--resume <session>`; otherwise the command starts fresh. It runs it as Herdr's macOS launcher does, `$SHELL -lic '"$@"; exec "$0" -li' $SHELL …` (fish: `command $argv[2..]; exec $argv[1] -li`; `-ic` and `-i` off macOS; any other shell runs it from `sh`, then that shell). Without a note it runs `$SHELL -l` on macOS and `$SHELL` elsewhere, as herdr-core would.
- **`--hook`** reads Claude's hook input on stdin, with `sed` (its fields are flat strings), and prints nothing. It acts only where the terminal has a note, and skips input with an `agent_id`. `SessionStart` (startup, resume, clear, compact, fork) writes `<terminal>.session` (the id, then the transcript path) through a `.tmp` file. `SessionEnd` with `prompt_input_exit` or `logout` removes the note and the `.session`.
- **`--list`** prints `<core>/<terminal>`, the session (or `fresh`) and the note. **`--forget [terminal]`** removes one terminal's files, by default the current one's.
- **herdr-core's `~/.config/herdr-core/config.toml`** gets the line that makes it the shell for new terminals and lost ones. It falls back to the usual login shell when the script isn't there:
  ```toml
  shell = ["/bin/sh", "-c", "r=\"$HOME/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-resume\"; [ -x \"$r\" ] && exec \"$r\"; exec \"${SHELL:-/bin/sh}\" -l"]
  ```

**`mods/ws-switcher/automations.js`**: the runner.
- **Reads** every workspace's `automations/*.md`, with the board's front matter rules. Its `tasks/` too, for workspaces that have a board automation. It publishes `workspaces.automations` (`{ <workspace>: [{ name, file, description, when, trigger, summary, agent, model, effort, folder, card, enabled, body, error, next, warning }] }`) and `workspaces.automation.runs` (newest first: `{ id, ws, name, at, why, status, note, terminal, tab, space, card }`).
- **Remembers** in the switcher copy's `localStorage` (`automations`): when each last ran, when an interval was first seen, when Herdr last ticked (`seen`, every minute, for missed schedules), and the runs.
- **Catching up**: `catchUp(from, now, reason)` looks at each minute from `from` (at most 12 hours back) up to this one and queues each schedule that was due and hasn't run since. It runs at load (from `seen`) and on any tick that finds more than one minute has passed since the last (the timer stopped while the Mac slept).
- **One-time schedules**: `fire()` on a `once` automation's turn calls `turnOff()`, which marks the listed copy off at once and writes `enabled: false` into its file (read again, `writeTextFile` with `expected`, three tries).
- **Schedules** are checked once a minute against that minute; intervals every tick.
- **Agents**: each tick compares `agents()` statuses with the last tick's. A run is recognised by its terminal and its tab together, because a terminal's address can be used again later.
- **Board**: on a change under `tasks/`, it reads the tasks again and compares statuses.
- **Files**: one `watchFolder` per folder a files automation names; a watch that fails is reported on that automation.
- **GitHub**: each github automation's repo is found once (`git -C <folder> remote get-url origin`, else `owner/name`), and every 2 minutes `gh api` lists each watched repo's newest 30 issues and PRs. Your login (`gh api user`) is asked once, for "by others". The highest number seen per repo is kept in `localStorage` (`github`).
- **Outside calls**: on a change under `.inbox` and every 2s, it reads the `.run` files (workspace, automation, time in ms, then the text) and deletes them with `rm`.
- **Starting** goes through the switcher's `presetLaunch()` (else `knownAgents()`), then `withKnobs(argv, model, effort)` from `knobs.js`, then the switcher's `withTask()`, then `herdr-app do tab.new` (or `space.new { name: "Automations" }` the first time) through `exec`, then `space.select` / `tab.select` back to the `focused()` space and tab. Starts of one automation are queued, one after another. `fs` only reads under home, so whether a folder or file exists is asked of `test -e` when it's elsewhere.
- **Board helpers** (`boardOf`, front matter, `nextId`, `brief`, `folderPath`) are copies of `ws-board`'s, because mods can't import across folders.

**`mods/ws-switcher/when.js`**: the `when:` reader (`parseWhen`, `due`, `nextAt` up to 32 days ahead, `describe`, `shortTime`). A `once` line becomes `{ kind: "once", at }` (local time, in ms); a date that doesn't exist (2026-02-30) is an error. `describe` puts a cron line in words when its day of month and month are `*` and its minutes are one value or an even step from 0 (`*/30`), over consecutive hours or all of them; one minute at up to four hours reads like a days-and-times line. `mods/ws-automations/when.js` is the same file; `scripts/sync-from-home.sh` stops when they differ.

**`mods/ws-switcher/knobs.js`**: `KNOBS` (per program: its model flags, the models to offer, its effort flag or Codex's config key, and the levels), `words` (a shell line as `sh` reads it), `programOf(argv)` (past `env`, `VAR=x`, and `herdr-ws-agent` with its `--instructions FILE`), `flagValue`, `configValue`, `knobsIn(argv)` (the model and effort a command sets) and `withKnobs(argv, model, effort)` (the flag taken out wherever it was, then added at the end; an unknown program is left alone). `mods/ws-automations/knobs.js` is the same file; the sync script stops when they differ. The Presets screen keeps its own copy of the table.

**`mods/ws-switcher/bin/herdr-ws-run`**: POSIX `sh`. It writes the call to `<name>.tmp`, then moves it to `.run`, so the runner never reads half of one. `herdr-app status` tells it whether Herdr is open. For `--add`, dates come from BSD `date` (`-v`, `-r`, `-j -f`) with GNU `date -d` as the fallback, a date is checked by reading it back, and "later" compares `YYYY-MM-DD HH:MM` strings with `expr`. The workspace lookup is a copy of the launcher's. `bin/herdr-ws-agent` adds its line to the instructions only inside a workspace and only when `herdr-ws-run` is on `PATH`.

**`mods/ws-automations`** (`mod.json`: `{ "place": "none", "title": "Automations" }`, plus `automations.svg`, `when.js` and `knobs.js`): the screen, opened as `openOverlay({ mod: "ws-automations", kind: "dialog", width: 940, height: 680, props: { workspace } })` by the footer row. It reads the list and runs from shared state and each file afresh when it's picked, writes with `writeTextFile` (the text it read as `expected`, null for Create), updates `workspaces.automations` itself until the runner confirms, and sets `workspaces.automation.run` for Run now. Like the Presets screen, it makes its inputs once in `init` and redraws with the reading task's own `cx`. A placeholder can't change after `TextareaState.new`, so the Describe box (a `TextareaState`) and the change line (an `InputState`) are two states; both `submit` on Enter, and the box's Shift-Enter (`e.shift`) is a new line. The installed agents come from shared `new-menu.agents` (`[""]`, those `installed` with a `run`), and Codex's models from `~/.codex/config.toml`.
- **The drafter** is one `exec` from the dialog: `claude -p <request> --model sonnet --system-prompt <GUIDE> --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --disable-slash-commands --output-format json --json-schema <SCHEMA>`, in `/tmp`, with a 120s timeout. No tools, MCP servers, settings files (so no hooks), slash commands or saved session. `SCHEMA` asks for every field (strings, `card` a boolean). The answer is one object or a list of messages; the screen takes the `result` message's `structured_output`, else parses its `result` text, and turns `is_error` into the failure line. `DRAFT_MODEL`, `DRAFT_TIMEOUT`, `GUIDE` and `SCHEMA` are constants at the top of `main.js`.

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
- It writes `~/.herdr/workspaces/.index`, a new workspace's two files when you make one, and `workspace.jsonc` when you rename one. The board writes task files in `~/.herdr/workspaces/<id>/tasks/`; the Automations screen and `herdr-ws-run --add` / `--off` / `--on` write `~/.herdr/workspaces/<id>/automations/`, the runner writes `enabled: false` into a one-time automation once it has run, and an automation with `card: true` writes a task per run.
- It moves a workspace's folder, a task's file or an automation's file to the Trash when you delete it, and only after you confirm.
- For restarts, the launcher writes and removes notes in `~/.herdr/resume/` and runs `hc ls`. It gives Claude two hooks through `--settings` that run `herdr-ws-resume --hook`. You add a `shell` line to `~/.config/herdr-core/config.toml`, after which every new terminal starts through `herdr-ws-resume`.
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

- Only Claude comes back after a restart. Codex has no hook that tells the launcher its session, so a Codex tab comes back as a shell. Other agents run unchanged.
- Agents started before the launcher took notes don't come back. Neither do helpers an agent started without `--keep`: `hc keep <terminal>` keeps one that's running.
- A preset whose own `--settings` is a file, or has hooks of its own, doesn't come back. Put its settings inline instead.
- The note leaves out the prompt by reading Claude's flags from a fixed list. A new flag that takes no value, placed right before the prompt, would keep the prompt in the note, and it would be sent again on resume. Add such a flag to `bare` in the launcher.
- The `shell` line starts every new terminal through `/bin/sh` and the script, which then runs your login shell. Removing the line puts herdr-core's own shell back. If the script is missing, the line falls back to that shell.
- A terminal whose agent crashed instead of being left comes back with that agent after the next restart. `herdr-ws-resume --forget <terminal>` stops that.
- Each agent brought back starts at once, all together, with Claude's own startup cost each.
- A helper in a folder Claude hasn't been told to trust stops at the trust question, which Herdr doesn't report as "needs you". The orchestrator reads its screen and accepts it for a folder of the workspace, and asks you for any other folder. Accepting it is remembered in Claude's own settings for that folder.
- A helper's report line must carry the orchestrator's address written out (`hc send t12 …`). `$HC_TERMINAL_ID` in a helper's task, escaped so it isn't expanded on the way, becomes the helper's own address, and its reports go to itself.

- Automations run inside Herdr, in the switcher: nothing fires while Herdr is closed or while another layout is shown.
- Starting a run shows its tab for a moment before your view comes back. Keys typed in that moment can land in the new tab.
- A schedule missed more than 12 hours ago is skipped, not run late. A one-time one then stays on and says its time has passed.
- One-time and repeating schedules need Herdr open and the Mac awake, or waking within 12 hours. A Mac that's off or asleep at 6:00 runs the job when it wakes, not at 6:00.
- An agent that can run `herdr-ws-run` can leave work for later agents, which then run with their own permissions and nobody watching. In Claude's auto mode it may do this without asking. The run tabs and the Automations screen show what was added; `herdr-ws-run --list` lists it all.
- `herdr-ws-run --add --when` doesn't check the line itself (it's `sh`); Herdr reads it within a second and the Automations screen shows a line it can't read. `--at` is checked.
- `--at "monday 9am"` means the next Monday at 9:00 (today, if it's Monday before 9). `--when "monday 9am"` means every Monday.
- An `agent blocked` automation only hears what Herdr reports as blocked. Claude's folder trust prompt, for one, isn't.
- `herdr-ws-run` takes the workspace's folder name (`ls ~/.herdr/workspaces`), not its display name.
- There's no clickable `herdr://` link yet: it needs a small helper app to register the scheme. `herdr-ws-run` covers apps and scripts on this computer.
- GitHub is asked every 2 minutes rather than told: a new PR can take that long to start its run. Webhooks would be instant, but GitHub can't reach `localhost`, so they'd need a server and a tunnel; `gh webhook forward` is for testing only, one person per repo.
- A GitHub label added after a PR or issue was first seen doesn't count. Comments, reviews, CI and closed or reopened ones aren't events yet.
- GitHub automations need `gh` signed in with access to the repo. A GitHub Enterprise remote isn't recognised as a GitHub repo; write it as `owner/name` only if `gh` is signed in to that host by default.
- The Automations screen's fields take typing only when Herdr's window is in front; the chips work either way.
- `when.js` is in two mods. Change both, or the screen and the runner read `when:` differently; the sync script stops if they differ. The same goes for `knobs.js`.
- Draft it and Change it need Claude Code (`claude`) on the `PATH` Herdr's `exec` sees, signed in. Each draft is a short Sonnet call on your Claude account: about 5 to 15 seconds and a couple of US cents.
- A draft is a guess. It can't look anything up, so it may name a path, repo or project that's wrong, and it only knows the folders, repos and presets the screen sends it. Read the prompt and the "Check:" line before Create. A prompt that tells the agent to find something (a project number, its field names) costs the first run a few extra steps.
- Claude's draft is held to this workspace's folders, presets and installed agents, but the prompt is free text: an ask to "push" or "post" makes a prompt that does. Nothing runs until you save it and its trigger fires.
- Herdr in the background doesn't redraw: a draft that finishes while you're in another app shows when you click back.
- `model:` replaces the preset's model but keeps the rest of its command. A model or effort the agent's CLI doesn't know fails when the run starts, in its tab.
- Agents other than Claude, Codex and Pi ignore `model:` and `effort:`; the screen says so when one is set.

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
- In the Automations screen, New automation shows only the Describe box. Typing "every weekday at 9 and 5, summarise today's changes in docs, use a cheap model" and pressing Enter shows the spinner, then a draft named like `docs-changes-today`, "drafted, not saved", "Weekdays at 09:00 and 17:00", "Starts claude on haiku", and a prompt with full paths. Create writes `when`, `model: haiku` and the prompt.
- On a saved automation with `effort: low` and the prompt "Say hi.", "run it every weekday at 8am, and use sonnet" in the change line gives "Weekdays at 08:00", "Starts claude on sonnet, low effort", and the prompt is still "Say hi.". Save writes `model: sonnet`, and Run now starts `claude … --model sonnet --effort low Say hi.` (`ps` shows it).
- A draft asking for a GitHub trigger on a folder with no GitHub remote comes with a "Check:" line saying so. With `claude` off the `PATH`, Draft it says "Couldn't draft it: …" and changes nothing.
- `describe(parseWhen("*/30 9-18 * * 1-5"))` is "Every 30 minutes from 09:00 to 18:30, weekdays"; `0 9 * * 1-5` is "Weekdays at 09:00"; `0 9 1 * *` stays "On the cron schedule 0 9 1 * *".
- `herdr-ws-run --add --when link --name t --model haiku --effort low "x"` writes `model: haiku` and `effort: low` and says "It starts the default agent (haiku, low effort)"; `--model "a b"` is refused.
- In the Automations screen, a row's switch turns that automation off and back on, writing and removing `enabled: false` without opening it. A run of a program (a printing preset) shows "open" with Stop and Go to; Stop twice ends it and the row says "closed". An orchestrator run shows "working" in its row while it works.
- `herdr-ws-run --off job` then `--on job` takes the line out again; `--on job --at "tomorrow 7am"` rewrites a one-time job's `when:`; `--on` on a one-time job whose time passed asks for `--at`; `--on rep --at 6am` on a repeating one is refused.
- The orchestrator, started as an automation and asked for two zz-writer helpers (alpha into `one/a.txt` under the root, beta into `b.txt` in a workspace folder outside the root that Claude hasn't trusted), runs `hc --skill` and `echo $HC_TERMINAL_ID` first, writes its address into both report lines, accepts the trust question for the second helper, gets both reports, checks both files, and stops and removes both helpers.
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
- From a workspace folder, `herdr-ws-run --add --at` with "tomorrow 6am", "6am tomorrow", "in 90 minutes", "monday 9am", "next friday 17:00", "2026-11-12 06:00" and "6am" writes `once` lines for the right times, and Herdr lists each as "Once, <day> <date> at <time>" with that next time. "2026-02-30 06:00", "banana 6am", "13pm" and "tomorrow" (no time) are refused; a past time says it has passed.
- `--add` twice for the same time names the second `-2`; a taken `--name` is refused; `--when "tomorrow 6am"` says to use `--at`; `--when` without `--name`, no prompt, no time, both `--at` and `--when`, an unknown `--agent`, a name with `/`, and a folder outside every workspace without `--workspace` all fail with a message. `--off` adds `enabled: false` and `--list` shows "(off)".
- A one-time job due in a minute, with the printing preset, starts in that minute in the Automations space, its file then has `enabled: false`, the screen shows it Off with no next time, and your view stays where it was.
- A Claude started in the workspace through the launcher, asked "In 2 minutes, an agent should reply with just the word PONG. Set that up now", reads `herdr-ws-run --help`, adds a one-time automation with a prompt that stands on its own, and at that minute a new agent replies "PONG". The automation is then off.
- On a separate core (`HC_SESSION=wsr` with its own `XDG_CONFIG_HOME` holding the `shell` line, and without the `CLAUDE*` and `ANTHROPIC*` variables of a Claude that runs the test), `hc run --bg --keep herdr-ws-agent claude --model haiku` writes `<terminal>.cmd` and `.session` under `~/.herdr/resume/wsr/`. After one message, killing that core's holder (`kill -9`, the pid from `hc server status`) brings the terminal back as the same Claude, with the message and its answer on screen. `/exit` then removes both files and leaves the shell, and the next kill gives a plain shell. A `--preset` helper with a task comes back with that task in its transcript once. A Claude that never got a message comes back fresh. A new plain terminal is your login shell.
- `HERDR_WS_AGENT_DRY=1` in a Herdr terminal: `--task "x"` puts `x` last; `--settings '{"permissions":{…}}'` (and `--settings={…}`, `{}`) stays one `--settings`, with valid JSON holding `hooks` and the rest; a settings file or one with `"hooks"` gets no hooks; outside a Herdr terminal there's no `--settings`. The note for `claude --model m --effort high "Read x"`, `claude --dangerously-skip-permissions "task"` and `claude --add-dir a b --allowedTools "Bash(hc *)" Edit -- "y"` keeps every flag and value and drops the prompt; `-r id`, `--session-id id`, `--continue` and `--fork-session` are dropped.
- `herdr-ws-resume --hook` with a `SessionStart` input writes the id and transcript; one with `agent_id` changes nothing; `SessionEnd` with `other` or `clear` keeps the files, and with `prompt_input_exit` removes them. It prints nothing.
- With a stubbed `herdr` module, a runner whose last tick was 20 minutes ago queues a one-time job due in that gap once ("Missed … while the Mac was asleep"), runs a later one in its own minute, and after a 13-hour gap runs nothing.
- With the runner's memory set to "last ticked 21:00" and a `daily 21:30` automation, opening at 21:50 runs it once ("Missed 21:30 while Herdr was closed"); a `daily 08:00` one 13 hours late doesn't run.
