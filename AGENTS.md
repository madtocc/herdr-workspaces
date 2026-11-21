# Working on Workspaces

Instructions for an agent changing this package. `RECIPE.md` is what it is and
how it behaves; this file is how to change it without breaking what others
rely on. Read Herdr's own guide, `~/.config/herdr-app/AGENTS.md`, before
touching a mod or the layout.

## Where things live

- **The live files** are in your Herdr home, `~/.config/herdr-app/` (`layouts/workspaces.json`, `mods/ws-*`). Herdr reloads them within a second. Edit those.
- **This repo** is the package for sharing: `RECIPE.md`, `README.md`, `CHANGELOG.md`, the picture, the scripts, and copies of the live files that `scripts/sync-from-home.sh` makes. Don't edit the copies under `layouts/` and `mods/` here; edit the live ones and sync.
- **A person's own data** lives in `~/.herdr/` (workspaces, tasks, automations, presets, runner state). It's personal: never copy any of it into this repo.

## Each change

1. Edit the live files. Run `herdr-app check ~/.config/herdr-app/mods/<mod>` for each changed mod; `herdr-app status` must show no errors. Try it in the sandbox (below).
2. Update `RECIPE.md` in the same change: always How it behaves, Watch out and Done when; What you see when the look changes; Built from when the pieces change. Update the README's "What it touches" when a mod reads, writes or runs something new, or reaches the network.
3. Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything a person would notice, in Herdr's format: `### New` or `### Fixed`, then `- **Headline.** detail`. Say what an existing install must do by hand (copy a new mod folder, link a new script). A new mod also changes the README's count of folders to copy.
4. Redraw the picture when the look it shows changes (below).
5. Run `scripts/sync-from-home.sh`. A new mod first needs adding to the list in that script, and a file copied between mods to its checks.
6. Check the package for personal paths and names (`/Users/`, `/home/`, real workspace or client names, emails) before committing.
7. Commit, push and release only when the person asks.

## The picture

`preview.png` (in the README and RECIPE) is rendered from the drawing `mods/ws-switcher/preview.svg`, which is also the picture Herdr's layout settings show. It's a drawing with demo names, never a screenshot: a screenshot would show someone's real workspaces, folders and agents. The same goes for the pictures in `previews/`.

