/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { deriveRows, scopeRows } from "./attention/derive.js"
import { projectForDirectory } from "./attention/scope.js"
import { createAdapter } from "./data/adapter.js"
import { InboxController } from "./data/controller.js"
import { syncSettings } from "./data/settings.js"
import { resolveOptions, type Scope } from "./options.js"
import { AttentionInbox } from "./rpc.js"
import { Inbox } from "./ui/inbox.js"
import { openSession } from "./ui/navigation.js"
import { inboxHealth, pickerOptions } from "./ui/presentation.js"

export default Plugin.define({
  id: "attention-inbox",
  setup(context) {
    const [serverOptions, setServerOptions] = createSignal<Record<string, unknown>>({})
    const options = createMemo(() => resolveOptions(serverOptions(), context.options))
    const [preferences, updatePreferences] = context.storage.store<{ scope?: Scope }>("preferences", {
      initial: {},
    })
    const scope = () =>
      preferences.scope === "all" || preferences.scope === "project"
        ? preferences.scope
        : options().defaultScope
    const toggleScope = () => {
      void updatePreferences((draft) => {
        draft.scope = scope() === "all" ? "project" : "all"
      }).catch(() => {
        context.ui.toast.show({ message: "Could not save inbox scope", variant: "error" })
      })
    }

    let disposed = false
    const stopSettings = syncSettings(
      (signal) =>
        context.client.rpc(AttentionInbox).settings(
          {},
          {
            location: context.location ?? context.data.location.default(),
            signal,
          },
        ) as Promise<{ options: Record<string, unknown> }>,
      setServerOptions,
    )
    void context.data.project.sync().catch(() => {})
    const controller = new InboxController(createAdapter(context), {
      pollIntervalMs: options().pollIntervalMs,
    })
    createEffect(() => controller.setPollInterval(options().pollIntervalMs))
    const [snapshot, setSnapshot] = createSignal(controller.current)
    const stopSnapshot = controller.subscribe(setSnapshot)
    const rows = createMemo(() => deriveRows(snapshot(), options().includeChildCompletions))
    const projectID = createMemo(() => {
      const route = context.ui.router.current()
      if (route.type === "session") {
        return (
          snapshot().sessions.find((session) => session.id === route.sessionID)?.projectID ??
          context.data.session.get(route.sessionID)?.projectID
        )
      }
      const directory = (context.location ?? context.data.location.default()).directory
      return projectForDirectory(directory, context.data.project.list())
    })
    const visibleRows = createMemo(() => scopeRows(rows(), scope(), projectID()))
    const health = () =>
      inboxHealth(snapshot().phase, visibleRows().length, scope(), projectID() !== undefined)
    const focusTargets = new Set<() => boolean>()
    const focusInbox = () => [...focusTargets].reverse().some((focus) => focus())
    const selectFallback = async () => {
      if (disposed) return
      if (health() === "Nothing needs attention") {
        context.ui.toast.show({ message: health(), variant: "info" })
        return
      }
      const id = await context.ui.dialog.select({
        get title() {
          return `Needs attention${health() ? ` · ${health()}` : ""}`
        },
        get options() {
          return pickerOptions(visibleRows())
        },
      })
      const row = visibleRows().find((row) => row.session.id === id)
      if (!disposed && row) openSession(context, row)
    }
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "attention-inbox.scope.toggle",
          title: "Inbox: toggle project / all projects",
          group: "Attention inbox",
          palette: true,
          bind: "<leader>v",
          run: toggleScope,
        },
        {
          id: "attention-inbox.focus",
          title: "Inbox: focus needs attention",
          group: "Attention inbox",
          palette: true,
          bind: "<leader>o",
          run: () => {
            if (!focusInbox()) return selectFallback()
          },
        },
        {
          id: "attention-inbox.open-next",
          title: "Inbox: open next session",
          group: "Attention inbox",
          palette: true,
          run: () => {
            const row = visibleRows()[0]
            if (row) openSession(context, row)
            else return selectFallback()
          },
        },
        {
          id: "attention-inbox.refresh",
          title: "Inbox: refresh",
          group: "Attention inbox",
          palette: true,
          run: () => controller.invalidate(),
        },
      ],
    }))
    const stopSlot = context.ui.slot({
      append: "sidebar.footer",
      render: () => (
        <Inbox
          rows={visibleRows()}
          snapshot={snapshot()}
          scope={scope()}
          projectKnown={projectID() !== undefined}
          maxVisibleRows={options().maxVisibleRows}
          toggleScope={toggleScope}
          registerFocus={(focus) => {
            focusTargets.add(focus)
            return () => {
              focusTargets.delete(focus)
            }
          }}
        />
      ),
    })
    controller.start()
    onCleanup(() => {
      disposed = true
      stopSettings()
      stopSlot()
      stopSnapshot()
      controller.dispose()
    })
  },
})
