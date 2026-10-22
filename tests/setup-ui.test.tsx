/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { PluginContextProvider } from "@opencode/plugin/tui"
import type { Context, DialogSelectOptions, KeymapCommand } from "@opencode/plugin/tui/context"
import { type JSX, testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import tuiPlugin from "../src/tui.js"
import { session, theme, until } from "./support.js"

test("mounted setup focuses the active footer, opens next, uses route project, and cleans settings retries", async () => {
  const commands = new Map<string, KeymapCommand>()
  const toasts: string[] = []
  const opened: string[] = []
  const [route, setRoute] = createSignal({ type: "session", sessionID: "cached" })
  let renderSlot: (() => JSX.Element) | undefined
  let retryCalls = 0
  let picker: DialogSelectOptions<string> | undefined
  const context = {
    location: { directory: "/a" },
    options: { defaultScope: "all" },
    theme,
    client: {
      rpc: () => ({
        settings: async () => {
          retryCalls++
          throw new Error("offline")
        },
      }),
      session: { list: async () => ({ data: [session("a")], cursor: {} }), active: async () => ({}) },
      permission: { request: { list: async () => ({ data: [] }) } },
      form: { list: async () => ({ data: [{ id: "q", sessionID: "a" }] }) },
    },
    storage: {
      store: () => [
        { scope: "project" },
        async () => {
          throw new Error("storage unavailable")
        },
      ],
    },
    data: {
      location: { default: () => ({ directory: "/wrong" }) },
      project: {
        sync: async () => {
          throw new Error("unavailable")
        },
        list: () => [],
      },
      session: { get: () => ({ projectID: "project-a" }) },
      listen: () => () => {},
    },
    keymap: {
      layer: (get: () => { commands: KeymapCommand[] }) => {
        for (const command of get().commands) commands.set(command.id!, command)
      },
    },
    ui: {
      router: { current: route, navigate: ({ sessionID }: { sessionID: string }) => opened.push(sessionID) },
      tabs: { enabled: () => false },
      toast: { show: ({ message }: { message: string }) => toasts.push(message) },
      slot: ({ render }: { render: () => JSX.Element }) => {
        renderSlot = render
        return () => {}
      },
      dialog: {
        select: async (options: DialogSelectOptions<string>) => {
          picker = options
          return "a"
        },
      },
    },
  } as unknown as Context
  function Setup() {
    tuiPlugin.setup(context)
    return renderSlot!()
  }
  const view = await testRender(
    () => (
      <PluginContextProvider value={context}>
        <Setup />
      </PluginContextProvider>
    ),
    { width: 40, height: 24 },
  )
  Object.defineProperty(context, "renderer", { value: view.renderer })
  try {
    await until(() => view.renderer.root.findDescendantById("attention-inbox-a") !== undefined)
    await view.renderOnce()
    await commands.get("attention-inbox.focus")!.run!()
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("Esc back")
    expect(picker).toBeUndefined()
    await commands.get("attention-inbox.dismiss")!.run!()
    await commands.get("attention-inbox.scope.toggle")!.run!()
    await until(() => toasts.length > 0)
    expect(toasts).toContain("Could not save inbox scope")
    await commands.get("attention-inbox.open-next")!.run!()
    expect(opened).toEqual(["a"])
    setRoute({ type: "session", sessionID: "a" })
    await Bun.sleep(1050)
    expect(retryCalls).toBe(2)
    await view.renderOnce()
    view.renderer.root.getChildren()[0]!.visible = false
    await commands.get("attention-inbox.focus")!.run!()
    expect(opened).toEqual(["a", "a"])
    expect(picker!.options[0]!.value).toBe("a")
  } finally {
    await view.dispose()
  }
  const calls = retryCalls
  await Bun.sleep(1050)
  expect(retryCalls).toBe(calls)
})
