<!--
Herdr's global guide. herdr-ws-agent hands this file to every Claude, Codex and
Antigravity it starts (the + menu, presets, board cards, automations, hc helpers), before the
workspace's own AGENTS.md. Keep it short: every agent pays for it. Details belong
in the skills and in each tool's --help.
-->

# Working in Herdr

You're running inside Herdr, a desktop app for terminals and coding agents. Your terminal's address is `echo $HC_TERMINAL_ID` (empty means you're not in a Herdr terminal). Use the tools below for what they're for; read their help before the first use, not your memory of them.

## Later or on a schedule: automations

When you're asked to do something later, on a schedule, or whenever something happens (a pull request or issue opens, a card enters a column, an agent finishes), set it up as a Herdr automation: `herdr-ws-run --add`. Run `herdr-ws-run --help` first. A run starts a fresh agent with no memory of this conversation, so its prompt says everything: what to check, where, what to do and how to report. When a plain command can tell whether there's anything to do, give it as `--check`, then tell the person they have to allow that check in the Automations screen before it runs. `herdr-ws-run --list` shows what exists; don't make a second one for the same job.

## Helper agents: hc

To hand work to another agent, use the hc skill (or read `hc --skill`, hc's own manual) before your first `hc` command. The short version:

- When you'd hand work to a subagent of your own (Claude Code's Agent tool with Explore, Plan or general-purpose; Codex's or Antigravity's own), start a preset instead. It shows in Herdr's Agents list, where the person can watch it and type to it: `scout` for where something is and how it works in the code, `researcher` for what the docs and the web say, `planner` for a plan written to a file, `implementer` to build one change, `reviewer` to review one. What you can find in a few commands, look up yourself.
- For work with several steps or pieces (a plan, then a build, then a review; changes across repos), don't run the helpers yourself: start the `orchestrator` preset as one helper and hand it the whole task. It knows how to split the work, give helpers their own worktrees, wait for them, check their results and report back. Do it yourself when the person asked you to orchestrate, or when you are the orchestrator.
- List presets with `herdr-ws-agent --presets` and start one as your child: `hc run --bg --keep --name <what-it-does> herdr-ws-agent --preset <preset> "<task>"`. Plain `hc run <name>` doesn't know the workspace's own presets. The helper starts in your folder, so its task names the repo or files it's about. Add `--cwd <repo or worktree>` only for a helper that changes files there (an implementer): Claude first asks the person whether to trust a repo it hasn't been started in, and a helper waits at that question.
- Write your own address literally (for example `t1b`) into the task's report line, never `$HC_TERMINAL_ID`, which means the helper in its own shell.
- Never use `--no-parent` or `--outlive-parent`. Don't poll or sleep: the report arrives in your session as `<hc from="…">…</hc>`.
- Check the files a report names before you rely on it. When you've accepted the work: `hc kill <name>; hc rm <name>`.
- Only touch terminals you started (`hc ls` also lists other sessions). Never run `hc server …`.

## The board and the brief

- Board cards are markdown files in the workspace's `tasks/` folder. If your work is a card's, however it reached you (the card's Start, the person, an orchestrator passing it on), keep the card current, or hand that to whoever holds it: its `status:` line is its column, so set it to `doing` when the work starts and to `review` when it's done and waiting for the person, and keep its notes current. A board with other columns names them under `board` in the workspace's `workspace.jsonc`. A card with `pr:` or `branch:` is watched: failing checks, reviews and conflicts on that pull request are sent to you.
- A workspace's `BRIEF.md` (next to its `AGENTS.md`) says where its work stands. Read it when that helps.

## Always

- Don't open Herdr tabs, panes or helper agents unasked just because the work could run in parallel.
- Never stop processes by a name pattern (`pkill -f`): other agents and Herdr's background runner match more than you expect. Stop what you started, by its id.
- Don't send messages for the person (Slack, email, GitHub comments or reviews). Write a draft to a file and say where it is.
