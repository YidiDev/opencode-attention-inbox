# opencode-session-history

A CLI plugin for [OpenCode V2](https://opencode.ai/v2/docs/) that adds a **Session History** panel to the sidebar. Click a previous session to resume it — in the same tab if it's already open, in a new tab otherwise.

## Features

- Sidebar panel that lists sessions across every project, newest-first (or
  scoped to the current project with `showAllProjects: false`).
- Search filter by title, id, project, or directory. Click the field to focus
  it (OpenCode does not focus plugin content automatically); `escape` clears
  the query, then blurs back to the prompt.
- Click-to-resume:
  - If the session is already open in a tab → focus that tab.
  - Otherwise → open a new tab and focus it.
  - When session tabs are disabled → falls back to `router.navigate({ type: "session" })`.
- Stale sessions (directory missing on the server) are dimmed with a "·" prefix and show a warning toast on click instead of navigating.
- Subscribes to `session.created` / `session.updated` / `session.deleted` for live refresh.

## Installation

Requires **OpenCode V2**.

### From npm

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

The CLI loads the sidebar panel automatically from the package's `./tui` export — you do not need to add it to `cli.json`.

### From GitHub

```jsonc
{
  "plugins": ["github:ypxcs/opencode-session-history"]
}
```

Pin a revision with `#<commit>` (or `#main`) for reproducibility.

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

## Stale-session behavior

The TUI plugin asks the server via the bundled `session-history.pathExists` RPC whether each session's `location.directory` still exists. On the server we currently treat any directory matching a known project's `canonical` root as alive; non-project paths default to alive (fail-open) until `session.updated` arrives. Rows whose directory is reported missing are dimmed, prefixed with `·`, and clicks produce a warning toast.

> **Note:** When the TUI is connected to a remote OpenCode server, "missing directory" reflects the *server's* filesystem, not your local machine.

## Development

```sh
bun install
bun run typecheck
bun run tests/run.ts
```

## Layout

```
src/
├── rpc.ts       # SessionHistory RPC contract
├── index.ts     # Server plugin: registers pathExists
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