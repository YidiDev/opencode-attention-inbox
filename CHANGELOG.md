# Changelog

## Unreleased

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
