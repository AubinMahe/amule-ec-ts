# TODO

## Tags, declared but not decoded

Below this point is the result of a full audit (2026-08-31) of every `ECTagNames.ts` entry against its actual C++ usage - see
`amule-cpp-sync.md`'s "Blind spot" note for why this needed a dedicated pass rather than relying on the regular sync method. Not
every gap found is listed individually: some are grouped by the `amule-ec-ts` class whose decode they'd extend, since fixing one
typically means fixing the sibling fields alongside it in the same `fromTag()`.

Ruled out as _not_ gaps, so a future audit doesn't re-flag them: `EC_TAG_CLIENT_MOD`, `EC_TAG_CLIENT_CURRENTLYUNUSED1`,
`EC_TAG_CLIENT_A4AF_FILES`, `EC_TAG_PARTFILE_SIZE_XFER_UP` (zero references anywhere in the current C++ `.cpp`/`.h` sources - dead
protocol surface, nothing to decode); `EC_TAG_CLIENT_WAIT_TIME`/`_XFER_TIME`/`_QUEUE_TIME`/`_LAST_TIME` (their only C++ references
are commented-out `AddTag()` calls in `ECSpecialCoreTags.cpp` - never actually emitted); `EC_TAG_VERSION_ID` (auth-handshake-only,
snapshot-build compatibility check - this library correctly never sends it, sending it at all gets a release-build daemon to reject
the connection); `EC_TAG_PREFS_STATISTICS` (the one preferences section `Preferences.ts` deliberately never implements, per its own
doc).

The pass above only checked tags with _zero_ usage. A second pass covers the other 345: each classified as either genuinely read
(including via a helper not matched by a simple `child*()`/`find*()` call - `has()`/`flag()` for `Preferences.ts`/capability
negotiation, `ipFromTag()`, a `switch`/`case` branch), or used only to build a _request_ tag with no read of any reply. That pass
found three request-only gaps - `EC_TAG_KNOWNFILE_COMMENT`/`_RATING` (`SharedFile.comment`/`.rating`), `EC_TAG_FRIEND_FRIENDSLOT`
(`FriendInfo.friendSlot`) and `EC_TAG_PARTFILE_CAT` (`DownloadFile.category`) - all three now decoded.

### `EC_TAG_CAN_SEARCH_PROGRESS_UNION` / `EC_TAG_CAN_PARTIAL_SEARCH`

