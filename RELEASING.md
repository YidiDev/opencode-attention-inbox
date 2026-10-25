# Releasing

Project author/maintainer: **YidiDev**. MIT; retain both copyright notices and NOTICE.

## Versions and support

The first stable version is **1.0.0**, Git tag **v1.0.0**. Plugin versions are
independent of OpenCode versions. The tested baseline remains OpenCode **2.1.4**,
Bun **1.4.0**, Linux x64. A latest-host canary is not an expanded support promise.

The public contract covers documented options, commands, saved preferences,
attention semantics and supported hosts. Compatible fixes are patch releases;
additive compatible features are minor releases; breaking changes, including
dropping a supported host, require a major release. Prereleases use
`1.0.0-rc.1` (or alpha/beta), npm **next**, and GitHub prerelease status. Stable
versions use npm **latest**. Never publish an upstream project's inherited tags.

## Prepare and review

1. Update package.json and CHANGELOG.md in a release PR; refresh bun.lock if needed.
   Each version needs its own exact `## X.Y.Z` changelog heading. Keep notes curated.
2. Build changed source, then run frozen install, `bun run check`, `bun audit`,
   Actionlint and a full-history/working-tree secret scan. Review attribution,
   licenses, docs, archive contents and synthetic demo evidence.
3. Merge only with the supported-host quality, packed TUI and security checks green.
4. On that exact main commit, create and push a signed, immutable version tag:

   ```sh
   git tag -s v1.0.0 -m 'OpenCode Attention Inbox v1.0.0'
   git push origin refs/tags/v1.0.0
   ```

Never move, recreate or backdate a published release tag. Never overwrite npm
versions. No rolling `v1` Git tag is needed. Protect main and release tag creation,
updates and deletion using GitHub rulesets; allow releases only to trusted maintainers.

## Automated release

`.github/workflows/release.yml` checks the exact tag/version/changelog and that its
commit belongs to main, then runs quality, coverage, audit, history scanning and
workflow lint. It checks committed dist **without rebuilding first**, packs once,
and tests that exact archive in an isolated real TUI with dependencies installed.

The workflow creates a draft GitHub Release with the tested `.tgz`, SHA256SUMS and
release.json (commit and SHA-512 integrity). The npm job uses **OIDC**, with no
dependency installation or package lifecycle scripts and no long-lived npm token.
After publication it compares downloaded registry bytes with the tested archive
and verifies the distribution tag. A separate unprivileged job tests OpenCode's
actual registry loader with an empty HOME/config/cache. Only then is the GitHub
Release published. Prereleases never become GitHub latest.

Manual workflow dispatch performs validation/artifact preparation **only**, never
publication. Publishing is serialized and cannot be cancelled by a newer release.
Artifacts/captures contain only package files and synthetic sanitized evidence.

## One-time bootstrap and npm trust

The npm owner account is **yididev**, public project author **YidiDev**. Enable npm
2FA. Package name: `opencode-attention-inbox`. Availability is not a reservation.
No passwords, OTPs, private keys or npm tokens belong in GitHub/chat/source files.

npm requires an existing package before adding a trusted publisher:

1. Prepare/tag **1.0.0-rc.2**. The immutable RC1 tag failed validation before
   publication; it is not moved or reused. If the registry package does not exist, the workflow
   stops at the draft release and validated archive; it does not attempt OIDC.
2. Download the tested archive and SHA256SUMS from that run/draft. Check its hash.
   Using the owner's interactive npm login and 2FA, bootstrap **only that archive**:

   ```sh
   sha256sum -c SHA256SUMS
   npm publish ./opencode-attention-inbox-1.0.0-rc.2.tgz --ignore-scripts --access public --tag next
   ```

3. In npm package Settings → Trusted Publisher, configure **GitHub Actions**:
   - Organization/user: `YidiDev`
   - Repository: `opencode-attention-inbox`
   - Workflow filename: **`release.yml`** (no directory prefix)
   - Environment: **`npm`**
   - Explicitly allow **direct npm publish**, not just staged publishing.

   With interactive 2FA and a current npm CLI the equivalent is:

   ```sh
   npm trust github opencode-attention-inbox --repo YidiDev/opencode-attention-inbox --file release.yml --env npm --allow-publish
   ```

4. Rerun the tag workflow: it accepts an existing version only when its bytes are
   identical, verifies registry installation, and publishes the GitHub prerelease.
5. Publish **1.0.0-rc.3** through the tag workflow to actually exercise OIDC, then
   **1.0.0** after acceptance. npm requires a new trust configuration to complete
   its first successful publish within two days; recreate expired configurations.
6. Restrict traditional publishing to 2FA and disallow tokens. Bind the GitHub
   `npm` environment to version tags; add approval protection if desired. Node/npm
   used by release jobs are pinned; users do not need that publishing toolchain.

GitHub `id-token: write` alone does not establish npm trust. Account/package
settings and environment name must match exactly. Direct npm dist-tag management
is not granted by this policy. No GitHub App or personal token is required for
normal tag-triggered releases. npm automatically supplies provenance for OIDC
publishes from a public repository to a public package; the interactive bootstrap
does not have that provenance, so prerelease 2 verifies the final provenance path.

## Failed or bad releases

If npm succeeds but later steps fail, rerun the original tag workflow. Existing
archive bytes must match; mismatches fail closed. GitHub assets are reused only
when byte-identical, never clobbered. Do not rebuild a different archive under the
same version. If an already-public npm version is wrong, deprecate it with a
clear explanation and publish a new patch (or next prerelease) version. Never
force-push release history to repair a public release.

## Public launch checklist

- Verify full-history and working-tree scans and copyright/license inventory.
- Make source public before OIDC provenance publishing; review issues, descriptions
  and synthetic captures for private data. Update public package installation docs.
- Enable private vulnerability reporting and verify the external report route.
- Enforce required checks/main protection and release tag rules when available.
- Enable immutable GitHub releases when available (assets are attached to drafts
  before publication). Confirm npm 2FA and the exact trusted publisher settings.
- After stable publication, show a synthetic screenshot/demo and verified npm
  install example. Migrating the maintainer's local checkout install is optional;
  never silently rewrite somebody's existing CLI settings.

References: https://docs.npmjs.com/trusted-publishers and
https://docs.npmjs.com/cli/v12/commands/npm-trust
