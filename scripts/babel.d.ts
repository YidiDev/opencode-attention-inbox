/**
 * Minimal local typings for the Babel packages the build script uses. None of
 * them ship types (upstream `@opentui/solid` declares a `@types/babel__core`
 * devDependency for the same reason), and a hand-written declaration for the
 * two calls `scripts/build.ts` makes keeps the build dependency-free.
 */
declare module "@babel/core" {
  export function transformAsync(
    code: string,
    options: {
      filename?: string
      configFile?: boolean
      babelrc?: boolean
      presets?: unknown[]
      plugins?: unknown[]
    },
  ): Promise<{ code?: string | null } | null>
}

declare module "@babel/preset-typescript" {
  const preset: unknown
  export default preset
}

declare module "babel-preset-solid" {
  const preset: unknown
  export default preset
}
