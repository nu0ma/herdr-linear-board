# Linear board for Herdr

A [Herdr](https://herdr.dev) mod that shows the Linear issues assigned to you as a board, and starts
a coding agent on one in a fresh git worktree.

![The Linear board with issues in state columns](preview.png)

- One column per workflow state, most urgent issues first.
- Filter by project with the buttons on top, or by id and title. The chosen project is remembered.
- Click a card to open the issue in your browser.
- Press `Agent` on a card, pick an agent, a model and a reasoning level, and a new space starts on
  Linear's suggested branch with the issue as the agent's task.

It needs no Linear API key: issues come from the Linear MCP through Claude Code.

## Requirements

- The `claude` CLI, signed in, with the claude.ai Linear connector. Check it with
  `claude -p "List my Linear issues"`.
- Each sync costs one short `haiku` run on your Claude plan. The board keeps a cache and syncs at
  most every 30 minutes while open, or when you press `Refresh`.

## Install

Tell your coding agent:

```
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/nu0ma/herdr-linear-board
```

Or by hand:

```sh
git clone https://github.com/nu0ma/herdr-linear-board && cd herdr-linear-board
cp -R mods/linear-board mods/linear-board-agent ~/.config/herdr-app/mods/
```

Then add `"ctrl-shift-y": "mod.open:linear-board"` to the `global` section of
`~/.config/herdr-app/keys.json`.

## Map teams to repos

`Agent` works from the folder of the space you're in, which must be inside a git repo. To make a
team always use one repo, create `~/.config/herdr-app/linear-board.json`:

```json
{ "repos": { "ENG": "~/dev/app", "OPS": "~/dev/infra" } }
```

## What it touches

- Network: `claude -p` reaches Linear through its connector, and `git fetch` runs when an agent
  starts.
- Programs: `claude`, `sh`, `git`, the agents' CLIs (to list models) and your system's URL opener.
- Files: reads `~/.config/herdr-app/linear-board.json`; writes
  `~/.config/herdr-app/linear-board-issues.json` and the keys `linear-board.*` and
  `linear-board-agent.*` in Herdr's shared state; creates worktrees under `~/.herdr/worktrees`.
- The agent's first message tells it to read the issue, push and open a PR. Issues are written by
  whoever filed them, and the agent runs with whatever permissions its own config gives it.

## Develop

```sh
node --test
herdr-app check mods/linear-board && herdr-app check mods/linear-board-agent
```

[`RECIPE.md`](RECIPE.md) is the full brief: everything an agent needs to rebuild the mod from an
empty folder.

## License

[MIT](LICENSE). Built from [dantech99/herdr-linear](https://github.com/dantech99/herdr-linear) (MIT).
The agent dialog comes from there and is adapted from `issue-agent` in
[obrunogonzaga/herdr-mods](https://github.com/obrunogonzaga/herdr-mods) (MIT).
