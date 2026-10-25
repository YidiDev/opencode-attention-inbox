# Security

The supported baseline is Linux x64, Bun 1.4.0 and OpenCode 2.1.4.

## Reporting

Do not open an issue containing a vulnerability, secret or session data. Use
GitHub's private vulnerability reporting route:
https://github.com/YidiDev/opencode-attention-inbox/security/advisories/new
for maintainer **YidiDev**. Private vulnerability reporting must be enabled and
externally verified as part of the public launch. If the route is unavailable,
do not post sensitive details publicly: open a non-sensitive issue asking the
maintainer for a private reporting channel. No response-time guarantee is offered.

Security fixes target the latest supported 1.x version; prereleases and unsupported
host/platform combinations have no separate long-term support guarantee.

Include affected versions, a minimal sanitized reproduction and impact. Never
include real credentials, databases, prompts, answers or unsanitized captures.

## Boundaries

The plugin navigates sessions; it does not answer forms or approve permissions.
It uses the connected host's public authenticated API and native viewed markers.
Uncertainty remains explicit. Display strings strip terminal controls, and logs
must not include titles, raw paths or request contents. Preferences alone persist.

Live acceptance uses an isolated authenticated server, allowlisted environment
and synthetic sessions. Only sanitized text captures may be uploaded by CI.
Dependencies and history are scanned, but a passing scan is not a security audit.
The development Seroval override fixes a transitive advisory in the pinned Solid
toolchain; published output does not bundle Seroval, Solid or OpenTUI. The host
supplies its runtime, whose security updates remain the host owner's responsibility.
