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

## `npm run lint:md` requires Node 20+

### Risk

`markdownlint-cli2`'s dependency chain requires Node 20+: `markdownlint` (>=0.38.0) depends on `string-width@8.x`, which uses the
`/v` regex flag (ES2024/V8 11+) and throws `SyntaxError: Invalid regular expression flags` under Node 18. `markdownlint-cli2@0.23.2`
itself even declares `engines: >=22`. `package.json`'s own `engines.node` is `>=18`, and CI tests 18.x/20.x/22.x - `npm run lint:md`
broke the 18.x job the first time it ran there, so it's no longer folded into `npm run lint` (which stays Node-18-safe: `tsc` +
`eslint` only). Anyone touching Markdown must run `npm run lint:md` separately, and it needs Node 20+ to do so.

### Mitigation

None available without dropping either Node 18 support or MD060 (table-style) enforcement: no `markdownlint` version supports both -
MD060 was only added in 0.39.0, which already requires Node 20+. Run `npm run lint:md` on Node 20+ locally instead; CI no longer
runs it on any matrix version, so a Markdown-only mistake (bad table style, prose over 132 columns, ...) won't be caught there until
this is revisited.
