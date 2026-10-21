import { afterAll } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { transformAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import istanbul from "babel-plugin-istanbul"
import solid from "babel-preset-solid"
import { plugin } from "bun"

const root = resolve(import.meta.dir, "..")
plugin({
  name: "inbox-source-coverage",
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\].*\.tsx?$/ }, async ({ path }) => {
      if (!path.startsWith(`${root}/src/`)) return undefined
      const result = await transformAsync(readFileSync(path, "utf8"), {
        filename: path,
        configFile: false,
        babelrc: false,
        presets: [
          ...(path.endsWith(".tsx")
            ? [[solid, { moduleName: "@opentui/solid", generate: "universal" }]]
            : []),
          typescript,
        ],
        plugins: [[istanbul, { cwd: root, include: ["src/**"], exclude: [], extension: [".ts", ".tsx"] }]],
      })
      if (!result?.code) throw new Error("Coverage transform produced no output")
      return { contents: result.code, loader: "js" }
    })
  },
})
// Same Solid runtime substitution as the host; our instrumentation owns src loads.
await import("@opentui/solid/preload")
afterAll(() => {
  mkdirSync(resolve(root, "coverage"), { recursive: true })
  writeFileSync(resolve(root, "coverage/coverage-final.json"), JSON.stringify(globalThis.__coverage__ ?? {}))
})