The capability constant is already declared in `ECTagNames.ts` (0x0020) but never negotiated at auth nor consumed. Once negotiated,
every `EC_OP_SEARCH_PROGRESS` reply switches to a union shape (one entry per open search, keyed by `EC_TAG_SEARCH_ID`, regardless of
whether the request named an id) instead of today's single-search reply - naming ids only narrows which searches come back, it
doesn't opt back into the old shape. A caller with N open search tabs could then poll all of them in one request instead of N, but
this is real API design work, not a mechanical decode: negotiate opt-in (like `multiSearch`/`notify`, not unconditionally, since
default-on would silently change every existing `SearchSession.progress()` reply's shape), and add a new dedicated method rather
than repurposing `progress()` - deserves its own PR, not folded into an unrelated batch.

`EC_TAG_CAN_PARTIAL_SEARCH` (0x001d) is the same family of capability, one opcode over: it gates `EC_OP_SEARCH_RESULTS` switching to
a union across every open search (`Get_EC_Response_Search_Results_Union`, skipping unchanged results and reporting removals via
`EC_TAG_FILE_REMOVED` tombstones), but only when combined with `multiSearch` _and_ `EC_DETAIL_INC_UPDATE` - a polling mode
`SearchSession.fetch()` doesn't use either (it addresses one search by `EC_TAG_SEARCH_ID`, not the union). Only relevant together
with the item above, if the union-polling model this library doesn't implement is ever built - not two separate tasks.

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

### `Status.ts` - undecoded `EC_OP_STATS`/`EC_OP_GET_CONNSTATE` fields

All present in the same replies `Status.fetch()` already parses, just not read yet:

- `EC_TAG_STATS_UP_OVERHEAD`/`_DOWN_OVERHEAD` - protocol overhead rate (bytes/s), distinct from the raw transfer speeds already
  decoded.
- `EC_TAG_STATS_BANNED_COUNT` - currently banned peer count.
- `EC_TAG_STATS_TOTAL_SENT_BYTES`/`_TOTAL_RECEIVED_BYTES` - lifetime totals (distinct from session speeds).
- `EC_TAG_STATS_SHARED_FILE_COUNT` - count of locally shared files.
- `EC_TAG_STATS_KAD_FIREWALLED_UDP`/`_KAD_INDEXED_SOURCES`/`_KAD_INDEXED_KEYWORDS`/`_KAD_INDEXED_NOTES`/`_KAD_INDEXED_LOAD`/
  `_KAD_IP_ADDRESS`/`_KAD_IN_LAN_MODE` - Kad-node-specific diagnostics, only meaningful while Kad is connected.
- `EC_TAG_STATS_BUDDY_STATUS`/`_BUDDY_IP`/`_BUDDY_PORT` - this daemon's own Kad "buddy" (firewall-relay peer) state.
- `EC_TAG_GENERAL_VERSION_CHECK_LATEST`/`_TIMESTAMP`/`_OUTDATED` - the _result_ of a version check, present only once one has
  completed (`ENABLE_VERSION_CHECK` builds). `Daemon.checkVersion()` only triggers a check; this is the read side, currently missing
  entirely - a caller has no way to learn the outcome over EC at all right now.
- `EC_TAG_CLIENT_ID` - this daemon's own ed2k client ID (`theApp->GetID()`), a child of `EC_TAG_CONNSTATE` like `ed2kId`/
  `hasLowId`/`kadConnected` already decoded there - distinct from `EC_TAG_ED2K_ID` (`Status.ed2kId`), needs confirming against the
  C++ source what exactly it identifies before deciding a field name.
- `EC_TAG_KAD_ID` - this node's own 128-bit Kad ID, also a child of `EC_TAG_CONNSTATE`, only present while Kad is running.

- **Priority**: Low
- **Effort**: Medium

### `Status.ts` - incremental log channel piggybacked on stats polling

`EC_TAG_STATS_LOGGER_MESSAGE` rides on the same `EC_OP_STATS` reply `Status.fetch()` already parses: a parent tag (present only when
new lines exist) whose children are the daemon's log lines accumulated since the last poll, capped at 5000 entries per message. This
is a _different_ mechanism from `Log.fetch()` (`EC_OP_GET_LOG`, the whole accumulated log on demand) - an incremental tail delivered
for free on every stats poll, currently not read at all. Confirmed webapi uses exactly this channel for its own incremental log
streaming (`Refresher.cpp`/`RefresherTick.cpp`).

- **Priority**: Low
- **Effort**: Low

### `Downloads.ts` (`DownloadFile`) - undecoded `EC_TAG_PARTFILE_*` fields

All added unconditionally in `CEC_PartFile_Tag`, alongside `stopped`/`isA4AFAuto` already decoded there - same "present at every
detail level" shape:

- `EC_TAG_PARTFILE_SOURCE_COUNT_NOT_CURRENT`/`_SOURCE_COUNT_A4AF` - source counts by category, alongside `sources`/`sourcesXfer`
  already decoded.
- `EC_TAG_PARTFILE_LAST_SEEN_COMP` - when a complete copy of this file was last seen among sources.
- `EC_TAG_PARTFILE_LAST_RECV` - last time any data was received for this file.
- `EC_TAG_PARTFILE_DOWNLOAD_ACTIVE` - cumulative active-download time.
- `EC_TAG_PARTFILE_AVAILABLE_PARTS` - count of parts with at least one source (distinct from `partAvailability`'s per-part detail).
- `EC_TAG_PARTFILE_HASHED_PART_COUNT` - this download's own hash-verification progress (`SharedFile` already decodes the
  `EC_TAG_KNOWNFILE_` sibling of this for shared files; the partfile-only tag is a different value, "Verify Local Data" gates differ
  for an in-progress download).
- `EC_TAG_PARTFILE_LOST_CORRUPTION`/`_GAINED_COMPRESSION`/`_SAVED_ICH` - ICH (Intelligent Corruption Handling) stats: bytes lost to
  corruption, bytes saved by compression, packets saved by ICH.
- `EC_TAG_PARTFILE_A4AF_SOURCES` - a container tag (own data empty, children are the file's other "also available for" hashes) -
  needs its own parse function, not a scalar `childInt`/`childString`.
- `EC_TAG_PARTFILE_ED2K_LINK` - the daemon's own pre-built ed2k link for this file, string.
- `EC_TAG_PARTFILE_SHARED` - whether this partfile is also currently shared (bool).

- **Priority**: Low
- **Effort**: Medium

### `Downloads.ts`/`SharedFiles.ts` - undecoded `EC_TAG_KNOWNFILE_*` fields (shared by `DownloadFile` and `SharedFile`)

Added in the common `CEC_SharedFile_Tag` base both classes' `fromTag()` already reads other fields from:

- `EC_TAG_KNOWNFILE_REQ_COUNT` - upload requests since this session started (distinct from `SharedFile.requestsTotal`, the all-time
  count already decoded).
- `EC_TAG_KNOWNFILE_ACCEPT_COUNT`/`_ACCEPT_COUNT_ALL` - accepted-upload counts, session/all-time.
- `EC_TAG_KNOWNFILE_XFERRED` - bytes transferred this session (distinct from `SharedFile.uploadedTotal`, the all-time figure).
- `EC_TAG_KNOWNFILE_AICH_MASTERHASH` - the file's AICH master hash, when known.
- `EC_TAG_KNOWNFILE_COMPLETE_SOURCES`/`_COMPLETE_SOURCES_LOW`/`_COMPLETE_SOURCES_HIGH` - complete-source counts (the low/high pair
  encode a value above `uint16` range split across two tags - confirmed against `webapi/Refresher.cpp`'s own reconstruction).
- `EC_TAG_KNOWNFILE_ON_QUEUE` - how many clients currently have this file queued for upload.
- `EC_TAG_KNOWNFILE_FILENAME` - the full on-disk path (distinct from `EC_TAG_KNOWNFILE_PATH`/`.path`, already decoded, which is just
  the directory - confirmed against `PartFile.h`'s own doc comment on the two).

- **Priority**: Low
- **Effort**: Medium

### `Update.ts` (`ClientUpdate`) - undecoded `EC_TAG_CLIENT_*` fields

All added at the `EC_DETAIL_INC_UPDATE` level `Update.fetch()` already requests, alongside `isFriend`/`scoreRatio` already decoded
there:

- `EC_TAG_CLIENT_OLD_REMOTE_QUEUE_RANK` - the remote queue rank before its last change, alongside `remoteQueueRank` already decoded.
- `EC_TAG_CLIENT_REQUEST_FILE` - ECID of the file this client is requesting from us (distinct from `UploadClient.uploadFileEcid`,
  which lives on the separate `Uploads.fetch()` shape).
- `EC_TAG_CLIENT_REMOTE_FILENAME` - the filename as this client itself calls it.
- `EC_TAG_CLIENT_DISABLE_VIEW_SHARED` - whether this client has disabled letting others browse its shared files.
- `EC_TAG_CLIENT_MOD_VERSION` - the client's mod name/version string.
- `EC_TAG_CLIENT_OS_INFO` - the client's reported OS string.
- `EC_TAG_CLIENT_AVAILABLE_PARTS` - count of parts this client can offer for its requested file.
- `EC_TAG_CLIENT_PART_STATUS`/`_UPLOAD_PART_STATUS` - per-part availability bitmaps, download-side and upload-side respectively (an
  absent/empty tag is a documented shorthand for "client has every part" - see `webapi/Refresher.cpp`'s own comment on this).
- `EC_TAG_CLIENT_NEXT_REQUESTED_PART`/`_LAST_DOWNLOADING_PART` - which part this client will request next / was last seen
  downloading.

- **Priority**: Low
- **Effort**: Medium

### `Search.ts` (`SearchResult`) - undecoded `EC_TAG_SEARCHFILE_*` fields

- `EC_TAG_SEARCHFILE_CLIENT_ID`/`_CLIENT_PORT` - the result's own source client, for direct sourcing without a further lookup.
- `EC_TAG_SEARCHFILE_DIRECTORY` - the directory this result lives in on its source.
- `EC_TAG_SEARCH_BROWSE_STATUS` - a browse ("View Files") search's own richer lifecycle discriminator (browsing/finished/failed),
  reported alongside the normal `_LIFECYCLE_STATE`/`_PERCENT` `SearchSession.progress()` already decodes. Needs checking whether
  `ECSearchLifecycleState`'s existing states already cover this for a browse session (`Friends. browseSharedFiles()`'s result) or
  whether real information is lost by not reading it separately - not confirmed either way yet.

- **Priority**: Low
- **Effort**: Low
