import { expect, test } from "bun:test"
import { deriveRows } from "../src/attention/derive.js"
import { projectForDirectory } from "../src/attention/scope.js"
import { inboxHealth, pickerOptions, rowContext, rowWindow } from "../src/ui/presentation.js"
import { truncateTail } from "../src/ui/text.js"
import { session, snapshot } from "./support.js"

test("every surface distinguishes unknown project, stale, partial, syncing and verified empty", () => {
  for (const phase of ["ready", "syncing", "partial", "stale"] as const) {
    expect(inboxHealth(phase, 0, "project", false)).toBe("Resolving current project...")
    expect(inboxHealth(phase, 0, "all", false)).not.toBe("Resolving current project...")
    if (phase !== "ready") expect(inboxHealth(phase, 0, "project", true)).not.toBe("Nothing needs attention")
  }
  expect(inboxHealth("ready", 0, "project", true)).toBe("Nothing needs attention")
  expect(inboxHealth("ready", 1, "project", true)).toBe("")
})

test("duplicate titles have distinct safe project/worktree context in the picker", () => {
  const rows = deriveRows(
    snapshot({
      sessions: [
        session("a", { title: "same\x1b[31m", location: { directory: "/projects/shared/worktree-one" } }),
        session("b", { title: "same\x1b[31m", location: { directory: "/projects/shared/worktree-two" } }),
      ],
      pending: ["a", "b"].map((id) => ({ id, sessionID: id, kind: "question" as const, since: 1 })),
    }),
  )
  const options = pickerOptions(rows)
  expect(options[0]!.title).toBe("same")
  expect(options[0]!.description).not.toBe(options[1]!.description)
  expect(rowContext(rows[0]!, 16)).toEndWith("worktree-one")
  expect(truncateTail("long/路径/emoji👩‍💻", 12)).toEndWith("emoji👩‍💻")
  expect(Bun.stringWidth(truncateTail("long/路径/emoji👩‍💻", 12))).toBeLessThanOrEqual(12)
  expect(truncateTail("abc", 0)).toBe("")
  expect(truncateTail("abc", 1)).toBe(".")
  expect(truncateTail("abc", 3)).toBe("abc")
})

test("virtual list bounds mounted rows independently of 100,000 session inventory", () => {
  const ids = Array.from({ length: 100_000 }, (_, i) => String(i))
  for (const offset of [0, 3, 150_000, 299_999, 999_999]) {
    const window = rowWindow(ids, offset, 4)
    expect(window.ids.length).toBeLessThanOrEqual(6)
    expect(window.before + window.ids.length * 3 + window.after).toBe(300_000)
  }
  expect(rowWindow([], 0, 4)).toEqual({ ids: [], before: 0, after: 0 })
})

test("child context, untitled fallback and root project boundary handling", () => {
  const row = deriveRows(
    snapshot({
      sessions: [session("a", { title: "", parentID: "unknown-parent" })],
      pending: [{ id: "q", sessionID: "a", kind: "question", since: 1 }],
    }),
  )[0]!
  expect(rowContext(row)).toContain("child of unknown-parent")
  expect(pickerOptions([row])[0]!.title).toBe("Untitled session")
  row.parentTitle = "Known parent"
  expect(rowContext(row)).toContain("child of Known parent")
  row.session.title = undefined
  expect(pickerOptions([row])[0]!.title).toBe("Untitled session")
  expect(
    projectForDirectory("/nested/project", [
      { id: "nested", canonical: "/nested", sandboxes: [] },
      { id: "root", canonical: "/", sandboxes: [] },
    ]),
  ).toBe("nested")
  expect(projectForDirectory("/elsewhere", [{ id: "root", canonical: "/", sandboxes: [] }])).toBe("root")
})
