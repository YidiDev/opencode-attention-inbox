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

## Supported versions

Only the latest published version is supported. Please reproduce against the
latest release before reporting.
