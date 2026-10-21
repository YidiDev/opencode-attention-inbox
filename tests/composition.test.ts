import { expect, test } from "bun:test"
import type { Context, DialogSelectOptions, KeymapCommand } from "@opencode/plugin/tui/context"
import { createRoot, createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import serverPlugin from "../src/index.js"
import tuiPlugin from "../src/tui.js"
import { deferred, session, until } from "./support.js"

test("setup picker is reactive, shares uncertainty semantics, and never navigates a removed row", async () => {
  const commands = new Map<string, KeymapCommand>()
  const toasts: string[] = []
  const routes: unknown[] = []
  const pending = deferred<string | undefined>()
  let picker: DialogSelectOptions<string> | undefined
  let listener: (event: unknown) => void = () => {}
  let stopped = false
  let slotStopped = false
  let requests = [{ id: "q", sessionID: "a" }]
  const [projects, setProjects] = createSignal<{ id: string; canonical: string; sandboxes: string[] }[]>([])
  const [preferences, setPreferences] = createStore<{ scope?: string }>({})
  const context = {
    options: { pollIntervalMs: 5000 },
    client: {
      rpc: () => ({ settings: async () => ({ options: { maxVisibleRows: 8 } }) }),
      session: { list: async () => ({ data: [session("a")], cursor: {} }), active: async () => ({}) },
      permission: { request: { list: async () => ({ data: [] }) } },
      form: { list: async () => ({ data: requests }) },
    },
    storage: {
      store: () => [
        preferences,
        async (update: (draft: typeof preferences) => void) => setPreferences(produce(update)),
      ],
    },
    data: {
      location: { default: () => ({ directory: "/a" }) },
      project: { sync: async () => {}, list: projects },
      session: { get: () => undefined },
      listen: (handler: typeof listener) => {
        listener = handler
        return () => {
          stopped = true
        }
      },
    },
    keymap: {
      layer: (get: () => { commands: KeymapCommand[] }) => {
        for (const command of get().commands) commands.set(command.id!, command)
      },
    },
    ui: {
      router: { current: () => ({ type: "home" }), navigate: (route: unknown) => routes.push(route) },
      tabs: { enabled: () => false },
      toast: { show: ({ message }: { message: string }) => toasts.push(message) },
      slot: () => () => {
        slotStopped = true
      },
      dialog: {
        select: (options: DialogSelectOptions<string>) => {
          picker = options
          return pending.promise
        },
      },
    },
  } as unknown as Context
  const dispose = createRoot((dispose) => {
    tuiPlugin.setup(context)
    return dispose
  })
  try {
    await Bun.sleep(10)
    const selecting = commands.get("attention-inbox.focus")!.run!()
    expect(picker!.title).toContain("Resolving current project")
    expect(toasts).not.toContain("Nothing needs attention")
    expect(picker!.options).toEqual([])
    setProjects([{ id: "project-a", canonical: "/a", sandboxes: [] }])
    expect(picker!.options[0]!.value).toBe("a")
    expect(picker!.options[0]!.description).toContain("project-")
    await commands.get("attention-inbox.scope.toggle")!.run!()
    expect(preferences.scope).toBe("all")
    requests = []
    listener({ details: { type: "form.cancelled" } })
    expect(picker!.title).toContain("Stale")
    await until(() => picker!.options.length === 0 && picker!.title.includes("Nothing needs attention"))
    pending.resolve("a")
    await selecting
    expect(routes).toEqual([])
    await commands.get("attention-inbox.open-next")!.run!()
    expect(toasts).toContain("Nothing needs attention")
    await commands.get("attention-inbox.refresh")!.run!()
  } finally {
    dispose()
  }
  expect(stopped).toBe(true)
  expect(slotStopped).toBe(true)
})

test("server entry only exposes sanitized, bounded settings under the renamed RPC", async () => {
  let definition: unknown
  let read: (() => Promise<unknown>) | undefined
  const context = {
    options: { maxVisibleRows: 999, title: "private", pollIntervalMs: -5 },
    rpc: {
      register: async (rpc: unknown, handlers: { settings: () => Promise<unknown> }) => {
        definition = rpc
        read = handlers.settings
      },
    },
  }
  await serverPlugin.setup(context as unknown as Parameters<typeof serverPlugin.setup>[0])
  expect(JSON.stringify(definition)).toContain("attention-inbox")
  expect(await read!()).toEqual({
    options: {
      defaultScope: "project",
      maxVisibleRows: 8,
      pollIntervalMs: 5000,
      includeChildCompletions: false,
    },
  })
})
