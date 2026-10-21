/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { PluginContextProvider } from "@opencode/plugin/tui"
import type { Context, KeymapCommand } from "@opencode/plugin/tui/context"
import type { Renderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import { deriveRows } from "../src/attention/derive.js"
import { Inbox } from "../src/ui/inbox.js"
import { session, snapshot } from "./support.js"

async function fixture(count = 12) {
  const rows = deriveRows(
    snapshot({
      sessions: Array.from({ length: count }, (_, index) => session(`s${index}`, { title: `Row ${index}` })),
      pending: Array.from({ length: count }, (_, index) => ({
        id: `q${index}`,
        sessionID: `s${index}`,
        kind: "question",
        since: index,
      })),
    }),
  )
  const [state, setState] = createSignal(snapshot())
  const [items, setItems] = createSignal(rows)
  const commands = new Map<string, KeymapCommand>()
  let focus: (() => boolean) | undefined
  let toggles = 0
  const opened: string[] = []
  const context = {
    theme: {
      text: { strong: "white", base: "white", muted: "gray", feedback: { warning: { base: "yellow" } } },
      border: { base: "gray" },
    },
    keymap: {
      layer: (get: () => { mode?: string; target?: () => unknown; commands: KeymapCommand[] }) => {
        const layer = get()
        // Explicit focus must retain Escape/arrow handling even when a host
        // autocomplete mode was active; the renderable target still scopes it.
        expect(layer.mode).toBe("global")
        expect(layer.target).toBeFunction()
        for (const command of layer.commands) commands.set(command.id!, command)
        onCleanup(() => commands.clear())
      },
    },
    ui: {
      tabs: { enabled: () => false },
      router: { navigate: ({ sessionID }: { sessionID: string }) => opened.push(sessionID) },
    },
  } as unknown as Context
  const view = await testRender(
    () => (
      <PluginContextProvider value={context}>
        <Inbox
          rows={items()}
          snapshot={state()}
          scope="all"
          projectKnown={true}
          maxVisibleRows={4}
          toggleScope={() => {
            toggles++
          }}
          registerFocus={(callback) => {
            focus = callback
            return () => {
              focus = undefined
            }
          }}
        />
      </PluginContextProvider>
    ),
    { width: 38, height: 24 },
  )
  Object.defineProperty(context, "renderer", { value: view.renderer })
  await view.renderOnce()
  const run = async (id: string) => {
    await commands.get(`attention-inbox.${id}`)!.run!()
    await view.renderOnce()
  }
  const row = (id: string) => view.renderer.root.findDescendantById(`attention-inbox-${id}`)
  const descendants = (node: Renderable): Renderable[] => [
    node,
    ...node.getChildren().flatMap((child) => descendants(child as Renderable)),
  ]
  const scroll = () =>
    descendants(view.renderer.root).find((node) => "scrollTop" in node) as ScrollBoxRenderable
  return {
    view,
    focus: () => focus?.(),
    run,
    row,
    scroll,
    items,
    setItems,
    setState,
    commands,
    opened,
    mounted: () => descendants(view.renderer.root).filter((node) => node.id.startsWith("attention-inbox-s")),
    toggles: () => toggles,
  }
}

test("real OpenTUI component retains row identity, scroll and input focus across refresh/reorder", async () => {
  const f = await fixture(1000)
  try {
    expect(f.mounted().length).toBeLessThanOrEqual(6)
    const first = f.row("s0")
    f.setState(snapshot({ phase: "stale" }))
    f.setItems(f.items().map((row) => ({ ...row, session: { ...row.session } })))
    await f.view.renderOnce()
    expect(f.row("s0")).toBe(first)
    expect(f.focus()).toBe(true)
    for (let i = 0; i < 10; i++) await f.run("move-down")
    expect(f.view.captureCharFrame()).toContain("› Row 10")
    expect(f.mounted().length).toBeLessThanOrEqual(6)
    await f.run("dismiss")
    const top = f.scroll().scrollTop
    f.setState(snapshot({ phase: "ready" }))
    f.setItems([...f.items()].reverse())
    await f.view.renderOnce()
    expect(f.scroll().scrollTop).toBe(top)
    expect(f.view.captureCharFrame()).not.toContain("Esc back")
  } finally {
    await f.view.dispose()
  }
  expect(f.focus()).toBeUndefined()
  expect(f.commands.size).toBe(0)
})

test("keyboard selection stays by ID, navigation never answers, deletion and scope are safe", async () => {
  const f = await fixture()
  try {
    f.focus()
    await f.run("move-down")
    f.setItems([...f.items()].reverse())
    await f.view.renderOnce()
    await f.run("activate")
    expect(f.opened).toEqual(["s1"])
    f.setItems(f.items().filter((row) => row.session.id !== "s1"))
    f.focus()
    await f.run("scope.local")
    expect(f.toggles()).toBe(1)
    await f.run("activate")
    expect(f.opened).toEqual(["s1", "s11"])
    f.setItems([])
    await f.view.renderOnce()
    await f.run("activate")
    expect(f.opened).toHaveLength(2)
    expect(f.view.captureCharFrame()).toContain("Nothing needs attention")
  } finally {
    await f.view.dispose()
  }
})

test("mouse wheel virtualizes new rows without focus or refresh scroll jumps", async () => {
  const f = await fixture(100)
  try {
    const first = f.scroll().scrollTop
    for (let i = 0; i < 8; i++) await f.view.mockMouse.scroll(10, 8, "down")
    await f.view.renderOnce()
    expect(f.scroll().scrollTop).toBeGreaterThan(first)
    expect(f.mounted().length).toBeLessThanOrEqual(6)
    expect(f.view.captureCharFrame()).not.toContain("Esc back")
    expect(f.view.captureCharFrame()).toContain("Row")
    const top = f.scroll().scrollTop
    f.setItems([...f.items()])
    await f.view.renderOnce()
    expect(f.scroll().scrollTop).toBe(top)
  } finally {
    await f.view.dispose()
  }
})

test("mouse controls accept only primary clicks; hidden or destroyed inbox cannot steal focus", async () => {
  const f = await fixture(2)
  try {
    await f.view.mockMouse.click(4, 3, 2)
    expect(f.toggles()).toBe(0)
    await f.view.mockMouse.click(4, 3, 0)
    expect(f.toggles()).toBe(1)
    await f.view.mockMouse.click(4, 2, 0)
    await f.view.renderOnce()
    expect(f.view.captureCharFrame()).toContain("Esc back")
    await f.run("move-up")
    const row = f.row("s0")!
    await f.view.mockMouse.click(row.screenX + 2, row.screenY, 2)
    expect(f.opened).toEqual([])
    await f.view.mockMouse.click(row.screenX + 2, row.screenY, 0)
    expect(f.opened).toEqual(["s0"])
    const box = f.view.renderer.root.getChildren()[0]!
    box.visible = false
    expect(f.focus()).toBe(false)
    box.visible = true
    f.focus()
    await f.view.renderOnce()
  } finally {
    await f.view.dispose()
  }
})
