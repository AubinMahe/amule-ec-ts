# ISSUES

Known defects in already-shipped behavior. Unlike `TODO.md` (protocol surface not yet wrapped) or `CHOICES.md` (design decisions and
why), this file tracks things that are implemented but wrong or misleading.

## `notify: true` request/reply race

### Risk

`ECConnection.dispatchPacket()` (`ECConnection.ts`) hands every incoming packet to the oldest pending `receive()` call, since EC has
no request-id field to correlate on. If the daemon ever pushes a notification while another request on the same connection is still
awaiting its reply, the notification gets mis-delivered as that request's reply, desyncing every later request/reply pairing on that
connection. Not fixable client-side - EC has no request-id field, full stop. Confirmed to actually happen, reproduced by a real
consumer with several requests polling concurrently on one connection that also had `notify: true` enabled.

### Mitigation

Confirmed to work: open a second, dedicated `ECConnection` purely for `notify: true` and `onNotification()`, never calling
`send()`/`receive()` on it for anything else, while the polling connection stays `notify: false`. One push-only connection can be
shared by any number of `onNotification()` listeners - the safety property is "never mixed with polling," not "one per consumer."
Documented on `dispatchPacket()` and `ECEngineStartOptions.notify` themselves.

## Peer-supplied data is returned unmodified

### Risk

Filenames, comments, client names, server names and descriptions, chat messages and log lines reach the caller exactly as a remote
peer (or the network through `amuled`) supplied them. A caller that renders them in HTML, uses them as a path component, prints them
to a terminal or uses them as an object key inherits the usual injection classes (XSS, path traversal, escape-sequence injection,
prototype pollution). Sizes and counters are decoded as `bigint`; wherever a caller or a service converts one with `Number()`,
values above 2^53 silently lose precision.

### Mitigation

Treat every decoded string as untrusted input, and keep 64-bit quantities as `bigint` end to end.

## The EC session is neither encrypted nor authenticated per packet

### Risk

EC runs in clear text over TCP; the password is MD5-based, salted challenge/response, and once the handshake is over nothing
authenticates individual packets. An on-path attacker between this library and `amuled` can read every reply and inject or alter
packets in an established session. Upstream `amuled` can offer an authenticated, encrypted session (see TODO.md, "EC session
encryption"); a comment in the daemon's authentication code (`ExternalConn.cpp`) also mentions an operator policy refusing any
session that did not negotiate encryption, in which case this library could not connect at all (the exact preference was not
checked).

### Mitigation

`ECConnection.connect()`/`.reconnect()` (and `ECEngineStartOptions`) now refuse a non-loopback `host` unless `allowNonLoopback` is
set, so reaching a remote daemon over a real network takes a deliberate opt-in rather than an accident. Once opted in, reach it
through an SSH tunnel or VPN rather than a bare network address - the traffic itself is still unencrypted either way.

## Known advisory in the development dependencies

### Risk

`npm audit` reports 2 advisories, both high, none of them in the published package: `npm audit --omit=dev` finds nothing, since it
has no dependencies. `markdownlint-cli2` (already at its latest release) depends on `smol-toml`, with a denial-of-service advisory
on malformed TOML documents; the only fix `npm audit` lists is a downgrade of `markdownlint-cli2`. It sits in the toolchain that
runs in CI, not in what consumers install.

### Mitigation

CI's `npm audit --omit=dev` step blocks, and the full `npm audit` step only reports.
