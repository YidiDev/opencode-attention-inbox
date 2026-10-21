/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui"
import {
  type BoxRenderable,
  type Renderable,
  RenderableEvents,
  type ScrollBoxRenderable,
} from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { statusLabel } from "../attention/derive.js"
import type { AttentionRow, Snapshot } from "../attention/model.js"
import type { Scope } from "../options.js"
import { openSession } from "./navigation.js"
import { inboxHealth, rowContext, rowWindow } from "./presentation.js"
import { truncate } from "./text.js"

export function Inbox(props: {
  rows: readonly AttentionRow[]
  snapshot: Snapshot
  scope: Scope
  projectKnown: boolean
  maxVisibleRows: number
  toggleScope: () => void
  registerFocus: (focus: () => boolean) => () => void
}) {
  const context = usePlugin()
  const [selected, setSelected] = createSignal<string>()
  const [width, setWidth] = createSignal(34)
  const [focused, setFocused] = createSignal(false)
  const [scrollTop, setScrollTop] = createSignal(0)
  const byID = createMemo(() => new Map(props.rows.map((row) => [row.session.id, row])))
  const window = createMemo(() =>
    rowWindow(
      props.rows.map((row) => row.session.id),
      scrollTop(),
      props.maxVisibleRows,
    ),
  )
  let box: BoxRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  let previous: Renderable | null = null
  const focus = () => {
    // A tab/sidebar can be retained by the host while its layout is hidden.
    // Inspect only our own renderable, never the host's tree or breakpoint.
    if (
      !box ||
      box.isDestroyed ||
      !box.visible ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.screenX >= context.renderer.width ||
      box.screenY >= context.renderer.height
    )
      return false
    if (!box?.focused) previous = context.renderer.currentFocusedRenderable
    box?.focus()
    setFocused(true)
    if (!selected()) setSelected(props.rows[0]?.session.id)
    revealSelection()
    return true
  }
  const dismiss = () => {
    box?.blur()
    setFocused(false)
    if (previous && !previous.isDestroyed) previous.focus()
    previous = null
  }
  const unregisterFocus = props.registerFocus(focus)
  onCleanup(() => {
    unregisterFocus()
    if (box?.focused) dismiss()
  })
  createEffect(() => {
    const rows = props.rows
    if (!rows.some((row) => row.session.id === selected())) setSelected(rows[0]?.session.id)
  })
  const syncScroll = () => setScrollTop(scroll?.scrollTop ?? 0)
  function revealSelection() {
    const index = props.rows.findIndex((row) => row.session.id === selected())
    if (!scroll || index < 0) return
    const top = index * 3
    const height = scroll.viewport.height || props.maxVisibleRows * 3
    if (top < scroll.scrollTop) scroll.scrollTo(top)
    else if (top + 3 > scroll.scrollTop + height) scroll.scrollTo(top + 3 - height)
    syncScroll()
  }
  const activate = (row: AttentionRow) => {
    dismiss()
    openSession(context, row)
    // Native route rendering owns session.view and its exact idle token. Merely
    // mounting this inbox or opening a background tab never acknowledges it.
  }
  const move = (delta: number) => {
    const index = props.rows.findIndex((row) => row.session.id === selected())
    const row = props.rows[Math.max(0, Math.min(props.rows.length - 1, index + delta))]
    if (row) {
      setSelected(row.session.id)
      revealSelection()
    }
  }
  context.keymap.layer(() => ({
    mode: "global",
    target: () => box,
    priority: 10,
    commands: [
      { id: "attention-inbox.move-down", bind: "down", run: () => move(1) },
      { id: "attention-inbox.move-up", bind: "up", run: () => move(-1) },
      {
        id: "attention-inbox.activate",
        bind: "return",
        run: () => {
          const row = props.rows.find((row) => row.session.id === selected())
          if (row) activate(row)
        },
      },
      { id: "attention-inbox.dismiss", bind: "escape", run: dismiss },
      { id: "attention-inbox.scope.local", bind: "tab", run: props.toggleScope },
    ],
  }))
  const health = () => inboxHealth(props.snapshot.phase, props.rows.length, props.scope, props.projectKnown)
  const measure = () => {
    const viewport = scroll && !scroll.isDestroyed ? scroll.viewport.width : 0
    setWidth(Math.max(1, viewport || (box?.width ?? 36) - 2))
  }
  return (
    <box
      ref={(value) => {
        box = value
        const onBlur = () => setFocused(false)
        value.on(RenderableEvents.BLURRED, onBlur)
        onCleanup(() => value.off(RenderableEvents.BLURRED, onBlur))
      }}
      flexDirection="column"
      flexShrink={1}
      focusable={true}
      border={["top"]}
      borderColor={context.theme.border.base}
      paddingTop={1}
      onSizeChange={measure}
    >
      <text
        fg={context.theme.text.strong}
        onMouseUp={(event) => {
          if (event.button === 0) focus()
        }}
        wrapMode="none"
      >
        {truncate(
          `Needs attention  ${props.rows.length}${props.snapshot.phase !== "ready" || (props.scope === "project" && !props.projectKnown) ? " · ?" : ""}`,
          width(),
        )}
      </text>
      <text
        fg={context.theme.text.muted}
        wrapMode="none"
        onMouseUp={(event) => {
          if (event.button === 0) props.toggleScope()
        }}
      >
        {truncate(`${props.scope === "all" ? "All projects" : "Current project"} ↔`, width())}
      </text>
      <Show when={health()}>
        <text fg={context.theme.text.muted} wrapMode="none">
          {truncate(health(), width())}
        </text>
      </Show>
      <Show when={props.rows.length}>
        <scrollbox
          ref={(value) => {
            scroll = value
            measure()
            value.verticalScrollBar.on("change", syncScroll)
            onCleanup(() => value.verticalScrollBar.off("change", syncScroll))
          }}
          onSizeChange={() => {
            measure()
            syncScroll()
          }}
          onMouseScroll={() => queueMicrotask(syncScroll)}
          maxHeight={props.maxVisibleRows * 3}
          flexShrink={1}
        >
          <box height={window().before} flexShrink={0} />
          <For each={window().ids}>
            {(id) => {
              const row = () => byID().get(id)
              const status = () => {
                const current = row()
                return current ? statusLabel(current) : ""
              }
              const label = () => {
                const current = row()
                return current ? rowContext(current, width()) : ""
              }
              const active = () => selected() === id && focused()
              return (
                <box
                  id={`attention-inbox-${id}`}
                  flexDirection="column"
                  height={3}
                  flexShrink={0}
                  onMouseDown={(event) => {
                    if (event.button === 0) {
                      focus()
                      setSelected(id)
                    }
                  }}
                  onMouseUp={(event) => {
                    const current = row()
                    if (event.button === 0 && current) activate(current)
                  }}
                >
                  <text fg={active() ? context.theme.text.strong : context.theme.text.base} wrapMode="none">
                    {truncate(
                      `${active() ? "› " : ""}${row()?.session.title?.trim() || "Untitled session"}`,
                      width(),
                    )}
                  </text>
                  <text fg={context.theme.text.feedback.warning.base} wrapMode="none">
                    {truncate(status(), width())}
                  </text>
                  <text fg={context.theme.text.muted} wrapMode="none">
                    {label()}
                  </text>
                </box>
              )
            }}
          </For>
          <box height={window().after} flexShrink={0} />
        </scrollbox>
      </Show>
      <Show when={focused()}>
        <text fg={context.theme.text.muted} wrapMode="none">
          {truncate("↑↓ select · Enter open · Esc back", width())}
        </text>
      </Show>
    </box>
  )
}
