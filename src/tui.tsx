import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { SessionInfo } from "@opencode/client"
import type { InputRenderable } from "@opentui/core"
import { createSignal, createMemo, For, Show, onCleanup, createEffect } from "solid-js"
import { SessionHistory } from "./rpc.js"
import { filterSessions, homePanelWidth, mergeSessions, projectLabel, scopeToCurrentProject } from "./sessions.js"

/**
 * CLI plugin: append a Session History panel into the built-in sidebar.
 *
 * Behavior:
 *  - Lists sessions across every project, newest first, by default. When
 *    `options.showAllProjects` is false it is scoped to the current project.
 *  - Search box filters by title and id. OpenCode's renderer disables
 *    click-to-focus and the slot host does not focus plugin content, so the
 *    field is focused explicitly on click; escape clears the query, then
 *    blurs back to the prompt.
 *  - Click/Enter on a row: if the session is already open in a tab, focus
 *    it; otherwise open + focus the tab. When tabs are disabled, fall back
 *    to router.navigate({ type: "session" }).
 *  - Stale sessions (working directory missing on the server) are dimmed,
 *    show a "directory missing" suffix, and clicking shows a warning toast
 *    without navigating.
 *
 * Cross-project listing: `context.data.session.list()` only reflects the
 * sessions the CLI has already cached (mostly the current location), so when
 * listing all projects we also page the full server index via
 * `context.client.session.list({})` and merge the reactive cache on top.
 */
