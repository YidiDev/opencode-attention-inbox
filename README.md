# opencode-session-history

A CLI plugin for [OpenCode V2](https://opencode.ai/v2/docs/) that adds a **Session History** panel to the sidebar. Click a previous session to resume it — in the same tab if it's already open, in a new tab otherwise.

## Features

- Sidebar panel that lists sessions across every project, newest-first (or
  scoped to the current project with `showAllProjects: false`).
- Also shown on the home screen (before any session is open) as a right-hand
  panel, width permitting — the CLI's own sidebar only exists inside a session.
- Search filter by title, id, project, or directory. Click the field to focus
  it (OpenCode does not focus plugin content automatically); `escape` clears
  the query, then blurs back to the prompt.
- Click-to-resume:
  - If the session is already open in a tab → focus that tab.
  - Otherwise → open a new tab and focus it.
  - When session tabs are disabled → falls back to `router.navigate({ type: "session" })`.
- Sessions whose working directory is gone on the server are dimmed and marked
  with a red `✗ missing`. Clicking one warns first (a short, dismissible toast
  that never navigates); clicking it again opens it anyway. This is distinct
  from a *deleted* session (the record itself), which never appears in the list.
- Subscribes to `session.created` / `session.updated` / `session.deleted` for live refresh.

## Installation

Requires **OpenCode V2**.

### From GitHub

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:ypxcs/opencode-session-history"]
}
```

Or with the CLI:

```sh
opencode plugin add github:ypxcs/opencode-session-history
```

Pin a revision with `#<commit>` (or `#main`) for reproducibility.

The CLI loads the sidebar panel automatically from the package's `./tui` export — you do not need to add it to `cli.json`.

