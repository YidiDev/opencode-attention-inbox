/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { resolveOptions, type Scope } from "./options.js"
import { AttentionInbox } from "./rpc.js"
import { InboxController } from "./data/controller.js"
import { createAdapter } from "./data/adapter.js"
import { deriveRows, scopeRows, statusLabel } from "./attention/derive.js"
import { Inbox } from "./ui/inbox.js"
import { openSession } from "./ui/navigation.js"
import { safeText } from "./ui/text.js"
import { projectForDirectory } from "./attention/scope.js"

export default Plugin.define({
  id: "attention-inbox",
  setup(context) {
    const [serverOptions, setServerOptions] = createSignal<Record<string, unknown>>({})
    const options = createMemo(() => resolveOptions(serverOptions(), context.options))
    const [preferences, updatePreferences] = context.storage.store<{ scope?: Scope }>("preferences", { initial: {} })
    const scope = () => preferences.scope === "all" || preferences.scope === "project"
      ? preferences.scope : options().defaultScope
    const toggleScope = () => {
      void updatePreferences(draft => { draft.scope = scope() === "all" ? "project" : "all" }).catch(() => {
        context.ui.toast.show({ message: "Could not save inbox scope", variant: "error" })
      })
    }

    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const loadSettings = async () => {
      try {
        const result = await context.client.rpc(AttentionInbox).settings({}, {
          location: context.location ?? context.data.location.default(),
        }) as { options: Record<string, unknown> }
        if (!disposed) setServerOptions(result.options)
      } catch (error) {
        if (!disposed && ++attempts < 15 && (error as { type?: string })?.type !== "rpc.method_not_found") {
          retry = setTimeout(() => void loadSettings(), 1000)
        }
      }
    }
    void loadSettings()
    void context.data.project.sync().catch(() => {})
    const controller = new InboxController(createAdapter(context), { pollIntervalMs: options().pollIntervalMs })
    createEffect(() => controller.setPollInterval(options().pollIntervalMs))
    const [snapshot, setSnapshot] = createSignal(controller.current)
    const stopSnapshot = controller.subscribe(setSnapshot)
    const rows = createMemo(() => deriveRows(snapshot(), options().includeChildCompletions))
    const projectID = createMemo(() => {
      const route = context.ui.router.current()
      if (route.type === "session") {
        return snapshot().sessions.find(session => session.id === route.sessionID)?.projectID ??
          context.data.session.get(route.sessionID)?.projectID
      }
      const directory = (context.location ?? context.data.location.default()).directory
      return projectForDirectory(directory, context.data.project.list())
    })
    const visibleRows = createMemo(() => scopeRows(rows(), scope(), projectID()))
    let focusInbox: (() => boolean) | undefined
    const selectFallback = async () => {
      const available = visibleRows()
      if (!available.length) {
        context.ui.toast.show({ message: snapshot().phase === "ready" ? "Nothing needs attention" : "Inbox is still syncing", variant: "info" })
        return
      }
      const id = await context.ui.dialog.select({
        title: "Needs attention",
        options: available.map(row => ({ value: row.session.id,
          title: safeText(row.session.title ?? row.session.id), description: statusLabel(row) })),
      })
      const row = visibleRows().find(row => row.session.id === id)
      if (row) openSession(context, row)
    }
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        { id: "attention-inbox.scope.toggle", title: "Inbox: toggle project / all projects", group: "Attention inbox",
          palette: true, bind: "<leader>v", run: toggleScope },
        { id: "attention-inbox.focus", title: "Inbox: focus needs attention", group: "Attention inbox",
          palette: true, bind: "<leader>o", run: () => {
            if (!focusInbox?.()) return selectFallback()
          } },
        { id: "attention-inbox.open-next", title: "Inbox: open next session", group: "Attention inbox",
          palette: true, run: () => { const row = visibleRows()[0]; if (row) openSession(context, row) } },
        { id: "attention-inbox.refresh", title: "Inbox: refresh", group: "Attention inbox",
          palette: true, run: () => controller.invalidate() },
      ],
    }))
    const stopSlot = context.ui.slot({
      append: "sidebar.footer",
      render: () => <Inbox rows={visibleRows()} snapshot={snapshot()} scope={scope()}
        projectKnown={projectID() !== undefined} maxVisibleRows={options().maxVisibleRows}
        toggleScope={toggleScope} registerFocus={focus => { focusInbox = focus }} />,
    })
    controller.start()
    onCleanup(() => {
      disposed = true
      if (retry) clearTimeout(retry)
      stopSlot()
      stopSnapshot()
      controller.dispose()
    })
  },
})
