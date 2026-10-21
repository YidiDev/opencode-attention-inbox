# Security

This plugin runs inside your OpenCode CLI. It reads session metadata and pending
request lists through the authenticated client provided by that host, across the
connected server. The API necessarily returns request contents, but the adapter
immediately drops them; they are not rendered, persisted, or logged.

Only the scope preference is stored. Titles and path labels are untrusted text:
terminal controls, ANSI links/colors and bidi overrides are stripped before
display. Navigation uses session IDs, never shell commands or title text. The
plugin cannot approve requests or answer questions through its UI.

The optional server half registers `attention-inbox.settings`, returning only
bounded configuration. It exposes no filesystem check, session data or custom
mutation RPC. The plugin does not traverse host renderable internals or read the
OpenCode database.

The development install overrides Solid 1.9.12's Seroval dependency to patched
1.6.3 (GHSA-p6vx-979v-rg4c and GHSA-jp82-f5mq-hwhp). This plugin does not call
Seroval or bundle Solid/OpenTUI. OpenCode supplies the runtime, so this override
does not patch the host's own dependencies; keep the host updated separately.

This is a private derivative with no npm release, not a release maintained by the original
session-history authors. Report vulnerabilities privately to this checkout's
maintainer; do not send derivative reports to the upstream project or include
credentials/request contents in public issues.
