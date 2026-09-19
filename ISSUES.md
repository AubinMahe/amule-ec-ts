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

## No upper bound on the announced packet size

### Risk

`ECConnection.readPacket()` (`ECConnection.ts`) reads `bodyLength` bytes as announced by the 8-byte transmission header, a uint32
(up to 4 GiB), and buffers them in `receiveChunks` with no limit before decoding. Reproduced against a local fake server: a header
announcing a 1 GB body, followed by a stream of bytes, took the process from 92 MB to 512 MB RSS after 400 MB, with no error and no
disconnect. A compromised or impersonated endpoint (EC is not encrypted, see below) can exhaust the memory of the process using this
library. The daemon itself bounds this: `CECSocket::ReadHeader` in the C++ `ECSocket.cpp` drops a peer announcing more than 16 MiB
before authentication and more than 256 MiB after.

### Mitigation

None in the library. Connect only to a trusted, loopback or tunnelled `amuled`.

## Decompression is unbounded and synchronous

### Risk

`zlib.inflateSync()` in `ECConnection.readPacket()` has no `maxOutputLength`, so a small compressed body can inflate to the
runtime's maximum buffer size, and the synchronous call blocks the event loop meanwhile. The `compressed` flag of an incoming header
is also honoured whether or not `zlib` was negotiated for this connection. Read from the code, not reproduced.

### Mitigation

None in the library.

## Tag tree decoding has no depth or total-count limit

### Risk

`ECTagDecoder.readTag()` (`ECTags.ts`) recurses once per nesting level with no depth limit, so a body made of deeply nested tags can
overflow the call stack; the resulting `RangeError` is caught by the pump loop, like any decode error. The number of tags is only
bounded by the body size. Read from the code, not reproduced.

### Mitigation

None in the library; bounding the packet size (see above) bounds the depth reachable.

## No timeout on connecting

### Risk

`ECConnection.connect()` and `reconnect()` have no timeout of their own: a connect to an unresponsive host waits for the operating
system's TCP timeout. (Requests, the authentication handshake included, are covered by `ECConnection.requestTimeoutMs`.)

### Mitigation

None in the library; callers can race the call against their own timer.

## `AlternateNamesCache` file handling

### Risk

- The alternate names come from remote peers; neither the number of entries, the number of names per entry nor a name's length is
  bounded, and the whole file is rewritten on every change.
- `persist()` writes in place (no temporary file plus rename), so an interrupted write leaves a truncated file, and `load()` only
  tolerates a missing file: any other read or `JSON.parse` failure makes `ECEngine.start()` throw on every later start until the
  file is removed.
- The loaded JSON is not validated: an entry whose `names` is not an array makes `add()` throw, and a non-string `lastUpdated` is
  never purged.
- The file is created with the process's default mode (typically world-readable) although it lists filenames.

### Mitigation

Point `altNamesCachePath` at a private directory and remove a corrupted file by hand.

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
packets in an established session. `ECEngine.start()` accepts any `host`. Upstream `amuled` can offer an authenticated, encrypted
session (see TODO.md, "EC session encryption"); a comment in the daemon's authentication code (`ExternalConn.cpp`) also mentions an
operator policy refusing any session that did not negotiate encryption, in which case this library could not connect at all (the
exact preference was not checked).

### Mitigation

Keep `host` on loopback, or reach a remote daemon through an SSH tunnel or VPN.

## Known advisory in the development dependencies

### Risk

`npm audit` reports 2 advisories, both high, none of them in the published package: `npm audit --omit=dev` finds nothing, since it
has no dependencies. `markdownlint-cli2` (already at its latest release) depends on `smol-toml`, with a denial-of-service advisory
on malformed TOML documents; the only fix `npm audit` lists is a downgrade of `markdownlint-cli2`. It sits in the toolchain that
runs in CI, not in what consumers install.

### Mitigation

CI's `npm audit --omit=dev` step blocks, and the full `npm audit` step only reports.
