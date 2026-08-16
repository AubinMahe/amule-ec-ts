# TODO

## Tags, declared but not decoded

### `EC_TAG_KNOWNFILE_HASHED_PART_COUNT`

Declared in `ECTagNames.ts` (0x041B) but never decoded anywhere. "Verify Local Data" progress (hash-check of a shared file), not
wired up in `SharedFiles.ts`.

- **Priority**: Low
- **Effort**: Low

### `EC_TAG_KNOWNFILE_LAST_UPLOAD`/`EC_TAG_KNOWNFILE_SHARED_SINCE`

Declared in `ECTagNames.ts` (0x0419/0x041A) but never decoded anywhere. Last-upload timestamp and share-since date of a shared file,
absent from `SharedFiles.ts` unlike the sibling `.UPLOAD_SPEED`/`.UPLOADING_COUNT` tags, which are decoded.

- **Priority**: Low
- **Effort**: Low

### `EC_TAG_CLIENT_IS_FRIEND`/`EC_TAG_CLIENT_SCORE_RATIO`

Declared in `ECTagNames.ts` (0x062C/0x062D) but never decoded anywhere. Friend status and download/upload score modifier of an
uploading client, absent from `Update.ts::ClientUpdate`.

- **Priority**: Low
- **Effort**: Low

### `EC_TAG_CAN_SEARCH_PROGRESS_UNION`

The capability constant is already declared in `ECTagNames.ts` (0x0020) but never negotiated at auth nor consumed. When offered, it
lets `EC_OP_SEARCH_PROGRESS` be sent without an id to probe every open search's progress in one request instead of one request per
search. Backward-compatible: the existing per-id behavior still works when the daemon doesn't offer the capability.

- **Priority**: Low
- **Effort**: Medium

### `EC_TAG_KNOWNFILE_MEDIA_LENGTH`/`.MEDIA_BITRATE`/`.MEDIA_CODEC`/`.MEDIA_ARTIST`/`.MEDIA_ALBUM`/`.MEDIA_TITLE`

Declared in `ECTagNames.ts` (0x0410-0x0415) but never decoded anywhere. Media metadata of a file, absent from both `SharedFiles.ts`
and search results (`Search.ts`).

- **Priority**: Low
- **Effort**: Medium

### Grouped search results

`EC_TAG_SEARCH_PARENT` (0x0709) as an optional request flag, plus `EC_TAG_SEARCHFILE` (0x0700) valid as a download selector, let a
client download one grouped child result under its own name. Both tags are declared in `ECTagNames.ts` but `Search.ts::download()`
only ever sends raw hashes on `DOWNLOAD_SEARCH_RESULT`, never this flag, and decodes no grouped children on results.

- **Priority**: Low
- **Effort**: Medium

### EC session encryption

Upstream added optional end-to-end encryption of the EC session, including a forward-secrecy handshake over X25519 (tags
`EC_TAG_CAN_AEAD`, `EC_TAG_AEAD_CIPHER`, `EC_TAG_AEAD_CLIENT_NONCE`/`_SERVER_NONCE`, `EC_TAG_AEAD_CLIENT_PUBKEY`/`_SERVER_PUBKEY`/
`_CLIENT_CONFIRM`/`_SERVER_CONFIRM`). `ECTagNames.ts` declares all these tag names for inventory completeness, but none of the
handshake/encryption logic is implemented - `ECConnection.ts`'s auth flow is unchanged and never advertises `EC_TAG_CAN_AEAD`.
Reference implementation to work from, if this becomes a real task: `docs/EC_Protocol.md` and `src/libs/ec/cpp/ECCrypt.{h,cpp}` in
the upstream C++ checkout.

- **Priority**: Low
- **Effort**: High

## Other protocol behavior gaps

### `ECSearchType.BROWSE`

`ECSearchType` (`Search.ts`) is missing the `BROWSE = 0x04` member: `SEARCH_LIST` now also lists browse requests (a peer's "View
Files"), each carrying a child `EC_TAG_CLIENT` = the peer's ecid. `Search.list()`'s doc claims browses are excluded, which is now
wrong, and `KnownSearch` doesn't decode the child ecid.

- **Priority**: Medium
- **Effort**: Low

## New opcodes, not yet ported

### `EC_OP_GET_CLIENT_HISTORY`/`EC_OP_CLIENT_HISTORY`

Requests/returns the daemon's known-clients history (first seen, last seen, session count), separate from the live client list.
Capability tag `EC_TAG_CAN_CLIENT_HISTORY` is echoed on `AUTH_OK` when the daemon supports it. Reply entries carry
`EC_TAG_CLIENT_FIRST_SEEN`, `EC_TAG_CLIENT_LAST_SEEN` and `EC_TAG_CLIENT_SESSIONS`. None of this is declared in
`ECOpcode.ts`/`ECTagNames.ts`.

- **Priority**: Low
- **Effort**: Medium

## REPL views, bypassing formatted getters

### `DownloadFile.priorityText`/`DownloadFile.statusText`

Human-readable priority/status getters, already covered by `Downloads.test.ts`. `tests/repl/views/downloads.ts` prints the raw
`prio`/`status` numeric fields instead of these.

- **Priority**: Medium
- **Effort**: Low

### `UploadClient.softwareText`

Human-readable client-software name, already covered by `Uploads.test.ts`. `tests/repl/views/uploads.ts` prints the raw `software`
code instead of this getter.

- **Priority**: Medium
- **Effort**: Low
