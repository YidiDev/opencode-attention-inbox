# Security

This repository is currently private and the npm package is unpublished.
The supported baseline is Linux x64, Bun 1.4.0 and OpenCode 2.1.4.

## Reporting

Do not open an issue containing a vulnerability, secret or session data. Repository
collaborators with access can draft a private advisory at
https://github.com/YidiDev/opencode-attention-inbox/security/advisories/new
for owner **YidiDev**. If your access does not permit this, contact the owner using
your existing private collaboration channel; there is no public reporting mailbox.
Private vulnerability reporting must be enabled and externally verified before
the repository is made public. No response-time guarantee is currently offered.

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
