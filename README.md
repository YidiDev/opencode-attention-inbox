# OpenCode Attention Inbox

A separate, navigation-only OpenCode V2 plugin. **Needs attention** lives at the
bottom of the right sidebar and updates without switching away from your work.

- Pending **permissions** and **questions**, including blocking child sessions.
- Successful **Done · unread** completions, using OpenCode's native idle/viewed markers.
- Click a row to focus/open that session, preserving its own project and worktree.
- Switch between **Current project** (including its worktrees) and **All projects**
  on the connected server. The choice is saved across CLI instances.

No inline approval, automatic answers, notifications, transcript fetching, or
communicator integration. This is not session history or multi-server aggregation.

Example from the isolated packed-plugin acceptance run (fixture paths shortened):

```text
Needs attention 3
All projects ↔
Fixture foreign question
Permission · Question
…/b
Fixture worktree question
Question
…/tree
Fixture completed
Done · unread
…/a
```

## Local installation

Built against **OpenCode 2.1.4**, Bun **1.4.0**, Linux x64. The V2 plugin API is
experimental; other host versions are not yet verified. This repository is private;
the npm package is unpublished.

The development/check workflow below requires **npm** as well as Bun: packaging
tests invoke `npm pack`. If your Bun installation does not include npm, install
Node.js/npm separately. Live acceptance additionally requires Git, tar and tmux.

```sh
cd /path/to/opencode-attention-inbox
bun install --frozen-lockfile
bun run build
bun run check
```

