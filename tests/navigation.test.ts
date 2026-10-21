import { expect, test } from "bun:test"
import type { Context } from "@opencode/plugin/tui/context"
import { openSession } from "../src/ui/navigation.js"
import { deriveRows } from "../src/attention/derive.js"
import { session, snapshot } from "./support.js"

for (const [enabled, accepted, child, expected] of [
  [true, true, false, ["focus:b"]],
  [true, false, false, ["focus:b", "route:b"]],
  [false, false, false, ["route:b"]],
  [true, true, true, ["focus:b", "route:b"]],
] as const) test(`navigation tabs=${enabled} accepted=${accepted} child=${child}`, () => {
  const calls: string[] = []
  const ui = { tabs: { enabled: () => enabled, focus: (id: string) => { calls.push(`focus:${id}`); return accepted } },
    router: { navigate: ({ sessionID }: { sessionID: string }) => { calls.push(`route:${sessionID}`) } } } as unknown as Context["ui"]
  const row = deriveRows(snapshot({ sessions: [session("b", { parentID: child ? "parent" : undefined,
    projectID: "other", location: { directory: "/other/worktree" } })],
    pending: [{ id: "p", sessionID: "b", kind: "permission", since: 1 }] }))[0]!
  openSession({ ui }, row)
  expect(calls).toEqual([...expected])
  // There is deliberately no reply/view API in this navigation boundary.
  expect(row.permissions).toBe(1)
})
