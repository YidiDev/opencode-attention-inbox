# Changelog

## Unreleased

## 1.0.0-rc.2

- First publishable public v1 candidate, with YidiDev authorship and retained upstream MIT attribution.
- Support npm 11 and npm 12 archive metadata while preserving exact-tarball release verification.
- Correct native reload acceptance synchronization and distinguish native tabs from inbox rows.

## 1.0.0-rc.1

First public release candidate of OpenCode Attention Inbox, created and maintained
by YidiDev, derived from the MIT-licensed session-history project by Yash Patel.

- Compact, host-themed attention rows for pending permissions/questions and native
  successful unread completions; no inline approvals or automatic answers.
- Project/worktree and server-wide scopes, native navigation, live reconciliation,
  keyboard and mouse controls, hover highlighting and zero-height healthy emptiness.
- Tested baseline: OpenCode 2.1.4 on Linux x64. Child navigation uses the native
  Subagents panel; other platforms/host versions are not yet supported.
- Signed version-tag release process, exact-archive acceptance, token-free npm
  publishing after bootstrap, registry verification and GitHub release assets.

### Development history

- Remove sidebar heading, scope label, divider, padding, and reserved footer; show
  only session rows and compact uncertainty warnings, with zero space for a healthy
  empty inbox and safe focus release when its final row disappears.

- Replace three-line attention entries with compact, single-line tab-like rows,
  semantic theme hover/selection backgrounds, compact status indicators, and
  inline duplicate-title context. Hover never changes focus, selection or viewed state.
- Update virtual scrolling and pointer regression coverage for one-line rows,
  and verify visible hover highlighting in the packed native TUI.

- Coalesce repeated event uncertainty notifications without losing invalidations or request timestamps.
- Batch directory progress to bound full-inbox derivations while preserving early discovery.
- Bound optional settings RPC reads and cancel in-flight work/retries on reload.
- Document npm as a prerequisite for development/package verification.
- Fix scrolled-row clicks opening the wrong session; cancel clicks across row changes.
- Publish healthy-directory pending progress before unrelated slow reads settle.
- Preserve distinguishing project/worktree labels alongside long parent titles.
- Exercise cross-client scope propagation, scrolled clicks, short terminals and reconnects.

- Prevent slow-scan starvation; bound API reads and cancel failed sibling reads.
- Share truthful live health/context between the sidebar and fallback picker.
- Virtualize rows and preserve selection, manual scrolling and prompt focus.
- Verify source-level component coverage and untouched committed build freshness.
- Add pinned-host packed TUI CI, dependency/history/workflow security checks,
  latest-host canary and contribution/reporting templates.

## 0.1.0 — private development

- Standalone attention inbox derived from MIT-licensed session history.
- Native permission/question badges and successful unread completions.
- Project/worktree scope, native navigation and persistent scope preference.
- No npm publication or public release.