Merge the following entry into **global** `~/.config/opencode/cli.json` (or
`$XDG_CONFIG_HOME/opencode/cli.json`), preserving your existing settings/plugins:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-attention-inbox/dist",
      "options": {
        "defaultScope": "project",
        "maxVisibleRows": 4,
        "pollIntervalMs": 30000,
        "includeChildCompletions": false
      }
    }
  ]
}
```

OpenCode watches configuration changes; `/reload` forces a reload. No service
restart is needed. Use the CLI config for options. The optional server entry
provides only a settings RPC for installations configured through `opencode.json`;
CLI options take precedence.

For a local directory, point at **`dist`**, which contains `index.js` and `tui.js`.
The host's directory loader does not use the repository root's package exports.

## Controls

| Action | Default |
| --- | --- |
| Toggle project / all projects | `Ctrl+X`, then `V`; or click the scope label |
| Focus inbox | `Ctrl+X`, then `O`; or click the heading |
| Select / open / return | `↑` / `↓`, `Enter`, `Esc`, while inbox is focused |
| Toggle scope while focused | `Tab` |
| Open next / refresh | Command palette: **Inbox: open next session** / **Inbox: refresh** |

Arrow keys are local to the inbox. Updates preserve selection by session ID and
never move input focus. Your configured leader replaces `Ctrl+X`. Customize or
disable bindings under `keybinds` in `cli.json`:

```json
{
  "keybinds": {
    "attention-inbox.scope.toggle": "<leader>v",
    "attention-inbox.focus": "<leader>o",
    "attention-inbox.open-next": "none",
    "attention-inbox.refresh": "none"
  }
}
```

The host hides the sidebar on narrow terminals and on home. **Focus needs
attention** then uses a native picker; open-next and scope commands still work.
The plugin does not force the sidebar open or alter your layout settings.

## Attention semantics

One row per owning session, with multiple badges when applicable. Permissions
sort first, then questions, oldest wait first. Completions sort newest first.
IDs break ties, so refreshes do not shuffle equal-priority rows.

- A completion requires `outcome: succeeded`, a newer `time.idle` than
  `time.viewed`, and no active execution. Metadata/cost updates, failures, and
  interruptions do not create completions.
- OpenCode owns viewed acknowledgment, including its exact-idle token and
  cross-client propagation. Merely listing sessions, changing scope, or opening
  a background tab does not mark them read.
- Opening a row never answers a question or approves a permission. Those badges
  remain until native resolution/cancellation. Archived sessions still appear
  for unresolved blocking requests, but not ordinary completions.
- Ordinary child completions are hidden by default; child requests show the
  parent context and pass the actual child's ID to the native router, without
  duplicating its badge on the parent. OpenCode 2.1.4 displays child navigation
  in its native **Subagents** panel rather than a separate root-session tab.
  Inactive children can require the panel's **show inactive** control; this
  plugin cannot bypass that host UI or answer the child's request itself.
- Native pending requests do not expose creation times. Requests present at
  startup use first-observation time, with stable ID ordering for ties. Live
  request events supply their native creation timestamps. This ordering metadata
  is memory-only, so a reload resets first-observed times.

## Synchronization and limits

The setup-owned controller subscribes before reading, pages through **all**
sessions (including children), and fetches pending requests once per distinct
session directory, with at most four directories in flight. It does not rely on
the TUI's incomplete session cache or stop at 500 sessions. Relevant events
invalidate the snapshot with a 200 ms debounce; a periodic full reconciliation
recovers missed events and disconnections.

Polling waits for the previous scan to settle. Each API read has a 10-second
deadline and cancellation; failed parallel reads cancel their sibling. Continuous
events can publish useful progress as **Stale**, never falsely as current.
The first directory result publishes immediately as **Partial**; later
results are coalesced into 50 ms progress batches to avoid re-deriving the entire
inbox for every directory. Final pending progress flushes before the active read,
and the validated final snapshot publishes immediately. Completed healthy reads
do not wait for unrelated slow reads before publishing; directories still share
the bounded queue, so large historical inventories can delay discovery. Unchecked/failed
directories retain their previous badges. New completion evidence waits for the
active-session read, so incremental discovery never invents a completion.

**Syncing**, **Partial**, **Stale**, and a `?` count qualifier explicitly indicate
uncertainty; they are not a verified empty inbox. Failed reads preserve last-known
data. A failed location retains its last-known unresolved badges. Refresh from
the command palette to retry immediately. Very large inventories and inaccessible
historical directories can take longer or keep the state partial.

Current-project identity follows the active session, not the launch directory.
On home it is resolved from the launch location. An unknown project is shown as
unresolved rather than silently broadening the filter. Scope changes never delete
backing state or acknowledge anything.

The maximum visible row count is clamped to 1–8 (default 4); scroll for more.
Only the visible window plus two overscan rows is mounted. Refreshes preserve
manual scroll position, and the narrow-terminal picker updates while open.
Pointer focus does not scroll content under a click; a row removed or replaced
under the pointer before release cancels navigation. Project/worktree labels reserve space independently
of long parent titles.
Polling is clamped to 5–300 seconds. The plugin stores only the scope preference,
keeps attention metadata in memory, strips terminal control sequences from
display strings, and does not log session titles, paths, or request contents.

The optional server-settings RPC also has a 10-second deadline, bounded retries,
and setup-owned cancellation on reload. CLI-configured options remain available
while this compatibility bridge is unavailable.

## Development

```sh
bun run build        # refresh committed dist after source changes
bun run check        # format, lint, types, tests, per-file coverage, dist freshness
bun run test:live    # opt-in isolated real OpenCode + tmux, no model credentials
```

`src/attention` contains pure rules, `src/data` the API boundary and reconciler,
and `src/ui` the compact host-themed interface. `dist` is committed and must be
rebuilt when source changes. The Solid universal precompile matters: packed
plugins must stay reactive inside `node_modules` and share the host's Solid and
OpenTUI runtimes instead of bundling private copies.

The live harness uses an extracted npm archive, its own temporary HOME/XDG
directories, private authenticated server, two Git projects, one worktree, and a
dedicated tmux socket. It does not touch your normal sessions or configuration.
Text captures stay in the printed temporary evidence directory; the test stops
only its own server and tmux instance. Requires `opencode`, `tmux`, `git`, `npm`,
and `tar` on PATH.

See [CONTRIBUTING.md](CONTRIBUTING.md) for CI, compatibility, security checks,
and the release checklist, and [CHANGELOG.md](CHANGELOG.md) for changes.

## Attribution

Derived from [ypxcs/opencode-session-history](https://github.com/ypxcs/opencode-session-history),
MIT, base commit `2d61f0cd5205ef673fb547a3a5e7b454796c026b` (0.1.5).
The original copyright/license is retained in `LICENSE`. The attention model,
reconciler and inbox replace the history behavior; the Solid packaging approach
is retained. See `NOTICE`.
