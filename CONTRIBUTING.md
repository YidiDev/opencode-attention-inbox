# Contributing

## Supported environment

Linux x64, Bun **1.4.0**, OpenCode **2.1.4**. The plugin/client packages and
`scripts/host-artifact.json` must stay aligned. Other versions are not supported
merely because the scheduled latest-host canary succeeds.

```sh
bun install --frozen-lockfile
bun run build
bun run check
bun run test:live
```

`check` requires npm for archive verification, in addition to Bun. Live tests also
require Git, tar, tmux and OpenCode. They use an extracted package,
isolated HOME/XDG directories and their own authenticated server, without model
calls or inherited provider credentials. Never point them at a real user's data.
For one file use `bun test --preload @opentui/solid/preload tests/attention.test.ts`.

`dist` is committed. Build after source changes, then review and commit it.
`check` deliberately does **not** build first: packaging tests compare an isolated
temporary build against the untouched checkout, including added/deleted files.
Formatting and linting use Biome. Coverage instruments actual source, including
Solid components and setup, and checks every executable source file against
`coverage-policy.json`: 95% lines, 85% branches, 95% functions, with no exceptions.
Type-only model/port files contain no executable code.

## Architecture and invariants

- `src/attention`: pure derivation, sorting and scope rules.
- `src/data`: minimal public API projection, reconciliation and read deadlines.
- `src/ui`: host-themed, virtualized, focus-local navigation; shared picker state.
- `src/tui.tsx`: setup-owned lifecycle, commands, preferences and slot wiring.

Never approve permissions, answer forms, fetch transcripts or infer a successful
completion from inactivity. Native idle/viewed tokens own read acknowledgment.
Unknown/stale/partial state must not become a verified empty inbox. Subscribe
before reading, bound concurrency, cancel timed-out/sibling reads, and clean up
on reload. Preserve focus, stable session identity and manual scroll on updates.
Do not bundle a second Solid/OpenTUI runtime or remove the universal precompile.
Never log titles, raw paths, questions, answers, credentials or transcript content.

Add regression tests for behavior changes. Exercise real OpenTUI components as
well as pure rules; mocks alone cannot establish focus, reactivity or packaging.

## Automation

PR/main CI runs deterministic checks and packed real-TUI acceptance on the pinned
host. Security CI audits dependencies, scans full Git history with redacted
Gitleaks output and checks workflows with Actionlint. The latest-host canary is
scheduled/manual and separate from the supported-version gate. Workflows use
read-only permissions and immutable action pins. The separate release workflow
grants publishing permissions only to its OIDC/GitHub-release jobs; it never uses
long-lived npm tokens. See [RELEASING.md](RELEASING.md).
Only sanitized terminal captures are uploaded, not databases or temporary homes.

Renovate configuration is included; the owner must separately install/enable the
Renovate GitHub App. Review host/SDK updates together and update the official npm
artifact URL and SHA-512 pin. `scripts/install-host.ts` verifies integrity before
extracting the executable; it does not execute an unversioned install script.

Configure required checks/branch rules when the repository's GitHub plan permits.
The presence of workflows alone does not establish enforced protection.

## Before public visibility or release

1. Obtain explicit owner approval for visibility and npm publication. Use the
   reviewed version/tag process in RELEASING.md; never publish on arbitrary merges.
2. Scan full history and the working tree for secrets; review attribution, package
   contents, compatibility statements and captured evidence for private data.
3. Run frozen install, build, check, audit, workflow checks and packed live tests;
   verify supported-version GitHub Actions succeed on the exact release commit.
4. Enable and verify private vulnerability reporting, and confirm the reporting
   instructions in `SECURITY.md` actually work for external reporters.
5. Review dependency licenses, keep `LICENSE`/`NOTICE`, update `CHANGELOG.md`, and
   configure required checks where available. Do not claim untested platforms.
6. Review the packed archive. The release workflow tests the exact tarball before
   OIDC publication and verifies registry bytes and native package installation.