- **Redraw it** when anything it shows changes: the sidebar (switcher, board button, spaces, agents, footer rows), the switcher menu (its rows, their order and icons), the tab bar, a pane's header or the status bar. Check it against RECIPE's What you see after each such change.
- **Edit the live drawing** (`~/.config/herdr-app/mods/ws-switcher/preview.svg`), sync, then run `scripts/render-preview.sh` and look at `preview.png`. `release.sh` refuses a release where a drawing changed and its picture didn't.
- **Icons** are the mods' own SVGs inlined (`<g transform="translate(x y) scale(0.583)">` with their paths for 14px), so the drawing stands alone.
- **Demo names**: workspaces Acme (blue `#5b8def`), Globex (orange `#e3814f`), Initech (green `#3fae6a`); spaces and folders `api`, `web`, `docs`, `infra`, `design-system`; paths under `~/work/acme/`. Reuse them in any new picture so they agree.
- **Each screen has its own drawing** beside its mod, rendered into `previews/` by the same script: `mods/ws-board/preview.svg` (the task board, `previews/board.png`), `mods/ws-board/preview-github.svg` (its GitHub view, `previews/github.png`), `mods/ws-worktrees/preview.svg` (`previews/worktrees.png`), `mods/ws-history/preview.svg` (`previews/history.png`), `mods/ws-automations/preview.svg` (`previews/automations.png`) and `mods/ws-agents/preview.svg` (the Agents list's right-click menu, `previews/agent-menu.png`). They share the first drawing's sidebar, colors and demo data (cards ACM-1 to ACM-8, GitHub items #200 to #211, pull requests #12, #27 and #31), so a card shown in one agrees with the others. Redraw one when its screen's look changes, and check it against RECIPE's What you see.
- **A new screen** worth showing gets a drawing beside its mod, a line in the lists in `render-preview.sh` and `release.sh`, and a section with its picture in the README's "What you get".

## Shared across mods

A mod can't import from another mod's folder, so some things are copied. Change every copy together.

- **Copied files**, checked by the sync script, which refuses when copies differ: `when.js`, `knobs.js`, `check.js` in `ws-switcher` and `ws-automations`, and `knobs.js` also in `ws-presets`; `treescripts.js` in `ws-worktrees` and `ws-board`; `ghfacts.js` in `ws-switcher` and `ws-board`; `hidefacts.js` in `ws-new-menu` and `ws-presets`.
- **Mod commands**: Herdr hands `<mod>.<anything>` to that mod's shown copies' `nextCommand()`, so a toast's `action` or a key can reach the switcher's sidebar copy (`ws-switcher.scratch-new`, `ws-switcher.scratch-keep/<folder>`, `ws-switcher.automation/<workspace>/<name>`). Check anything taken from the command text before using it in a path. Herdr refuses a mod's command while none of its copies is shown (a hidden sidebar unloads the switcher), so a toast action that must still do something from a desktop notification carries an `or`: the command `herdr-ws-notify --or` runs when the first is refused.
- **Avatar colors**: the `MARK` table (`ansi1`…`ansi6` to one hex color each) is the same in every mod that draws a workspace or space mark (`ws-switcher`, `ws-spaces`, `ws-board`, `ws-worktrees`, `ws-history`) and in the drawing.
- **Shared state**: mods talk through Herdr's shared keys `workspaces.*`. The list and what each holds is at the top of `mods/ws-switcher/main.js`; add a new key there. A screen or popup asks the sidebar copy of the switcher to do work by setting a key to `{ …, at: Date.now() }`, because a popup's or dialog's tasks end when it closes.
- **Config formats**: a workspace is `~/.herdr/workspaces/<id>/workspace.jsonc` plus `AGENTS.md`; presets are herdr-core templates (front matter `description` and `command`, the body is the instructions); automations and tasks are markdown with front matter. Build on these instead of inventing new files. `defs.js` loads workspaces and presets for both the app and the background runner.
- **The background runner** runs `automations.js`, `prs.js`, `ghboard.js` and `defs.js` under Node with stand-ins for the `herdr` module (`runner/herdr.js`). Code in those files may only use what the stand-ins provide.
- **Copies of Herdr's own mods** (`ws-spaces`, `ws-agents`, `ws-tabs`, `ws-new-menu`, `ws-chrome`, `ws-toast`, `ws-status`) are based on a stated Herdr version. Note every change at the top of the copy and in RECIPE's Built from, so they can be rebuilt on a newer Herdr.

## Testing

- **The sandbox**: `scripts/sandbox.sh up` is a second Herdr with its own core, home and demo workspaces (Acme, Blog) under `/tmp/herdr-ws-sandbox`, running copies of the live mods; `sync`, `app …`, `hc …` and `down`. Use it for screens and anything that opens a dialog. Its window does appear on the screen: say so before opening it, and take it `down` after.
- **Reading state**: `herdr-app status` (shown space, overlays, errors), `herdr-app shot file.png` (the last rendered frame), and `shared.json` in the Herdr home for what mods published. In the sandbox, `sandbox.sh app status` and its own `shared.json`.
- **Driving it**: `herdr-app do <command> '<json>'` (`herdr-app commands` lists them; `space.close` needs `"confirmed": true`). A stand-in agent is a script that prints `ESC ] 7501 ; state=working:app=x ESC \` (then `state=done`).
- **Unit checks**: `facts.js` (worktrees), `prfacts.js` (pull requests), `ghfacts.js` (GitHub boards), `histfacts.js` (History), `ws-agents/statfacts.js` (the Agents list's numbers), `ws-agents/menufacts.js` (its right-click menu), `ws-new-menu/hidefacts.js` (which agents the + menu shows), `ws-status/usagefacts.js` (the status bar's plan usage), `ws-switcher/knobs.js` (each agent's model and effort flags, its model list parsers and the agent switch in a command), `ws-switcher/arrange.js` (the menu's groups and order) and `ws-tabs/fit.js` (the side panel's width) have no imports, so `node` can test them directly.
- **Quirks**: an edited mod may only reload on the next draw, so the first click after an edit can run the old code. `mod.open` shows a dialog only about 500px wide. A mod's `fs` only reads under home. A window behind others doesn't redraw, so wait and check `status` before trusting a `shot`.
- **Never stop processes by a name pattern** (`pkill -f`): a person's agents and the background runner match more than you expect. Stop what you started, by its id.

## Releases

`CHANGELOG.md` is what people read to update; `VERSION` (copied into `mods/ws-switcher/VERSION`) says which version a copy is. The middle number is for anything new, the last for fixes only.

- `scripts/release.sh <version>` turns `## [Unreleased]` into that version, writes `VERSION`, commits and tags. `--publish` pushes and makes the GitHub release from those notes; people watching the repo's releases are notified.
- A release is one coherent thing. When unrelated work is pending (another feature half-done), release the finished part alone and leave the rest under Unreleased.
