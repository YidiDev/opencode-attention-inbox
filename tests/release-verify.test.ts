import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { verifyPublication } from "../scripts/release-verify.ts"

const bytes = new TextEncoder().encode("tested release archive")
const publication = {
  version: "1.0.0",
  filename: "opencode-attention-inbox-1.0.0.tgz",
  distTag: "latest",
  integrity: "sha512-tested",
  sha256: createHash("sha256").update(bytes).digest("hex"),
}
const dist = {
  integrity: publication.integrity,
  tarball: `https://registry.npmjs.org/opencode-attention-inbox/-/${publication.filename}`,
}

test("registry verification waits for missing versions and lagging tags without real sleeps", async () => {
  let time = 0
  let downloads = 0
  await verifyPublication(publication, {
    async json(url) {
      if (url.endsWith("/1.0.0")) return time < 20_000 ? undefined : { dist }
      return { "dist-tags": { latest: time < 40_000 ? "0.9.0" : "1.0.0" } }
    },
    async bytes() {
      downloads++
      return bytes
    },
    now: () => time,
    async sleep(milliseconds) {
      time += milliseconds
    },
  })
  expect(time).toBe(40_000)
  expect(downloads).toBe(3)
})

test("registry verification fails immediately on integrity, URL or byte mismatch", async () => {
  for (const kind of ["integrity", "url", "bytes"]) {
    let sleeps = 0
    await expect(
      verifyPublication(publication, {
        async json() {
          return {
            dist: {
              ...dist,
              ...(kind === "integrity" ? { integrity: "different" } : {}),
              ...(kind === "url" ? { tarball: "https://example.com/archive.tgz" } : {}),
            },
          }
        },
        async bytes() {
          return new Uint8Array()
        },
        now: () => 0,
        async sleep() {
          sleeps++
        },
      }),
    ).rejects.toThrow()
    expect(sleeps).toBe(0)
  }
})

test("missing registry versions or tags stop at the bounded deadline", async () => {
  for (const missing of ["version", "tag"]) {
    let time = 0
    await expect(
      verifyPublication(
        publication,
        {
          async json(url) {
            return missing === "tag" && url.endsWith("/1.0.0") ? { dist } : undefined
          },
          async bytes() {
            return bytes
          },
          now: () => time,
          async sleep(milliseconds) {
            time += milliseconds
          },
        },
        25_000,
      ),
    ).rejects.toThrow("did not become available")
    expect(time).toBe(25_000)
  }
})
