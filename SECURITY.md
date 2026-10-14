# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately through GitHub's private vulnerability reporting:

1. Go to <https://github.com/ypxcs/opencode-session-history/security/advisories/new>
2. Describe the issue, the impact, and steps to reproduce.

If that is unavailable, open a minimal issue that only asks for a private
contact channel — do not include exploit details.

## Scope

This plugin runs inside the OpenCode process and can read session metadata and
filesystem paths. Relevant reports include, but are not limited to:

- Reading or exposing data beyond the configured OpenCode server.
- Path handling that could escape the intended session/project directory.
- Any code path that executes untrusted input.

## Exposed surface

The plugin registers one RPC, `session-history.check`, which reports whether
paths supplied by the caller exist (and are directories) on the server. It
requires API authentication, returns no file contents and no directory
listings, and is strictly less information than the server's own `fs.read`,
`fs.list` and `fs.find` routes. Requests are deduplicated, capped at 1000
directories, and checked with bounded concurrency.

## Supported versions

Only the latest published version is supported. Please reproduce against the
latest release before reporting.
