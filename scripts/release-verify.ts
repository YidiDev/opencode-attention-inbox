import { createHash } from "node:crypto"

type Publication = {
  version: string
  filename: string
  integrity: string
  sha256: string
  distTag: string
}
type Ports = {
  json(url: string): Promise<Record<string, unknown> | undefined>
  bytes(url: string): Promise<Uint8Array>
  now(): number
  sleep(milliseconds: number): Promise<void>
}

/** Registry/CDN metadata can lag a successful publish; different bytes never retry. */
export async function verifyPublication(data: Publication, ports: Ports, timeoutMs = 300_000) {
  const registry = "https://registry.npmjs.org"
  const name = "opencode-attention-inbox"
  const deadline = ports.now() + timeoutMs
  while (ports.now() < deadline) {
    const meta = await ports.json(`${registry}/${name}/${data.version}`)
    const dist = meta?.dist as { integrity?: string; tarball?: string } | undefined
    if (meta && dist?.integrity !== data.integrity)
      throw new Error("Registry version integrity does not match tested archive")
    if (dist?.tarball) {
      if (dist.tarball !== `${registry}/${name}/-/${data.filename}`)
        throw new Error("Unexpected registry tarball URL")
      const bytes = await ports.bytes(dist.tarball)
      if (createHash("sha256").update(bytes).digest("hex") !== data.sha256)
        throw new Error("Published bytes differ from tested bytes")
      const info = await ports.json(`${registry}/${name}`)
      if ((info?.["dist-tags"] as Record<string, string> | undefined)?.[data.distTag] === data.version) return
    }
    const remaining = deadline - ports.now()
    if (remaining > 0) await ports.sleep(Math.min(10_000, remaining))
  }
  throw new Error("Registry version or distribution tag did not become available")
}