export default Plugin.define({
  id: "session-history",
  setup(context) {
    const limit = (context.options.limit as number | undefined) ?? 100
    const showMetrics = (context.options.showMetrics as boolean | undefined) ?? true
    const showAllProjects = (context.options.showAllProjects as boolean | undefined) ?? true

    // Ensure project + session stores are populated.
    void context.data.project.sync().catch(() => {})
    // Tabs.enabled() gates the click path; we don't pre-sync sessions here
    // because context.data.session.list() returns whatever is loaded.

    const stopCreated = context.data.on("session.created", () => {
      // Session lifecycle event triggers a refresh. The data store is
      // reactive and already reflects most fields; this just nudges the UI.
      void context.data.project.sync().catch(() => {})
    })
    const stopRenamed = context.data.on("session.renamed", () => {
      void context.data.project.sync().catch(() => {})
    })
    const stopMetadataUpdated = context.data.on("session.metadata.updated", () => {
      void context.data.project.sync().catch(() => {})
    })
    const stopUsageUpdated = context.data.on("session.usage.updated", () => {
      void context.data.project.sync().catch(() => {})
    })
    const stopDeleted = context.data.on("session.deleted", () => {
      void context.data.project.sync().catch(() => {})
    })

    onCleanup(() => {
      stopCreated()
      stopRenamed()
      stopMetadataUpdated()
      stopUsageUpdated()
      stopDeleted()
    })

    const disposeSidebar = context.ui.slot({
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

    // The CLI only renders a sidebar inside the session route, so the same
    // list is surfaced on the home screen through the global `app` slot.
    const disposeHome = context.ui.slot({
      append: "app",
      render: () => (
        <HomeHistoryPanel limit={limit} showMetrics={showMetrics} showAllProjects={showAllProjects} />
      ),
    })

    return () => {
      disposeSidebar()
      disposeHome()
    }
  },
})

const PAGE_SIZE = 100
const MAX_FETCH = 500

/**
 * Home-screen session panel. The CLI renders the sidebar only inside the
 * session route, so on the home route we mount the same list into the global
 * `app` slot as an overlay pinned to the right margin. The width is derived so
 * it never covers the centered home content; below that it stays hidden.
 */
function HomeHistoryPanel(props: {
  limit: number
  showMetrics: boolean
  showAllProjects: boolean
}) {
  const context = usePlugin()
  const [terminalWidth, setTerminalWidth] = createSignal(context.renderer.terminalWidth)

  // The renderer width is a plain getter, so track resizes to show/hide the
  // panel as the terminal grows or shrinks.
  const onResize = () => setTerminalWidth(context.renderer.terminalWidth)
  context.renderer.on("resize", onResize)
  onCleanup(() => context.renderer.off("resize", onResize))

  const panelWidth = createMemo(() => homePanelWidth(terminalWidth()))
  const visible = createMemo(() => panelWidth() > 0 && context.ui.router.current().type === "home")

  return (
    <Show when={visible()}>
      <box
        position="absolute"
        top={0}
        right={0}
        height="100%"
        width={panelWidth()}
        backgroundColor={context.theme.background?.raised?.base}
      >
        <SidebarHistory
          activeSessionID={undefined}
          limit={props.limit}
          showMetrics={props.showMetrics}
          showAllProjects={props.showAllProjects}
        />
      </box>
    </Show>
  )
}

function SidebarHistory(props: {
  activeSessionID: string | undefined
  limit: number
  showMetrics: boolean
  showAllProjects: boolean
}) {
  const context = usePlugin()
  const [query, setQuery] = createSignal("")
  const [stale, setStale] = createSignal<ReadonlyMap<string, boolean>>(new Map())
  const [activeRow, setActiveRow] = createSignal<string | undefined>(undefined)
  const [remote, setRemote] = createSignal<readonly SessionInfo[]>([])

  // The filter input is focused explicitly. OpenCode's renderer disables
  // click-to-focus (autoFocus: false) and the slot host does not focus plugin
  // content, so an unfocused <input> never receives keystrokes. Focus it on
  // click and leave it with escape so it never steals focus from the prompt.
  let inputRef: InputRenderable | undefined
  const focusFilter = () => inputRef?.focus()
  const blurFilter = () => inputRef?.blur()

  // Full cross-project index from the server. The reactive store only holds
  // what the CLI has cached, so page the server list to enumerate every
  // project's sessions (newest first, top-level only).
  const loadAll = async () => {
    if (!props.showAllProjects) return
    const collected: SessionInfo[] = []
    let cursor: string | undefined
    do {
      const page = await context.client.session.list({
        order: "desc",
        limit: PAGE_SIZE,
        parentID: null,
        ...(cursor === undefined ? {} : { cursor }),
      })
      collected.push(...page.data)
      cursor = page.cursor.next ?? undefined
    } while (cursor !== undefined && collected.length < MAX_FETCH)
    setRemote(collected)
  }

  // Refresh the index when the set of sessions changes (debounced).
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleRefresh = () => {
    if (!props.showAllProjects) return
    if (refreshTimer !== undefined) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void loadAll().catch(() => {}), 250)
  }
  void loadAll().catch(() => {})

  const stopCreated = context.data.on("session.created", scheduleRefresh)
  const stopDeleted = context.data.on("session.deleted", scheduleRefresh)
  const stopRenamed = context.data.on("session.renamed", scheduleRefresh)
  const stopMetadata = context.data.on("session.metadata.updated", scheduleRefresh)
  onCleanup(() => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer)
    stopCreated()
    stopDeleted()
    stopRenamed()
    stopMetadata()
  })

  // Reactive list of sessions, filtered by query and project scope.
  const sessions = createMemo(() => {
    const cached = context.data.session.list() ?? []
    const scoped = props.showAllProjects
      ? cached
      : scopeToCurrentProject(cached, context.data.location.default()?.directory, context.data.project.list() ?? [])
    const base = props.showAllProjects ? mergeSessions(remote(), scoped) : scoped
    return filterSessions(base, query(), context.data.project.list() ?? []).slice(0, props.limit)
  })

  // Freshness pass: ask the server which session directories still exist.
  createEffect(() => {
    const rows = sessions()
    const cache = new Map(stale())
    let mutated = false
    const rpc = context.client.rpc(SessionHistory)
    void Promise.all(
      rows.map(async (s) => {
        const dir = s.location.directory
        if (cache.has(dir)) return
        try {
          const out = (await rpc.pathExists({ directory: dir })) as { exists: boolean }
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
  const activate = (sessionID: string, directory: string) => {
    blurFilter()
    if (stale().get(directory) === false) {
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

  // OpenTUI click idiom: mousedown highlights, mouseup fires the action.
  const onMouseDown = (sessionID: string) => setActiveRow(sessionID)
  const onMouseUp = (sessionID: string, directory: string) => activate(sessionID, directory)

  // Keymap: enter on highlighted row activates, esc clears.
  context.keymap.layer(() => ({
    mode: "base",
    commands: [
      {
        id: "session-history.activate",
        title: "Open highlighted session",
        bind: "return",
        enabled: () => {
          const id = activeRow()
          if (!id) return false
          const session = sessions().find((s) => s.id === id)
          return Boolean(session)
        },
        run: () => {
          const id = activeRow()
          if (!id) return
          const session = sessions().find((s) => s.id === id)
          if (!session) return
          activate(session.id, session.location.directory)
        },
      },
      {
        id: "session-history.move-down",
        title: "Move highlight down",
        bind: "down",
        run: () => {
          const rows = sessions()
          if (rows.length === 0) return
          const i = rows.findIndex((s) => s.id === activeRow())
          const next = i < 0 ? 0 : Math.min(i + 1, rows.length - 1)
          const row = rows[next]
          if (row) setActiveRow(row.id)
        },
      },
      {
        id: "session-history.move-up",
        title: "Move highlight up",
        bind: "up",
        run: () => {
          const rows = sessions()
          if (rows.length === 0) return
          const i = rows.findIndex((s) => s.id === activeRow())
          const next = i < 0 ? rows.length - 1 : Math.max(i - 1, 0)
          const row = rows[next]
          if (row) setActiveRow(row.id)
        },
      },
    ],
  }))

  // Scoped to the filter input: escape clears the query, then blurs back to
  // the prompt. Scoping keeps it from shadowing the global escape binding.
  context.keymap.layer(() => ({
    mode: "base",
    target: () => inputRef,
    priority: 1,
    commands: [
      {
        id: "session-history.filter.dismiss",
        title: "Clear session filter",
        bind: "escape",
        run: () => {
          if (query()) {
            setQuery("")
            return
          }
          blurFilter()
        },
      },
    ],
  }))

  return (
    <box flexDirection="column" paddingX={1}>
      <text fg={context.theme.text.strong}>Session History</text>
      <box>
        <input
          ref={(el) => {
            inputRef = el
          }}
          placeholder="Filter by title, id, or project"
          onMouseDown={focusFilter}
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
              const isStale = createMemo(() => stale().get(s.location.directory) === false)
              const isActive = createMemo(() => props.activeSessionID === s.id || activeRow() === s.id)
              const label = s.title?.trim() || `session ${s.id.slice(0, 8)}`
              return (
                <box
                  flexDirection="column"
                  onMouseDown={() => onMouseDown(s.id)}
                  onMouseUp={() => onMouseUp(s.id, s.location.directory)}
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
                      {props.showAllProjects ? `${projectLabel(s.location.directory)} · ` : ""}
                      {formatRelative(s.time.updated)} · ${s.cost.toFixed(2)}
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