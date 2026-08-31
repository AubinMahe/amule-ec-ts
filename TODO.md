# TODO

## Tags, declared but not decoded

### `EC_TAG_CAN_SEARCH_PROGRESS_UNION`

The capability constant is already declared in `ECTagNames.ts` (0x0020) but never negotiated at auth nor consumed. Once negotiated,
every `EC_OP_SEARCH_PROGRESS` reply switches to a union shape (one entry per open search, keyed by `EC_TAG_SEARCH_ID`, regardless of
whether the request named an id) instead of today's single-search reply - naming ids only narrows which searches come back, it
doesn't opt back into the old shape. A caller with N open search tabs could then poll all of them in one request instead of N, but
this is real API design work, not a mechanical decode: negotiate opt-in (like `multiSearch`/`notify`, not unconditionally, since
default-on would silently change every existing `SearchSession.progress()` reply's shape), and add a new dedicated method rather
than repurposing `progress()` - deserves its own PR, not folded into an unrelated batch.

- **Priority**: Low
- **Effort**: High

### EC session encryption

Upstream added optional end-to-end encryption of the EC session, including a forward-secrecy handshake over X25519 (tags
`EC_TAG_CAN_AEAD`, `EC_TAG_AEAD_CIPHER`, `EC_TAG_AEAD_CLIENT_NONCE`/`_SERVER_NONCE`, `EC_TAG_AEAD_CLIENT_PUBKEY`/`_SERVER_PUBKEY`/
`_CLIENT_CONFIRM`/`_SERVER_CONFIRM`). `ECTagNames.ts` declares all these tag names for inventory completeness, but none of the
handshake/encryption logic is implemented - `ECConnection.ts`'s auth flow is unchanged and never advertises `EC_TAG_CAN_AEAD`.
Reference implementation to work from, if this becomes a real task: `docs/EC_Protocol.md` and `src/libs/ec/cpp/ECCrypt.{h,cpp}` in
the upstream C++ checkout.

- **Priority**: Low
- **Effort**: High

## Opcodes/tags added upstream since the 2026-08-04 sync, not yet ported

Found during the 2026-08-31 sync (see `amule-cpp-sync.md`). No existing opcode or tag value changed - all additive, upstream HEAD
`821e34e8`.

### Chat session store

Upstream added a persistent, session-based chat store (issue #971): `EC_OP_GET_CHAT_SESSIONS`/`EC_OP_CHAT_SESSIONS`/
`EC_OP_CHAT_SEND`/`EC_OP_CHAT_CLOSE_SESSION` (0x63-0x66), gated on `EC_TAG_CAN_CHAT_SESSIONS` (0x0027, deliberately distinct from
the existing `EC_TAG_CAN_CHAT` so a daemon that only knows the older chat stays undetected as capable of this one), with new tags
`EC_TAG_CHAT_SESSION`/`_MESSAGE`/`_MSG_ID`/`_DIRECTION`/`_TIMESTAMP`/`_PEER_NAME` (0x0902-0x0907). The older
`EC_OP_GET_CHAT_MESSAGES`/`EC_OP_CHAT_MESSAGES` (0x5B/0x5C) this library already implements (`Chat.fetch()`) is unchanged and
unaffected. None of the new opcodes/tags are declared in `ECOpcode.ts`/`ECTagNames.ts`.

- **Priority**: Low
- **Effort**: Medium