> **Known issue:** the GitHub install currently renders only the current
> session and hides the built-in sidebar context info. Use a local checkout
> path in the meantime. See [Known issue: GitHub
> install](#known-issue-github-install-renders-only-the-current-session).

### From npm

> Not published yet. This section is ready for when the package is on the
> registry; until then use the GitHub install above.

```sh
opencode plugin add opencode-session-history
```

Or add it to `opencode.jsonc` (project or `~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-session-history",
      "options": {
        "limit": 100,
        "showMetrics": true,
        "showAllProjects": true
      }
    }
  ]
}
```

### As a project-local plugin

1. Copy this directory to `.opencode/plugins/session-history/` in your project (V2 discovers `index.ts` + `tui.ts` package directories there automatically).
2. Or reference it explicitly:

   ```jsonc
   {
     "plugins": [
       {
         "package": "./src",
         "options": {
           "limit": 100,
           "showMetrics": true,
           "showAllProjects": true
         }
       }
     ]
   }
   ```

### Options

| Option             | Type      | Default | Description                                                     |
| ------------------ | --------- | ------- | --------------------------------------------------------------- |
| `limit`            | `number`  | `100`   | Maximum number of rows shown.                                   |
| `showMetrics`      | `boolean` | `true`  | Show "Xm ago · $Y.YY" line under the title.                    |
| `showAllProjects`  | `boolean` | `true`  | When true, list sessions from every project, not just the current one. When false, only the current project's sessions are shown. |

## Requirements

- OpenCode **V2** (`@opencode/plugin` v2.x).
- For "open in new tab" behavior, enable session tabs:
  ```jsonc
  // ~/.config/opencode/cli.json
  { "tabs": { "mode": "on" } }
  ```
  When tabs are `auto` / `off`, the click handler uses `router.navigate` instead, which replaces the current session view.

## Known issue: GitHub install renders only the current session

When the plugin is installed as a package — for example
`github:ypxcs/opencode-session-history` — the Session History panel lists
only the current session (the header reads `1 session`), and the built-in
sidebar context/usage info disappears.

The plugin's data layer still works. With temporary logging in `loadAll`,
the plugin fetched every project's sessions (80 in the reporter's case,
`showAllProjects=true`) and its `sessions` memo computed all 80 rows. The
host still drew one row. So the break is on the host render side, not in
the session list.

**Observed on:** OpenCode v2.0.32, macOS (arm64), plugin 0.1.2.

**Workaround:** load the plugin from a local checkout path instead of the
package name. This reproduces the same code and renders correctly:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-session-history/src",
      "options": { "limit": 100, "showMetrics": true, "showAllProjects": true }
    }
  ]
}
```

### What has been ruled out

| Hypothesis                              | Test                                                        | Result       |
| --------------------------------------- | ----------------------------------------------------------- | ------------ |
| OpenTUI/Solid version mismatch          | Pin `@opentui/core` & `@opentui/solid` `0.5.17`, `solid-js` `1.9.12` | Still broken |
| npm install vs bun install              | npm-built `node_modules` in a local copy                    | Works        |
| Install location                        | Copy the checkout to `~/.config/opencode/plugins/…`         | Works        |
| `exports["./tui"]` vs path loading      | Point the config at the GitHub cache's `src/` by path       | Still broken |
| Dependency tree differences             | Compare cache vs working copy `node_modules`                | Identical versions for `@opentui/*`, `solid-js` `1.9.12`, `@opencode/plugin` `2.0.31` |

Two findings worth recording:

- **The failure follows the GitHub cache tree, not the load mechanism.**
  Pointing the config at the cache's `src/` by path still fails, so this is
  not `exports`/package-name resolution.
- **The packaged entry cannot use the host's renderer.** Removing
  `@opentui/core`, `@opentui/solid`, and `solid-js` from the cache makes
  loading fail with `Cannot find package '@opentui/solid' imported from …`.
  The package must ship its own copy of the renderer.

### Open question

The same code, with the same versions, fails when loaded from the
npm/Git install tree but renders correctly from any other copy of the same
tree. If you know why an OpenCode package install of a TUI plugin breaks
Slot/Solid rendering like this, please comment on the issue.

### Reproducing the debug output

Add temporary logging to `loadAll` in `src/tui.tsx` (or run the TUI once
with `OPENCODE_LOG_LEVEL=DEBUG`) and watch the number of rows the plugin
computes versus the number the panel shows.

## Missing-directory behavior

The TUI plugin asks the server, via the bundled `session-history.check` RPC, which session directories no longer exist. One batched call covers every distinct directory, and it runs on the server (`node:fs`), so it also works against a remote server and for sessions from every project. It **fails open**: only `ENOENT`/`ENOTDIR` count as missing, so protected paths (macOS `EPERM`) and transient errors never mark a live session.

Rows whose directory is gone are dimmed and marked with a red `✗ missing`. Activating one (click or Enter) warns first instead of opening: a 3-second, dismissible toast that never navigates. Activating the same row again within a few seconds opens it anyway — the CLI then handles the missing directory itself. The warning state resets on a timer and whenever the filter changes.

This is deliberately **not** called "deleted": a missing directory and a deleted session are different states. Deleted sessions are removed from the server and never reach the list.

> **Note:** When the TUI is connected to a remote OpenCode server, "missing" reflects the *server's* filesystem, not your local machine.

## Development

```sh
bun install
bun run typecheck
bun run tests/run.ts
bun run audit
```

> **Two packaging constraints for the TUI entry** — both are asserted by
> `bun run tests/run.ts`:
>
> 1. Keep the `/** @jsxImportSource @opentui/solid */` pragma at the top of
>    `src/tui.tsx`. The package ships only `src/` (see `files`), so there is no
>    `tsconfig.json` next to it in `node_modules`; without the pragma Bun compiles
>    JSX against the `react` runtime (`Cannot find package 'react'`).
> 2. Keep `@opentui/core`, `@opentui/solid` and `solid-js` as **non-optional**
>    `peerDependencies`. OpenCode rewrites those specifiers to its own runtime only
>    for files it discovers by walking a plugin's import graph, and the TUI entry is
>    not always reached — so they must be installed alongside the package
>    (`Cannot find package '@opentui/solid'` otherwise).

## Layout

```
src/
├── rpc.ts       # SessionHistory RPC contract
├── index.ts     # Server plugin: registers the check RPC
├── sessions.ts  # Pure session list/filter helpers (unit-tested)
└── tui.tsx      # CLI plugin: sidebar slot + filter + click + keymap
tests/
└── run.ts       # RPC contract + session helper tests
```

## Reporting bugs

- Bugs and feature requests: <https://github.com/ypxcs/opencode-session-history/issues>
- Security issues: report privately, **not** in a public issue — see [SECURITY.md](./SECURITY.md).

## License

MIT.