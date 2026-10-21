/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui"
import { RenderableEvents, type BoxRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { AttentionRow, Snapshot } from "../attention/model.js"
import type { Scope } from "../options.js"
import { statusLabel } from "../attention/derive.js"
import { directoryLabel, truncate } from "./text.js"
import { openSession } from "./navigation.js"

export function Inbox(props: {
  rows: readonly AttentionRow[]; snapshot: Snapshot; scope: Scope; projectKnown: boolean
  maxVisibleRows: number; toggleScope: () => void
  registerFocus: (focus: (() => boolean) | undefined) => void
}) {
  const context = usePlugin()
  const [selected, setSelected] = createSignal<string>()
  const [width, setWidth] = createSignal(34)
  const [focused, setFocused] = createSignal(false)
  let box: BoxRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  let previous: Renderable | null = null
  const focus = () => {
    // A tab/sidebar can be retained by the host while its layout is hidden.
    // Inspect only our own renderable, never the host's tree or breakpoint.
    if (!box || box.isDestroyed || !box.visible || box.width <= 0 || box.height <= 0 ||
      box.screenX >= context.renderer.width || box.screenY >= context.renderer.height) return false
    if (!box?.focused) previous = context.renderer.currentFocusedRenderable
    box?.focus()
    setFocused(true)
    if (!selected()) setSelected(props.rows[0]?.session.id)
    return true
  }
  const dismiss = () => {
    box?.blur()
    setFocused(false)
    if (previous && !previous.isDestroyed) previous.focus()
    previous = null
  }
  props.registerFocus(focus)
  onCleanup(() => { props.registerFocus(undefined); if (box?.focused) dismiss() })
  createEffect(() => {
    const rows = props.rows
    if (!rows.some(row => row.session.id === selected())) setSelected(rows[0]?.session.id)
    const id = selected()
    if (id) scroll?.scrollChildIntoView(`attention-inbox-${id}`)
  })
  const activate = (row: AttentionRow) => {
    dismiss()
    openSession(context, row)
    // Native route rendering owns session.view and its exact idle token. Merely
    // mounting this inbox or opening a background tab never acknowledges it.
  }
  const move = (delta: number) => {
    const index = props.rows.findIndex(row => row.session.id === selected())
    const row = props.rows[Math.max(0, Math.min(props.rows.length - 1, index + delta))]
    if (row) setSelected(row.session.id)
  }
  context.keymap.layer(() => ({
    target: () => box, priority: 10,
    commands: [
      { id: "attention-inbox.move-down", bind: "down", run: () => move(1) },
      { id: "attention-inbox.move-up", bind: "up", run: () => move(-1) },
      { id: "attention-inbox.activate", bind: "return", run: () => {
        const row = props.rows.find(row => row.session.id === selected()); if (row) activate(row)
      } },
      { id: "attention-inbox.dismiss", bind: "escape", run: dismiss },
      { id: "attention-inbox.scope.local", bind: "tab", run: props.toggleScope },
    ],
  }))
  const health = createMemo(() => {
    if (props.scope === "project" && !props.projectKnown) return "Resolving current project..."
    switch (props.snapshot.phase) {
      case "syncing": return "Syncing..."
      case "partial": return "Partial · still checking"
      case "stale": return "Stale · refresh to retry"
      case "ready": return props.rows.length ? "" : "Nothing needs attention"
    }
  })
  const measure = () => setWidth(Math.max(0, scroll?.viewport.width ?? (box?.width ?? 36) - 2))
  return <box ref={value => {
    box = value
    const onBlur = () => setFocused(false)
    value.on(RenderableEvents.BLURRED, onBlur)
    onCleanup(() => value.off(RenderableEvents.BLURRED, onBlur))
  }} flexDirection="column" flexShrink={1}
    focusable={true} border={["top"]} borderColor={context.theme.border.base}
    paddingTop={1} onSizeChange={measure}>
    <text fg={context.theme.text.strong} onMouseUp={event => { if (event.button === 0) focus() }} wrapMode="none">
      {truncate(`Needs attention  ${props.rows.length}${props.snapshot.phase !== "ready" ? " · ?" : ""}`, width())}
    </text>
    <text fg={context.theme.text.muted} wrapMode="none" onMouseUp={event => { if (event.button === 0) props.toggleScope() }}>
      {truncate(`${props.scope === "all" ? "All projects" : "Current project"} ↔`, width())}
    </text>
    <Show when={health()}><text fg={context.theme.text.muted} wrapMode="none">{truncate(health(), width())}</text></Show>
    <Show when={props.rows.length}>
      <scrollbox ref={value => { scroll = value; measure() }} onSizeChange={measure}
        maxHeight={props.maxVisibleRows * 3} flexShrink={1}>
        <For each={props.rows}>{row => {
          const active = () => selected() === row.session.id && focused()
          return <box id={`attention-inbox-${row.session.id}`} flexDirection="column" height={3} flexShrink={0}
            onMouseDown={event => { if (event.button === 0) { focus(); setSelected(row.session.id) } }}
            onMouseUp={event => { if (event.button === 0) activate(row) }}>
            <text fg={active() ? context.theme.text.strong : context.theme.text.base} wrapMode="none">
              {truncate(`${active() ? "› " : ""}${row.session.title?.trim() || "Untitled session"}`, width())}
            </text>
            <text fg={context.theme.text.feedback.warning.base} wrapMode="none">{truncate(statusLabel(row), width())}</text>
            <text fg={context.theme.text.muted} wrapMode="none">
              {truncate(`${directoryLabel(row.session.location.directory)}${row.session.parentID ? ` · child of ${row.parentTitle ?? row.session.parentID}` : ""}`, width())}
            </text>
          </box>
        }}</For>
      </scrollbox>
    </Show>
    <Show when={focused()}><text fg={context.theme.text.muted} wrapMode="none">{truncate("↑↓ select · Enter open · Esc back", width())}</text></Show>
  </box>
}
