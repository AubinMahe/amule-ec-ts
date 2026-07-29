# TODO

## Make the library observable at run-time

Using only Node built-ins - no logging dependency, consistent with this
project's "Zero runtime dependencies" stance (see README.md). `node:util`'s
`debuglog()` (opt-in per section via the `NODE_DEBUG` env var, zero-cost when
disabled) is the natural fit; `node:diagnostics_channel` is worth considering
too if external tooling ever needs to subscribe to structured events rather
than just read text.

Currently the only trace at all is a handful of ad-hoc `console.log`/
`console.error` calls in `ECEngine.ts` (reconnection attempts) - everything
else is silent.

Needs both:

- **Levels** (e.g. error/warn/info/debug), so verbosity can be dialed up only
  when actually debugging something.
- **Several topics/sections**, one per real use case, e.g.: connection
  lifecycle & reconnection (`ECEngine`), wire framing/codec (`ECPacket`,
  `TransmissionHeader`, `ECFlags`), opcode dispatch, and one per protocol
  domain (`Downloads`, `Uploads`, `Servers`, `SharedFiles`, `Status`, `Log`,
  `Search`) - so a consumer can enable just `amule-ec:downloads` without
  being drowned in unrelated traffic.

Not started yet.
