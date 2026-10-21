import { expect, test } from "bun:test"
import type { Context } from "@opencode/plugin/tui/context"
import { createAdapter } from "../src/data/adapter.js"
import { session } from "./support.js"

test("adapter uses server-wide pagination, scoped requests, and drops request contents/metadata", async () => {
  const calls: unknown[] = []
  const context = {
    client: {
      session: {
        list: async (...args: unknown[]) => {
          calls.push(args)
          return { data: [{ ...session("a"), metadata: { secret: true } }], cursor: { next: "next" } }
        },
        active: async () => ({ a: { type: "running" } }),
      },
      permission: {
        request: {
          list: async (args: unknown) => {
            calls.push(args)
            return { data: [{ id: "p", sessionID: "a", message: "private", resources: ["secret"] }] }
          },
        },
      },
      form: {
        list: async (args: unknown) => {
          calls.push(args)
          return { data: [{ id: "q", sessionID: "a", fields: ["private"] }] }
        },
      },
    },
  } as unknown as Context
  const adapter = createAdapter(context)
  const signal = new AbortController().signal
  const page = await adapter.sessions("cursor", signal)
  expect(calls[0]).toEqual([{ limit: 100, order: "desc", cursor: "cursor" }, { signal }])
  expect(page.next).toBe("next")
  expect(page.data[0]).not.toHaveProperty("metadata")
  expect(await adapter.pending("/a", signal)).toEqual({
    permissions: [{ id: "p", sessionID: "a" }],
    questions: [{ id: "q", sessionID: "a" }],
  })
  expect(calls.slice(1)).toEqual([{ location: { directory: "/a" } }, { location: { directory: "/a" } }])
  expect(await adapter.active(signal)).toEqual(new Set(["a"]))
})

test("native form.created wraps form; relevant events invalidate, token/usage events do not", () => {
  let listener!: (event: unknown) => void
  let stopped = false
  const context = {
    data: {
      listen: (handler: typeof listener) => {
        listener = handler
        return () => {
          stopped = true
        }
      },
    },
  } as unknown as Context
  const adapter = createAdapter(context)
  const events: unknown[] = []
  const stop = adapter.listen((event) => events.push(event))
  for (const details of [
    { type: "permission.asked", created: 12, data: { id: "p" } },
    { type: "form.created", created: 13, data: { form: { id: "q" } } },
    { type: "session.viewed" },
    { type: "server.connected" },
    { type: "session.text.delta" },
    { type: "session.usage.updated" },
    { type: "session.metadata.updated" },
  ])
    listener({ details })
  expect(events).toEqual([
    { request: { id: "p", kind: "permission", created: 12 } },
    { request: { id: "q", kind: "question", created: 13 } },
    {},
    {},
  ])
  stop()
  expect(stopped).toBe(true)
})

test("a rejected pending read cancels its sibling before another scan", async () => {
  let sibling: AbortSignal | undefined
  const context = {
    client: {
      permission: {
        request: {
          list: async () => {
            throw new Error("offline")
          },
        },
      },
      form: {
        list: async (_: unknown, options: { signal: AbortSignal }) => {
          sibling = options.signal
          return new Promise((_, reject) =>
            options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
          )
        },
      },
    },
  } as unknown as Context
  await expect(createAdapter(context).pending("/a", new AbortController().signal)).rejects.toThrow("offline")
  expect(sibling?.aborted).toBe(true)
})
