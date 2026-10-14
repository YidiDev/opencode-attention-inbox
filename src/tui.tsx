import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal, createMemo, For, Show, onCleanup, createEffect } from "solid-js"
import { SessionHistory } from "./rpc.js"

/**
 * CLI plugin: append a Session History panel into the built-in sidebar.
 *
 * Behavior:
 *  - Lists sessions for the current project (or all projects when
 *    `options.showAllProjects` is true), newest first.
 *  - Search box filters by title and id.
 *  - Click/Enter on a row: if the session is already open in a tab, focus
 *    it; otherwise open + focus the tab. When tabs are disabled, fall back
 *    to router.navigate({ type: "session" }).
 *  - Stale sessions (working directory missing on the server) are dimmed,
 *    show a "directory missing" suffix, and clicking shows a warning toast
 *    without navigating.
 */
export default Plugin.define({
  id: "session-history",
  setup(context) {
    const limit = (context.options.limit as number | undefined) ?? 100
    const showMetrics = (context.options.showMetrics as boolean | undefined) ?? true
    const showAllProjects = (context.options.showAllProjects as boolean | undefined) ?? false

    // Ensure project + session stores are populated.
    void context.data.project.sync().catch(() => {})
    // Tabs.enabled() gates the click path; we don't pre-sync sessions here
    // because context.data.session.list() returns whatever is loaded.

    const stopCreated = context.data.on("session.created", () => {
      // session.cause is part of the existing V2 sync; a refresh keeps the
      // sidebar in sync without depending on internal store shapes.
      void context.data.project.sync().catch(() => {})
    })
    const stopUpdated = context.data.on("session.updated", () => {
      void context.data.project.sync().catch(() => {})
    })
    const stopDeleted = context.data.on("session.deleted", () => {
      void context.data.project.sync().catch(() => {})
    })

    onCleanup(() => {
      stopCreated()
      stopUpdated()
      stopDeleted()
    })

    return context.ui.slot({
      append: "sidebar.content",
      render: (input) => (
        <SidebarHistory
          activeSessionID={input.sessionID}
          limit={limit}
          showMetrics={showMetrics}
          showAllProjects={showAllProjects}
        />
      ),
    })
  },
})

function SidebarHistory(props: {
  activeSessionID: string | undefined
  limit: number
  showMetrics: boolean
  showAllProjects: boolean
}) {
  const context = usePlugin()
  const [query, setQuery] = createSignal("")
  const [stale, setStale] = createSignal<ReadonlyMap<string, boolean>>(new Map())

  // Reactive list of sessions, filtered by query and project scope.
  const sessions = createMemo(() => {
    const all = context.data.session.list() ?? []
    const projects = context.data.project.list() ?? []
    const currentProject = context.data.location.default()
    const currentRoot = currentProject?.directory
    const filtered = props.showAllProjects
      ? all
      : all.filter((s) => s.location?.directory === currentRoot || projects.some((p) => p.canonical === s.location?.directory))

    const q = query().trim().toLowerCase()
    const searched = q
      ? filtered.filter((s) => {
          const title = (s.title ?? "").toLowerCase()
          const id = s.id.toLowerCase()
          return title.includes(q) || id.includes(q)
        })
      : filtered

    // Sort newest first, drop archived, cap to limit.
    return searched
      .filter((s) => !s.time.archived || s.time.archived === 0)
      .slice()
      .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      .slice(0, props.limit)
  })

  // Freshness pass: ask the server which session directories still exist.
  createEffect(() => {
    const rows = sessions()
    const cache = new Map(stale())
    let mutated = false
    const rpc = context.client.rpc(SessionHistory)
    void Promise.all(
      rows.map(async (s) => {
        const dir = s.location?.directory
        if (!dir) return
        if (cache.has(dir)) return
        try {
          const out = await rpc.pathExists({ directory: dir })
          cache.set(dir, out.exists)
          mutated = true
        } catch {
          cache.set(dir, true) // fail-open; let user retry
        }
      }),
    ).then(() => {
      if (mutated) setStale(new Map(cache))
    })
  })

  // Click handler: open in tab (preferred) or navigate when tabs are off.
  const openSession = (sessionID: string, directory: string | undefined) => {
    if (directory && stale().get(directory) === false) {
      context.ui.toast.show({
        message: "Directory no longer exists",
        variant: "warning",
        sessionID,
      })
      return
    }
    if (context.ui.tabs.enabled()) {
      const list = context.ui.tabs.list()
      const existing = list.find((t) => t.sessionID === sessionID)
      if (existing) {
        context.ui.tabs.focus(sessionID)
      } else {
        context.ui.tabs.open(sessionID)
        context.ui.tabs.focus(sessionID)
      }
      return
    }
    context.ui.router.navigate({ type: "session", sessionID })
  }

  // Keymap: ctrl+b toggles the sidebar visibility through the CLI setting.
  context.keymap.layer(() => ({
    mode: "base",
    commands: [
      {
        id: "session-history.toggle-sidebar",
        title: "Toggle Session History sidebar",
        bind: "ctrl+b",
        run: () => {
          // Toggle by writing the `session.sidebar` setting via storage so
          // the host re-reads it. The host owns the actual toggle; this is a
          // best-effort shortcut that pairs with the panel.
          void context.keymap.dispatch("app.toggleSidebar")
        },
      },
    ],
  }))

  return (
    <box flexDirection="column" paddingX={1}>
      <text fg={context.theme.text.strong}>Session History</text>
      <box>
        <input
          value={query()}
          placeholder="Filter by title or id"
          onInput={(v: string) => setQuery(v)}
        />
      </box>
      <Show
        when={sessions().length > 0}
        fallback={
          <text fg={context.theme.text.muted}>
            {query() ? "No matches" : "No previous sessions"}
          </text>
        }
      >
        <scrollbox flexDirection="column" maxHeight={20}>
          <For each={sessions()}>
            {(s) => {
              const isStale = createMemo(() => {
                const dir = s.location?.directory
                return dir ? stale().get(dir) === false : false
              })
              const isActive = createMemo(() => props.activeSessionID === s.id)
              const label = s.title?.trim() || `session ${s.id.slice(0, 8)}`
              const dir = s.location?.directory
              return (
                <box
                  flexDirection="column"
                  onMouseDown={() => openSession(s.id, dir)}
                  onMouseUp={() => openSession(s.id, dir)}
                >
                  <text
                    fg={
                      isStale()
                        ? context.theme.text.muted
                        : isActive()
                          ? context.theme.text.strong
                          : context.theme.text.base
                    }
                  >
                    {isStale() ? "· " : ""}
                    {label}
                  </text>
                  <Show when={props.showMetrics}>
                    <text fg={context.theme.text.muted}>
                      {formatRelative(s.time.updated)} · ${(s.cost ?? 0).toFixed(2)}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}

function formatRelative(epoch: number | undefined): string {
  if (!epoch) return "—"
  const diff = Date.now() - epoch
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}