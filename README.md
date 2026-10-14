# opencode-session-history

A CLI plugin for [OpenCode V2](https://opencode.ai/v2/docs/) that adds a **Session History** panel to the sidebar. Click a previous session to resume it — in the same tab if it's already open, in a new tab otherwise.

## Features

- Sidebar panel that lists sessions newest-first (or all projects, by option).
- Search filter by title or id.
- Click-to-resume:
  - If the session is already open in a tab → focus that tab.
  - Otherwise → open a new tab and focus it.
  - When session tabs are disabled → falls back to `router.navigate({ type: "session" })`.
- Stale sessions (directory missing on the server) are dimmed with a "·" prefix and show a warning toast on click instead of navigating.
- Subscribes to `session.created` / `session.updated` / `session.deleted` for live refresh.

## Installation

This plugin is meant to live in your project as `.opencode/plugin/session-history/` or be loaded via the `plugins` field of `opencode.jsonc`.

### As a project-local plugin

1. Copy this directory to `.opencode/plugin/session-history/` in your project.
2. Add the plugin to your `opencode.jsonc` (or `~/.config/opencode/opencode.jsonc`):

   ```jsonc
   {
     "plugins": [
       {
         "package": "./.opencode/plugin/session-history",
         "options": {
           "limit": 100,
           "showMetrics": true,
           "showAllProjects": false
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
| `showAllProjects`  | `boolean` | `false` | When true, list sessions from every project, not just current.  |

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
├── rpc.ts      # SessionHistory RPC contract
├── index.ts    # Server plugin: registers pathExists
└── tui.tsx     # CLI plugin: sidebar slot + click + keymap
tests/
└── run.ts      # RPC contract + cache invariant tests
```

## License

MIT.