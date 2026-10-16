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

## Packaging: why the TUI entry is precompiled

OpenCode compiles plugin JSX through OpenTUI's own Bun plugin, but that plugin
only touches files whose path does **not** contain `node_modules`:

```js
/^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx?(?:[?#].*)?$/
```

Every package install — npm or Git — lands the plugin in `node_modules`, so a
raw `.tsx` TUI entry never gets that transform. Bun's own JSX transform then
compiles it against `@opentui/solid/jsx-runtime`, which is a *static* runtime:
props are plain values, not getters. Each signal read happens once, at mount, so
the panel lists only the session cached at mount (`1 session`), never refreshes,
and the slot it was appended to is laid out from the same stale snapshot. The
identical source loaded from a checkout path sits outside `node_modules`, gets
the real transform, and works — which is why the bug followed the install tree.

So `bun run build` precompiles `src/**` into `dist/**` with the transform
OpenCode would have applied (`babel-preset-solid`,
`{ moduleName: "@opentui/solid", generate: "universal" }`), and
`package.json#exports` points at `dist/`. The compiled entry imports
`@opentui/solid` and `solid-js` by bare name, which OpenCode rewrites to its own
runtime — the plugin shares the host's single Solid instance instead of
installing a second one.

`dist/` is committed on purpose: package installs do not run a build step.

## Missing-directory behavior

The TUI plugin asks the server, via the bundled `session-history.check` RPC, which session directories no longer exist. One batched call covers every distinct directory, and it runs on the server (`node:fs`), so it also works against a remote server and for sessions from every project. It **fails open**: only `ENOENT`/`ENOTDIR` count as missing, so protected paths (macOS `EPERM`) and transient errors never mark a live session.

Rows whose directory is gone are dimmed and marked with a red `✗ missing`. Activating one (click or Enter) warns first instead of opening: a 3-second, dismissible toast that never navigates. Activating the same row again within a few seconds opens it anyway — the CLI then handles the missing directory itself. The warning state resets on a timer and whenever the filter changes.

This is deliberately **not** called "deleted": a missing directory and a deleted session are different states. Deleted sessions are removed from the server and never reach the list.

> **Note:** When the TUI is connected to a remote OpenCode server, "missing" reflects the *server's* filesystem, not your local machine.

## Development

```sh
bun install
bun run build
bun run typecheck
bun run tests/run.ts
bun run audit
```

> **Packaging constraints** — all asserted by `bun run tests/run.ts`:
>
> 1. `dist/` must be committed and up to date. The test rebuilds `src/` into a
>    temp directory and compares it byte for byte, so run `bun run build` after
>    touching anything in `src/`. Package installs never run a build.
> 2. The build must not use `babel-plugin-module-resolver`. The compiled entry
>    has to import `@opentui/solid` and `solid-js` by bare name so OpenCode can
>    redirect them to its own runtime; baked-in `opentui:runtime-module:` ids
>    only resolve inside the host process.
> 3. Keep the `/** @jsxImportSource @opentui/solid */` pragma at the top of
>    `src/tui.tsx`. That raw file is still loaded when the plugin is configured
>    by path from a checkout, where no `tsconfig.json` sits next to it; without
>    the pragma Bun compiles JSX against the `react` runtime
>    (`Cannot find package 'react'`).
> 4. Keep `@opentui/core`, `@opentui/solid` and `solid-js` as **non-optional**
>    `peerDependencies`. They must be installed alongside the package or loading
>    fails with `Cannot find package '@opentui/solid'`.

## Layout

```
scripts/
└── build.ts     # Compiles src/ → dist/ (babel-preset-solid, universal)
src/
├── rpc.ts       # SessionHistory RPC contract
├── index.ts     # Server plugin: registers the check RPC
├── sessions.ts  # Pure session list/filter helpers (unit-tested)
└── tui.tsx      # CLI plugin: sidebar slot + filter + click + keymap
tests/
└── run.ts       # RPC contract + session helper + packaging tests
dist/            # Committed build output; what package installs load
```

## Reporting bugs

- Bugs and feature requests: <https://github.com/ypxcs/opencode-session-history/issues>
- Security issues: report privately, **not** in a public issue — see [SECURITY.md](./SECURITY.md).

## License

MIT.