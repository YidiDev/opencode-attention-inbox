import { afterEach, expect, test } from "bun:test"
import { syncSettings } from "../src/data/settings.js"
import { deferred, until } from "./support.js"

const stops: (() => void)[] = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

test("hung settings time out, abort, retry and ignore a late response", async () => {
  const hung = deferred<{ options: Record<string, unknown> }>()
  const applied: Record<string, unknown>[] = []
  let calls = 0
  let firstSignal: AbortSignal | undefined
  stops.push(
    syncSettings(
      async (signal) => {
        if (++calls === 1) {
          firstSignal = signal
          return hung.promise
        }
        return { options: { defaultScope: "all" } }
      },
      (options) => applied.push(options),
      { timeoutMs: 10, retryMs: 1 },
    ),
  )
  await until(() => applied.length === 1)
  expect(firstSignal!.aborted).toBe(true)
  expect(calls).toBe(2)
  expect(applied).toEqual([{ defaultScope: "all" }])
  hung.resolve({ options: { defaultScope: "project" } })
  await Bun.sleep(5)
  expect(applied).toEqual([{ defaultScope: "all" }])
})

test("disposal aborts in-flight settings, suppresses late application and never retries", async () => {
  const hung = deferred<{ options: Record<string, unknown> }>()
  let active: AbortSignal | undefined
  let calls = 0
  let applied = false
  const stop = syncSettings(
    async (signal) => {
      calls++
      active = signal
      return hung.promise
    },
    () => {
      applied = true
    },
    { timeoutMs: 1000, retryMs: 1 },
  )
  stops.push(stop)
  await until(() => active !== undefined)
  stop()
  expect(active!.aborted).toBe(true)
  hung.resolve({ options: {} })
  await Bun.sleep(10)
  expect(applied).toBe(false)
  expect(calls).toBe(1)
})

test("disposal before the initial read prevents any RPC", async () => {
  let calls = 0
  const stop = syncSettings(
    async () => {
      calls++
      return { options: {} }
    },
    () => {},
  )
  stop()
  await Bun.sleep(5)
  expect(calls).toBe(0)
})

test("disposal cancels a scheduled settings retry", async () => {
  let calls = 0
  const stop = syncSettings(
    async () => {
      calls++
      throw new Error("offline")
    },
    () => {},
    { retryMs: 30 },
  )
  stops.push(stop)
  await until(() => calls === 1)
  stop()
  await Bun.sleep(40)
  expect(calls).toBe(1)
})

test("missing RPC methods do not retry, and other failures stop after fifteen attempts", async () => {
  for (const error of [{ type: "rpc.method_not_found" }, null]) {
    let calls = 0
    stops.push(
      syncSettings(
        async () => {
          calls++
          throw error
        },
        () => {},
        { retryMs: 1 },
      ),
    )
    const expected = error ? 1 : 15
    await until(() => calls === expected)
    await Bun.sleep(10)
    expect(calls).toBe(expected)
  }
})
