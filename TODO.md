# TODO

## Tags, not yet declared

### `EC_TAG_STATSGRAPH_DEPTH`

Not declared in `ECTagNames.ts`. The daemon sends it on `STATSGRAPHS` replies to tell the client how far back its history goes;
`StatsGraphs.ts` sends `EC_TAG_STATSGRAPH_WIDTH` uncapped and never reads this tag, so a caller can request more points than the
daemon actually has, returning duplicated/misleading points with a skewed time axis.

- **Priority**: Medium
- **Effort**: Low

### `EC_TAG_SESSION_ID`

Not declared in `ECTagNames.ts`. The daemon sends a random per-process identifier on every `AUTH_OK` reply (`ECConnection.ts`,
alongside the `EC_TAG_CAN_LARGE_TAG_COUNT` echo). `amule-ec-ts` never reads it. ECIDs restart from 0 on every daemon restart, so a
caller that indexes state by ECID across a reconnection can silently associate it with the wrong object; exposing the session id
would let callers detect a daemon restart and invalidate such state.

- **Priority**: Low
- **Effort**: Low

### `EC_TAG_STATS_INCOMING_FREE_SPACE`/`EC_TAG_STATS_TEMP_FREE_SPACE`

Not declared in `ECTagNames.ts`. Sent as children of the `STATS` reply (`Status.ts` territory), free disk space on the incoming
(downloads) and temp (partial files) directories respectively.

- **Priority**: Low
- **Effort**: Low

### `EC_TAG_SERVER_FILES_SOFT`/`EC_TAG_SERVER_FILES_HARD`/`EC_TAG_SERVER_TCP_FLAGS`/`EC_TAG_SERVER_UDP_FLAGS`

Not declared in `ECTagNames.ts`. Children of a server entry (`Servers.ts` territory, `SERVER_LIST` reply): per-server soft/hard
shared-file limits and TCP/UDP flag bitmasks.

- **Priority**: Low
- **Effort**: Low

### `EC_TAG_ED2K_CONNECTED_SINCE`/`EC_TAG_KAD_CONNECTED_SINCE`

Not declared in `ECTagNames.ts`. Timestamp of when the ed2k/Kad connection was established, sent on the connection-state reply
(`Status.ts` territory); never wired up.

- **Priority**: Low
- **Effort**: Low

## Tags, declared but not decoded

### `EC_TAG_KNOWNFILE_PATH`

Declared in `ECTagNames.ts` (0x0416) but never decoded anywhere. Unambiguous path of a shared file (disambiguates same-named files
in different shared directories), absent from both `SharedFiles.ts` and `Downloads.ts`.

- **Priority**: Medium
- **Effort**: Low

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
