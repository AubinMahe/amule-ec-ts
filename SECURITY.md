# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's private vulnerability reporting:
<https://github.com/AubinMahe/amule-ec-ts/security/advisories/new>

A useful report says which version is affected, what the attacker controls (a hostile or impersonated daemon, a position on the
network between the library and the daemon, input that a caller forwards into a request) and what it achieves, ideally with a
minimal reproduction against `tests/fakeEcServer.ts` rather than a real daemon.

This is a single-maintainer project: expect an acknowledgement, not an SLA.

## Supported versions

Only the latest release receives fixes. Every version gets a tag and a GitHub Release, but publication to npm is a separate step,
taken when the maintainer judges a version mature: the latest version on npm can be older than the latest release, and then does not
carry its fixes.

## Scope

`amule-ec` is a client for aMule's External Connections (EC) protocol. In scope: a malformed packet or a hostile endpoint making the
library exhaust memory or CPU, hang, or misbehave; a request built differently from what the caller asked for; the handling of
credentials; the integrity of the published package and of its build.

Out of scope: weaknesses of the EC protocol itself (its password hash is MD5, and the session is neither encrypted nor authenticated
per packet, see `ISSUES.md`), and vulnerabilities in aMule itself, which belong to
[amule-org/amule](https://github.com/amule-org/amule).

The known limitations are listed in `ISSUES.md`, and the hardening work still to do in the "Hardening" section of `TODO.md`. A
report about one of them is still welcome if it shows an impact worse than the one described there.
