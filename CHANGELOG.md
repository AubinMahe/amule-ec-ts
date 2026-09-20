# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

Beyond bug fixes, future changes are driven by the upstream [amule-org/amule](https://github.com/amule-org/amule) C++ project: new
EC opcodes/tags or protocol behavior changes there are what this client tracks - see CONTRIBUTING.md for how such changes are
verified against that source before being reflected here.

## [Unreleased]

### Added

- `ECConnection.allowNonLoopback` (default `false`) and a fourth argument of the same name on `connect()`/`.reconnect()`, plus
  `ECEngineStartOptions.allowNonLoopback`: a non-loopback `host` is now refused with a `RangeError`, before any socket is even
  opened, unless this is set. EC is neither encrypted nor authenticated per packet (see `ISSUES.md`), so reaching a remote daemon
  over a real network now takes a deliberate opt-in instead of an accident. Loopback covers `"localhost"`, an IPv4 address in
  `127.0.0.0/8`, and the two common spellings of the IPv6 loopback address; anything else needs the opt-in. `reconnect()` defaults
  to whatever value `connect()` (or a direct assignment) already gave the connection, so it does not have to be repeated on every
  call.
- `assertLoopbackOrAllowed()`, the function behind the check above, is exported from `ECValidation.js` alongside
  `assertEmptyOrHttpUrl()`.
- `AlternateNamesCache`'s constructor takes three optional bounds - `maxEntries`/`maxNamesPerEntry`/`maxNameLength`, defaulting to
  the new `AlternateNamesCache.DEFAULT_MAX_ENTRIES` (10,000), `.DEFAULT_MAX_NAMES_PER_ENTRY` (100, matching `MAX_FILENAMES` in the
  upstream C++ checkout's Kad `Entry.cpp`, the same cap on a Kad entry's own accumulated filename variants) and
  `.DEFAULT_MAX_NAME_LENGTH` (255, the common filesystem filename length limit) - on the names it caches, which come from remote
  ed2k/Kad peers by way of `Downloads.ts`: a name longer than `maxNameLength` is dropped, an `add()` call that would put more
  distinct names on one entry than `maxNamesPerEntry` allows keeps the ones already known, and a call that would add a new entry
  past `maxEntries` evicts the least-recently-updated existing ones first, the same age-based policy `init()`'s own purge already
  uses.
- `ECConnection.readOnly` (default `false`) and `ECEngineStartOptions.readOnly`: a consumer that only monitors `amuled` can set this
  instead of relying on its own code never happening to call `Daemon.shutdown()`, delete a download or a shared file, or write
  `Preferences`. `send()` refuses, with a `RangeError` and before writing anything, any opcode outside the new
  `ECConnection.READ_ONLY_OPCODES` - the handshake and every opcode this library only ever uses to fetch or poll state, never to
  change something on the daemon, a peer or the network. Applies equally to `request()`, which calls `send()` underneath. Live-
  tested against a real daemon: `Status.fetch()`/`SharedFiles.fetch()` succeed under `readOnly: true`, `Daemon.shutdown()` and
  `Log.reset()` are both refused before either packet reaches the daemon, and the connection stays fully usable afterward. See
  `CHOICES.md` for the one known gap this opcode-level check leaves (`Friends.browseSharedFiles()`).

### Fixed

- `AlternateNamesCache.persist()` now writes to a temporary file (mode `0o600`, since the file lists filenames) and renames it over
  the real one, atomic on the same filesystem - a process killed mid-write used to leave a truncated file.
- `AlternateNamesCache.load()` (so `init()`, so `ECEngine.start()`) no longer throws on a file that fails to parse as JSON or whose
  top level isn't a plain object: it is backed up to `<path>.corrupt` (best effort; a failure to back it up still doesn't throw) and
  treated as empty. Within an otherwise well-formed file, an individual entry that doesn't have the right shape (`names` not a
  string array, `lastUpdated` not a valid date) is dropped on its own, without discarding the rest of the file or a backup.

## [3.1.0] - 2026-09-20

### Added

- `ECConnection.maxPacketBytesUnauthenticated`/`.maxPacketBytesAuthenticated` (default 16 MiB/256 MiB, matching the daemon's own
  `CECSocket::ReadHeader` bounds): a reply whose transmission header announces a body past the applicable one is refused, and the
  connection aborted, before any of that body is read. Live-tested reproduction of the defect this fixes: a header announcing a 1 GB
  body used to take the process from 92 MB to 512 MB RSS reading the stream behind it, with no error and no disconnect.
- `ECConnection.maxInflatedBytes` (default 256 MiB), passed as zlib's own `maxOutputLength` when inflating a compressed reply: a
  small compressed body can no longer decompress to the runtime's maximum buffer size.
- `ECConnection.maxTagDepth`/`.maxTagCount` (defaults 32 and 2,000,000) and matching parameters on `ECPacket.decode()`: a reply
  nested past `maxTagDepth`, or containing more tags in total than `maxTagCount`, now fails with `ECDecodeError` instead of
  recursing arbitrarily deep or building an arbitrarily large decoded tree from a small announced body.
- `ECConnection.connectTimeoutMs` (default 10 s), a third argument to `ECConnection.connect()`/`.reconnect()`: neither had a timeout
  of its own before, so connecting to an unresponsive host wandered off into the operating system's own TCP timeout, typically
  minutes rather than seconds. `reconnect()` defaults to whatever value `connect()` (or a direct assignment) already gave the
  connection, so it does not have to be repeated on every call.
- `ECDecodeError` is now exported: a caller decoding raw EC bytes of their own can tell a graceful, expected framing/limit violation
  from any other exception.

### Fixed

- A compressed reply is now rejected unless `localCapabilities.zlib` was set before authenticating: the wire flag used to be
  honoured unconditionally, so a peer could force a decompression attempt this connection never asked for and was not prepared to
  receive.

### Changed

- `tests/ECPacketFuzz.test.ts` feeds `ECPacket.decode()` thousands of randomly mutated valid packets and random byte buffers (a
  fixed seed, so a failure is reproducible), asserting the only errors it ever throws are `ECDecodeError` or `RangeError`, and
  specifically that a deeply nested tree never reaches a native stack overflow instead of `maxTagDepth`.

## [3.0.0] - 2026-09-19

### Changed

- **Breaking**: Node 22 or later is now required (`engines.node` is `>=22`, it was `>=18`). Node 18 and 20 are out of maintenance,
  and the development toolchain no longer runs on Node 18: `mocha` 12 needs Node `^20.19.0 || >=22.12.0`, and `markdownlint-cli2`
  Node 22. CI now tests Node 22 and 24. The library's own code is unchanged, so it may still work on older Node versions, but that
  is neither tested nor supported. Anyone who has to stay on Node 18 has to stay on a 2.x release.

## [2.33.0] - 2026-09-19

### Added

- `ECAuthenticationError`: what `authenticateWithHash()` (and so `ECEngine.start()`) now throws when the daemon answers
  `EC_OP_AUTH_FAIL`, with the reason it gave as its message. It tells a refusal that retrying cannot fix from a failure that may be
  transient (a timeout, a dropped connection), which stay plain `Error`s.
- `armReconnect()` takes an optional last argument, the delay before the first reconnection attempt (default 2 s, unchanged), which
  mostly serves tests.

### Fixed

- A failed handshake now closes the connection: `authenticateWithHash()` used to leave the freshly connected socket open,
  unauthenticated, on the daemon, which expects the client to drop it. In `ECEngine.start()` it also kept the process alive, and in
  the reconnect loop one such socket stayed open per failed attempt until the next replaced it. The connection is closed with the
  handshake's error, so `disconnected` is emitted and later requests fail with that error.
- `ECEngine`'s reconnect loop gives up when the daemon refuses the credentials (`ECAuthenticationError`) instead of retrying every
  30 s forever: a changed password is not a transient condition. It logs "the daemon rejected the credentials, no longer
  reconnecting.", and the connection stays closed, every later request failing with the daemon's reason. Any other failure is
  retried as before. Live-tested against a daemon whose password was changed under an open connection: one reconnection attempt,
  none after it over the next 20 s.

## [2.32.0] - 2026-09-19

### Added

- `ECConnection.request(packet)`: sends a request and resolves with the daemon's reply, as one exchange. Exchanges run one at a time
  per connection, in call order: EC has no request id, so replies can only be paired with requests by order, and two concurrent
  `send()`/`receive()` pairs could swap their replies. Every service now goes through it (`Daemon.shutdown()`, which expects no
  reply, still uses `send()`); `send()` and `receive()` stay public.
- `ECConnection.requestTimeoutMs` (default `ECConnection.DEFAULT_REQUEST_TIMEOUT_MS`, 30 s, `Infinity` disables it) and
  `ECEngineStartOptions.requestTimeoutMs`: an exchange that gets no reply in time fails with "No reply from the daemon within N
  ms.", and the connection is closed, since a late reply could only be paired with the wrong request. It emits `disconnected`, so
  `ECEngine`'s reconnect loop takes over. The authentication handshake is covered too.

### Fixed

- A request made through `request()` after `reconnect()`, while the new socket is still authenticating, is held until
  `authenticateWithHash()` has run. Sent earlier, it was answered by the daemon with `EC_OP_AUTH_FAIL` and the connection dropped,
  which made the reconnect loop's own authentication fail. Found live by polling a daemon frozen with `SIGSTOP` then resumed, the
  case a consumer refreshing on a timer runs into.
- A daemon that stops answering (a frozen process, a stalled network) no longer leaves every request waiting forever: before,
  `receive()` had no timeout and later requests queued behind the stuck one.

## [2.31.0] - 2026-09-19

### Changed

- A tag string containing a NUL character is refused with a `RangeError` when the request is encoded: the daemon reads it as a C
  string and would cut it there, so the request it acts on would differ from the one the caller built.
- `ECConnection.send()` refuses, with a `RangeError` and before writing anything, a request whose encoded body exceeds 16 MiB, the
  bound the daemon itself applies to a peer before authentication. No request built by this library comes near it.
- The URLs the daemon fetches on the caller's behalf must be empty or absolute `http:`/`https:` URLs, otherwise a `RangeError` is
  thrown before anything is sent: `IPFilter.updateFromUrl()`, `Servers.updateFromUrl()`, `Kad.updateNodesFromUrl()`, and the
  `Preferences` setters carrying one (`setSecurity()`'s `ipFilterUpdateUrl`, `setServers()`'s `updateUrl`, `setKademlia()`'s
  `nodesUpdateUrl`, `setIP2Country()`'s `customUrl`). A caller forwarding user input to one of them could otherwise pick any scheme
  the daemon's downloader understands. Only the scheme is checked: a host on the daemon's own network is still reachable. A
  `Preferences` object read from a daemon configured with another scheme now needs that field changed before it can be written back.

## [2.30.1] - 2026-09-19

### Fixed

- A `notification` (or `disconnected`) listener that throws no longer stops the connection's read loop. `emit()` runs listeners
  synchronously, so the exception used to escape into `ECConnection.pump()`, which ended without closing the socket: every later
  `receive()` waited forever. Listeners are now called one by one; a throwing one is reported on `console.error` and the others
  still run.
- A packet that can't be framed or decoded now closes the connection (emitting `disconnected`, so `ECEngine`'s reconnect loop takes
  over) instead of leaving it open with nothing reading it: the byte stream is desynchronized from that point on, later `receive()`
  calls used to wait forever, and whatever the peer kept sending piled up in memory.
- `ECConnection.reconnect()` destroys the previous socket and rejects the `receive()` calls still pending on it. It used to leave
  that socket open - after a failed `authenticateWithHash()` in `ECEngine`'s reconnect loop, one more connection stayed open on the
  daemon per attempt - and the old socket's late `close` event marked the new, healthy connection as closed.

## [2.30.0] - 2026-09-08

### Added

- `UploadClient.connected`/`.modCapabilities` (`Uploads.ts`) and `ClientUpdate.connected`/`.modCapabilities` (`Update.ts`) -
  `EC_TAG_CLIENT_CONNECTED` (whether the daemon holds a live, actually-connected socket to this peer right now, as opposed to merely
  attempting contact) and `EC_TAG_CLIENT_MOD_CAPABILITIES` (the peer's eMuleAI vendor capability bitfield, decoded into the new
  `ClientModCapabilities` class: `extendedSourceExchange`/`natTraversal`/`ipv6`/`buddyInfoPull`/`natTraversalQuic`). Both new
  upstream (#1295, #1288), neither previously declared in `ECTagNames.ts`. `false`/all-flags-false when the tag is absent (a daemon
  predating either). Live-tested against a real daemon: of 6 clients in the upload queue, only the one actually transferring data
  read `connected: true`, the other 5 (queued, no active transfer) read `false` - confirming the fix this tag exists for (a client
  merely listed is not the same as one actually connected).
- `FriendInfo.connected` (`Update.ts`) - the same `EC_TAG_CLIENT_CONNECTED`, echoed on the friend container from its linked client.

## [2.29.2] - 2026-09-07

### Fixed

- `Categories.readFailure()` (shared by `update()`/`delete()`) now checks `EC_TAG_STRING` first and uses it verbatim when present,
  instead of assuming `EC_OP_FAILED` never carries one - tracks two upstream fixes to
  `EC_OP_UPDATE_CATEGORY`/`EC_OP_DELETE_CATEGORY` (amule-org/amule#1228, #1232). #1228: an out-of-range index used to abort the
  whole daemon with `SIGABRT`; a fixed daemon now replies `EC_OP_FAILED` with a reason instead. #1232: `EC_OP_DELETE_CATEGORY` used
  to answer `EC_OP_NOOP` unconditionally even when nothing was deleted (index 0, a malformed request, or an out-of-range index),
  silently letting a client's category list diverge from the daemon's; `delete()` gained the corresponding `EC_OP_FAILED` branch.
  Against an older daemon both paths are inert - unchanged behavior. Live-tested against a freshly rebuilt daemon with both fixes:
  `update()`/`delete()` with an out-of-range index now throw "No such category." instead of crashing the daemon; `delete(0)` throws
  "The default category cannot be deleted.".

## [2.29.1] - 2026-09-07

### Fixed

- `Servers.setStatic()`/`.setPriority()` now send `EC_TAG_SERVER_STATIC`/`_PRIO` as sibling tags on the request, alongside
  `EC_TAG_SERVER`, instead of nesting them as `EC_TAG_SERVER`'s own child. The daemon's `EC_OP_SERVER_SET_STATIC_PRIO` handler reads
  the static/priority tag with `GetTagByName()` directly on the request packet, which only scans direct children and never recurses
   - the nested tag was invisible to it, so the daemon's guard was always false and the setting silently never applied (the opcode
     always replies `EC_OP_NOOP` regardless of whether anything happened, so no error surfaced client-side either). Found by
     comparing wire traffic against `amule-remote-gui.cpp` while investigating server list checkbox/priority edits that visually
     toggled then reverted on the next refresh. Live-tested against a real daemon: the previous shape silently no-oped in every
     direction, the sibling-tag shape applies correctly every time.

## [2.29.0] - 2026-08-31

### Added

- `DownloadFile.isA4AFAuto` (`EC_TAG_PARTFILE_A4AFAUTO`) - whether A4AF sources swap to this file automatically, the read side of
  the tag `Downloads.setA4AFAuto()` already writes. Already declared and already emitted unconditionally by the daemon (present at
  every detail level `Downloads.fetch()`/notifications use), just never decoded onto `DownloadFile` - live-tested against a real
  daemon (set true, read back true; reverted to false, read back false).
- `FriendInfo.friendSlot` (`Update.ts`) - whether a friend currently holds the reserved upload slot, the read side of the same
  `EC_TAG_FRIEND_FRIENDSLOT` tag `Friends.setFriendSlot()` already writes.
- `DownloadFile.category` (`EC_TAG_PARTFILE_CAT`) - the read side of `Downloads.setCategory()`, unconditionally emitted alongside
  `stopped`/`isA4AFAuto` but never previously decoded.
- `SharedFile.comment`/`.rating` (`EC_TAG_KNOWNFILE_COMMENT`/`_RATING`) - the read side of `SharedFiles.setComment()`, distinct from
  `SharedFile.comments` (the Kad/community-notes container). Corrects `setComment()`'s own doc comment, which incorrectly claimed
  the value set this way could never be read back over EC - live-tested against a real daemon.

### Changed

- Removed artificial `| undefined` typing from fields the daemon always sends: `SharedFile.uploadedTotal`/`.uploadSpeed`/
  `.uploadingCount`/`.requestsTotal`/`.prio`/`.kadCommentSearching`/`.hashedPartCount`/`.lastUpload`; `DownloadFile.status`/
  `.sources`/`.prio`/`.sourcesXfer`; `UploadClient.software`/`.softwareVersion`/`.speedUp`/`.sessionUp`/`.totalUp`/`.uploadState`/
  `.ecid`/`.uploadFileEcid`/`.friendSlot`; `ClientHistoryEntry.uploadTotal`/`.downloadTotal`/`.lastSeen`; and
  `ServerInfo.name`/`.priority`/`.isStatic`/`.filesSoft`/`.filesHard`/`.tcpFlags`/`.udpFlags`. Each was confirmed unconditionally
  present on the wire for the request this library actually sends, and now decodes with its real default (`0n`/`false`/`""`/
  `SRV_PR_NORMAL`) instead of `undefined` - not a compile-breaking change for readers (`T` is still assignable where `T | undefined`
  was), but a caller relying on `=== undefined` to mean "not yet reported" will see a different value now.

## [2.28.0] - 2026-08-31

### Added

- `Chat.fetchHistory(clientId, cursor?)`, `Chat.sendToSession(clientId, text)`/`.sendToClient(clientEcid, text)`/
  `.sendToFriend(friendEcid, text)`, and `Chat.closeSession(clientId)`, wrapping the upstream chat session store
  (`EC_OP_GET_CHAT_SESSIONS`/`EC_OP_CHAT_SESSIONS`/`EC_OP_CHAT_SEND`/`EC_OP_CHAT_CLOSE_SESSION`) - a real client opt-in
  (`ECEngineStartOptions.chatSessions`/`ECCapabilities.chatSessions`), unlike most other capability-gated features here. New
  `chat send <session|client|friend> <id> <text>`/`chat close <client-id>`/`chat history <client-id> [cursor]` REPL commands.

### Changed

- **Breaking**: `Chat.fetch()` now polls `EC_OP_GET_CHAT_SESSIONS` and populates `Chat.sessions: readonly ChatSession[]` instead of
  `Chat.messages: readonly ChatMessage[]`. `ChatMessage` drops `senderId` and gains `id`/`direction`/`timestamp`; a message is only
  reached through its parent `ChatSession` now, never bare. Forced by upstream: it re-specified `EC_OP_GET_CHAT_MESSAGES` itself
  from a destructive, tag-less drain into the non-destructive backfill of one named session (see `Chat.ts`'s class doc and
  `amule-cpp-sync.md`), removing the old queue outright with no compatible shape left to wrap - live-tested against a rebuilt
  daemon, the previous `Chat.fetch()` now fails with `EC_OP_FAILED` ("Missing chat session id") instead of returning anything.

## [2.27.0] - 2026-08-31

### Added

- `UploadClient.friendSlot` (`EC_TAG_CLIENT_FRIEND_SLOT`) - whether this client holds the upload slot reserved for a friend, already
  declared but never decoded; already present at the `EC_DETAIL_CMD` level `Uploads.fetch()` requests.
- `Downloads.setA4AFAuto(hash, value)`, wrapping the upstream `EC_OP_PARTFILE_SET_A4AF_AUTO` opcode: sets (rather than flips) a
  download's A4AF-auto flag, complementing the existing flip-only `swapA4AFThisAuto()`. New `a4afauto <hash> <on|off>` REPL command.

### Changed

- `Search.requestMore()` now returns `Promise<boolean | undefined>` instead of `Promise<void>`, decoding the new
  `EC_TAG_SEARCH_MORE_REASKABLE` reply tag: whether a _later_ "More" press could still widen the search. `undefined` when the tag is
  absent (a daemon predating it), which must read as "not reported", not "exhausted" - existing callers that ignore the return value
  are unaffected.

## [2.26.0] - 2026-08-31

### Added

- `SharedFiles.refreshMediaMetadata(hash)`/`.refreshAllMediaMetadata()`, wrapping the upstream `EC_OP_REFRESH_MEDIA_METADATA` opcode
  (added since this library's last upstream sync): re-extracts `EC_TAG_KNOWNFILE_MEDIA_*` metadata (see `MediaMetadata`) for one
  shared file or the whole share. Not capability-gated on the daemon side, so a daemon predating it answers `EC_OP_FAILED` like any
  other rejection. `refreshAllMediaMetadata()` returns the number of probes queued (0 is legitimate - a share with no media queues
  nothing); the single-hash form returns `void` since a successful queue there is always exactly one. Live-tested against a real
  daemon.

## [2.25.0] - 2026-08-21

### Added

- `AlternateNamesCache`, a persistent JSON-backed cache of alternate filenames, and
  `ECEngineStartOptions.altNamesCachePath`/`ECEngine.altNamesCache` to wire it in - optional, no cache is created unless a path is
  given. `sourceNames` (see the 2.23.0 entry below) only exists while the daemon still tracks a file as an active partfile with
  connected sources; once it completes and leaves the download queue (or simply runs out of connected sources), that data is gone
  for good, with no way to recover it from a later `fetch()`/notification. `Downloads.fetch()`/`DownloadTracker.apply()` now feed
  the cache automatically for any file past 75% complete with at least one reported alternate name, so a caller can still look those
  names up long after the underlying protocol has forgotten them. `add()`/`remove()`/`get()` are public, so a caller-side rename
  that never went through the EC protocol at all can also update the cache directly. `init()` purges entries untouched for more than
  45 days.

## [2.24.0] - 2026-08-19

### Added

- `DownloadFile.gaps`/`.requestedRanges`/`.partAvailability` (`EC_TAG_PARTFILE_GAP_STATUS`/`_REQ_STATUS`/`_PART_STATUS`) - the data
  behind aMule's own GUI "chunk bar": missing byte ranges, ranges currently requested from peers, and per-part source-availability
  counts. RLE/XOR delta-encoded per EC connection (`RLE.h`/`RLE.cpp`) - a different scheme from `sourceNames`' id-keyed map, but
  simpler in one respect: `ResetEncoder()` _does_ clear this state, and `Downloads.fetch()`/`SharedFiles.fetch()` always trigger
  that reset, so on that path each is self-contained. `Update.fetch()` doesn't reset, so its values are genuine deltas - handled by
  the same per-connection accumulation approach as `sourceNames` (new `PartFileStatus.ts`), reused via `resetsEncoder` rather than a
  second mechanism. New `ECTag.bytesValue`/`.childBytes()` accessors, mirroring the existing `intValue`/`childInt` pair, to read
  these tags' raw binary payload.

## [2.23.0] - 2026-08-19

### Added

- `DownloadFile.sourceNames` (`EC_TAG_PARTFILE_SOURCE_NAMES`/`EC_TAG_PARTFILE_SOURCE_NAMES_COUNTS`) - alternate filenames a
  download's sources have reported, id -> `{ name, count }`. Delta-encoded per EC connection, and - unlike every other field on
  `DownloadFile` - _not_ reset by a fresh `Downloads.fetch()` either, nor scoped to the request type that triggered it: the daemon
  tracks it per connection per file, shared across `Downloads`, `SharedFiles` and `Update` alike (see the class doc). `fromTag()`/
  `parseNotification()` hide this behind a per-connection cache (`PartFileSourceNames.ts`) that both classes feed and read, so
  `sourceNames` always reflects everything a connection has ever been told, regardless of which class's request or how many
  fetch()/notification cycles it took to arrive - no protocol awareness required from callers

## [2.22.0] - 2026-08-16

### Added

- `SharedFile.hashedPartCount`/`.lastUpload`/`.sharedSince` - "Verify Local Data" hash-check progress
  (`EC_TAG_KNOWNFILE_HASHED_PART_COUNT`) and last-upload/share-since timestamps (`EC_TAG_KNOWNFILE_LAST_UPLOAD`/
  `EC_TAG_KNOWNFILE_SHARED_SINCE`), all already declared but never decoded
- `ClientUpdate.isFriend`/`.scoreRatio` (`EC_TAG_CLIENT_IS_FRIEND`/`EC_TAG_CLIENT_SCORE_RATIO`) - friends-list membership and the
  GUI's "DL/UP modifier", only sent at the `EC_DETAIL_INC_UPDATE` level `Update.fetch()` already uses
- `MediaMetadata` (new shared class in `SharedFiles.ts`) and `DownloadFile.media`/`SharedFile.media`/`SearchResult.media` - probed
  audio/video metadata (`EC_TAG_KNOWNFILE_MEDIA_LENGTH`/`.MEDIA_BITRATE`/`.MEDIA_CODEC`/`.MEDIA_ARTIST`/`.MEDIA_ALBUM`/
  `.MEDIA_TITLE`), undefined for unprobed/non-media files
- Grouped search results (issue #431): `SearchSession.fetch()` now always sends an empty `EC_TAG_SEARCH_PARENT` flag to opt into
  same-hash/same-size-but-different-filename children, each carrying the new `SearchResult.parent` (the parent's ecid, undefined for
  a top-level result); `Search.download()`'s entries can now be `{ hash, ecid }` instead of a plain hash string, to select one
  specific grouped child instead of the default parent
- `ECSearchType.BROWSE` and `KnownSearch.browsePeerEcid` - `EC_OP_SEARCH_LIST` now also lists "View Files" browse tabs, previously
  undecodable; `Search.list()`'s doc corrected (it used to claim browses were excluded)
- `ClientHistory`/`ClientHistoryEntry` classes (`EC_OP_GET_CLIENT_HISTORY`/`EC_OP_CLIENT_HISTORY`) - the daemon's persisted
  credit-store history (every peer ever exchanged data with, keyed by user hash - not the live client list), guarded on the new
  `ECConnection.remoteCapabilities.clientHistory`
- `Update.ts`'s `ipFromTag`/`ipFromUint32` helpers are now exported, reused by `ClientHistory.ts`

### Changed

- `tests/repl/views/downloads.ts`/`uploads.ts` now print `DownloadFile.priorityText`/`.statusText`/`UploadClient.softwareText`
  instead of the raw numeric/code fields

## [2.21.0] - 2026-08-16

### Added

- `ECConnection.sessionId` - the daemon process's `EC_TAG_SESSION_ID`, echoed on every `AUTH_OK`. Lets a caller that indexes state
  by ECID across a `reconnect()` detect a daemon restart (ECIDs restart from 0) and discard stale state instead of silently
  mismatching it to new objects.
- `Status.tempFreeSpace`/`.incomingFreeSpace` - free disk space in bytes on the Temp/Incoming directories
  (`EC_TAG_STATS_TEMP_FREE_SPACE`/`EC_TAG_STATS_INCOMING_FREE_SPACE`). Only sent at `EC_DETAIL_FULL`, which `Status.fetch()`'s stats
  request now uses instead of `EC_DETAIL_CMD` - a strictly larger reply, no existing field lost.
- `Status.ed2kConnectedSince`/`.kadConnectedSince` - Unix timestamps of when the current eD2k/Kad connection was established,
  decoded from the connection-state reply.
- `ServerInfo.filesSoft`/`.filesHard`/`.tcpFlags`/`.udpFlags` - per-server publishing limits and wire capability flag bitmasks,
  already present at the `EC_DETAIL_FULL` level `Servers.fetch()` already requests.

## [2.20.0] - 2026-08-16

### Added

- `DownloadFile.path`/`SharedFile.path` - the on-disk directory (`EC_TAG_KNOWNFILE_PATH`): the Temp dir while downloading and the
  destination dir once complete for a download, the shared directory root for a shared file. Disambiguates same-named files living
  in different directories.

## [2.19.0] - 2026-08-16

### Added

- `StatsGraphs.depth` - how many points the daemon can actually answer at the scale used in the reply (`EC_TAG_STATSGRAPH_DEPTH`,
  `CStatistics::GetPointsPerRange()`). Lets a caller cap the next `fetch()`'s `width` instead of guessing - over-asking doesn't
  error, the daemon repeats the last known record to pad the reply, and there's no per-point timestamp on the wire to detect that
  from `points` alone.

## [2.18.0] - 2026-08-15

### Added

- `UploadClient.uploadFileEcid` - the uploaded file's own internal ECID (`EC_TAG_CLIENT_UPLOAD_FILE`), `0n` when the client has no
  upload file assigned. The upload entry itself never carries the file's hash, only its ECID - correlate against `SharedFile.ecid`
  (`SharedFiles.files`) to resolve the hash needed by `SharedFiles.searchKadNotes()`.

## [2.17.0] - 2026-08-15

### Added

- `UploadClient.softwareVersion`/`.softwareText` - the version-only string (`EC_TAG_CLIENT_SOFT_VER_STR`) and a human-readable
  software name decoded client-side from `UploadClient.software` (the daemon never sends that name as text over EC), mirroring
  `GetSoftName()` (`DataToText.cpp`). New `ECClientSoftware` enum, confirmed against `EClientSoftware`
  (`include/protocol/ed2k/ClientSoftware.h`).

## [2.16.0] - 2026-08-13

### Changed

- `Servers.setStaticPrio(ecid, { static?, prio? })` replaced by `Servers.setStatic(ecid, isStatic)` and
  `Servers.setPriority(ecid, prio)` - the combined options-object shape mirrored what the wire opcode technically permits (either or
  both children in one packet), not how anything actually calls it: `amule-remote-gui.cpp`'s own
  `SetStaticServer()`/`SetServerPrio()` already issue them separately, one child tag each. **Breaking**: replace
  `servers.setStaticPrio(ecid, { static })` with `servers.setStatic(ecid, static)`, and `servers.setStaticPrio(ecid, { prio })` with
  `servers.setPriority(ecid, prio)`.

## [2.15.0] - 2026-08-13

### Added

- `ServerInfo.priority`/`ServerInfo.isStatic` - `Servers.fetch()` already requests `EC_DETAIL_FULL`, which carries
  `EC_TAG_SERVER_PRIO`/ `EC_TAG_SERVER_STATIC` on every `EC_TAG_SERVER` entry, but `ServerInfo` didn't decode them -
  `Servers.setStaticPrio()` was write-only, with no way to read a server's current priority/static-pin state back. Same decoding
  `ServerUpdate` (`Update.ts`) already applies to the identical tags.

## [2.14.0] - 2026-08-05

### Added

- `Friends.browseSharedFiles(clientEcid)` - browses a currently-connected client's shared files ("View Files" in the reference GUI),
  via `EC_OP_FRIEND`'s previously-unwrapped `EC_TAG_FRIEND_SHARED` mode. Requires `multiSearch` (the daemon only allocates a search
  ID for the browse once it's negotiated); returns a `SearchSession` - the daemon's reply reuses that exact shape, so
  polling/fetching a browse works identically to a regular search. Live-verified against a real daemon (147 real results from one
  peer).

### Changed

- `SearchSession`'s class doc now explains why no client-side correlation token (`EC_TAG_SEARCH_REF`) is needed for concurrent
  searches in an async/await client, and clarifies the real limit on "multiple search tabs": independent Kad searches can run in
  parallel, but ed2k (local/global) searches share one in-flight slot per connection.

## [2.13.0] - 2026-08-05

### Added

- `StatsTree` class (`EC_OP_GET_STATSTREE`/`EC_OP_STATSTREE`) - the daemon's statistics tree, mirroring the aMule GUI's "Statistics"
  tab. Despite 14 different C++ node classes server-side, the wire shape is uniformly generic (one recursive `EC_TAG_STATTREE_NODE`
  per node, `EC_TAG_STAT_NODE_VALUE` for its value(s)), so a single `StatNode`/ `StatValue` pair covers every case - no
  per-node-type modeling needed. New `ECStatValueType` enum for the value's display-format hint. `StatNode.findByKey()` looks up a
  node by its stable, locale-independent key rather than matching against the untranslated-but-still-prose label. This completes EC
  protocol coverage: the library now wraps all 88 declared opcodes.

## [2.12.0] - 2026-08-05

### Added

- `Update` class (`EC_OP_GET_UPDATE`) - amuleGUI's combined incremental-update feed, bundling shared files, downloads, clients,
  servers and the friend list into a single poll. New `ClientUpdate`/`ServerUpdate`/`FriendInfo` classes (richer, mergeable siblings
  of `UploadClient`/`ServerInfo` - this opcode's per-connection value-map diffing can omit any field unchanged since the
  connection's last poll, so every entry merges onto the previous snapshot rather than replacing it) and
  `ECClientSourceFrom`/`ECIdentState` enums. `Update.fetch()` always sends `EC_DETAIL_LEVEL = EC_DETAIL_INC_UPDATE`
   - omitting it routes the daemon into the same `wxFAIL`/`EC_OP_FAILED` path as an actually-unknown opcode.

### Fixed

- Wired up `ECCapabilities.partialUpdate`, previously declared but never actually sent or read: `EC_TAG_CAN_PARTIAL_UPDATE` is now
  unconditionally advertised at auth (same shape as `sharedDirsConfig`/`searchList`) and its echo is read into
  `remoteCapabilities.partialUpdate`, which `Update.fetch()` requires.

## [2.11.0] - 2026-08-04

### Added

- `Preferences.getGeneral`/`setGeneral` (`EC_TAG_PREFS_GENERAL`), `getRemoteControls`/`setRemoteControls`
  (`EC_TAG_PREFS_REMOTECTRL`), and `getIP2Country`/`setIP2Country` (`EC_TAG_PREFS_IP2COUNTRY`) - fifth and last of the planned
  `Preferences` batches. New `ECGeoIPSource` enum and `AmuleApiAccountPrefs` interface (shared shape for the three
  differently-nested password-hash fields in `RemoteControlsPrefs` - webserver admin, webserver guest, amuleapi admin, amuleapi
  guest - each with its own set/clear semantics, documented on the interface). This completes all 14 GET/SET_PREFERENCES sections
  except the never-implemented `STATISTICS` stub (a literal `#warning TODO` upstream).

## [2.10.1] - 2026-08-04

### Added

- 5 new EC tags declared after a fresh upstream C++ pull (4 for the new X25519 handshake, 1 verify-local-data progress counter) -
  declaration only, no class wraps these yet. See CONTRIBUTING.md's tracking policy.

## [2.10.0] - 2026-08-04

### Added

- `Preferences.getSecurity`/`setSecurity` (`EC_TAG_PREFS_SECURITY`), `getOnlineSig`/`setOnlineSig` (`EC_TAG_PREFS_ONLINESIG`),
  `getServers`/`setServers` (`EC_TAG_PREFS_SERVERS` - the preferences section, distinct from the `Servers` class), and
  `getKademlia`/`setKademlia` (`EC_TAG_PREFS_KADEMLIA`), fourth of five planned `Preferences` batches. New `ECVisibleShareAccess`
  enum for `SecurityPrefs.canSeeShares` (another explicit-uint8, non-presence-encoded boolean-like field). Excludes
  `EC_TAG_SERVERS_URL_LIST` from `ServersPrefs` - like the two dead FILES tags found in the previous batch, it's declared in
  `ECTagNames.ts` but was never implemented upstream (the reply builder has a literal "Here should come the URL list..." comment in
  its place).

## [2.9.0] - 2026-08-04

### Added

- `Preferences.getFiles`/`setFiles` (`EC_TAG_PREFS_FILES`) and `getDirectories`/`setDirectories` (`EC_TAG_PREFS_DIRECTORIES`), third
  of five planned `Preferences` batches. `DirectoriesPrefs.sharedDirs` mirrors the same shared-directory list as
  `SharedFiles.getSharedDirs`/ `setSharedDirs` but as a flat path list with no per-directory `recursive` flag - prefer the dedicated
  opcode for that. Found and documented (in `FilesPrefs`'s doc comment) that two tags already declared in `ECTagNames.ts`
  (`EC_TAG_FILES_UL_FULL_CHUNKS`, `EC_TAG_FILES_EXTRACT_METADATA`) are dead/nonexistent in the current daemon and are excluded from
  this wrapper's interface.

## [2.8.0] - 2026-08-04

### Added

- `Preferences.getConnections`/`setConnections` (`EC_TAG_PREFS_CONNECTIONS`), second of five planned `Preferences` batches. New
  `ECProxyType` enum and `ProxyPrefs` interface for the section's nested proxy sub-group. Documents a third protocol quirk on top of
  the two already noted for MessageFilter/ CoreTweaks: within this one section, `proxy.enabled`/`proxy.enablePassword`/
  `upnpEnabled` are NOT presence-encoded like every other boolean here - they're sent as explicit 0/1 int tags, unconditionally.

## [2.7.0] - 2026-08-04

### Added

- `Preferences` service (`EC_OP_GET_PREFERENCES`/`EC_OP_SET_PREFERENCES`), first of five planned batches covering the protocol's 14
  preference sections: `getMessageFilter`/`setMessageFilter`, `getCoreTweaks`/`setCoreTweaks`, and the read-only `listCategories`
  bonus (the `EC_TAG_PREFS_CATEGORIES` section, out of `Categories`'s own scope). New `ECPreferencesSelection` enum for the
  `EC_TAG_SELECT_PREFS` bitmask. Documents two protocol quirks: a GET_PREFERENCES reply carries opcode `EC_OP_SET_PREFERENCES` on
  the wire, and boolean fields are presence-encoded (a set*() call always fully replaces its section, sent at `EC_DETAIL_UPDATE`).

## [2.6.0] - 2026-08-04

### Added

- `Search.requestMore` (`EC_OP_SEARCH_REQUEST_MORE`) and `Search.list` (`EC_OP_SEARCH_LIST`, returning `KnownSearch[]`) - the two
  opcodes deliberately deferred out of the original multi-search batch. `Search.list` is guarded on a new negotiated capability,
  `ECCapabilities.searchList`, following the same unconditionally-advertised pattern as `sharedDirsConfig`.

## [2.5.0] - 2026-08-04

### Added

- `StatsGraphs` service: `fetch` for the daemon's transfer-history graph (`EC_OP_GET_STATSGRAPHS`/`EC_OP_STATSGRAPHS`), including
  incremental polling via the echoed `last` timestamp.
- `ECDoubleTag` is now exported, and `ECTag` gained `doubleValue`/ `childDouble` helpers (mirroring the existing integer ones) - the
  first opcode in this library to carry a double-valued tag.

### Fixed

- `ECConnection.close()` no longer triggers `ECEngine`'s automatic reconnect loop. Previously, any deliberate shutdown (e.g. the
  REPL exiting) still fired the same "disconnected" event as an unexpected drop, so it reconnected anyway and then never closed that
  new socket - leaking a live connection that kept the process running forever. Found live: 17 orphaned `tests/repl/main.ts`
  processes, one per live smoke test performed earlier in the same development session, were still running.

## [2.4.0] - 2026-08-04

### Added

- `IPFilter` service: `reload`/`updateFromUrl` (`EC_OP_IPFILTER_RELOAD`/ `EC_OP_IPFILTER_UPDATE`).
- `Daemon.checkVersion` (`EC_OP_VERSION_CHECK`).
- `Uploads.swapClientToAnotherFile` (`EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE`).
- `SharedFiles.verifyLocalData` (`EC_OP_VERIFY_LOCAL_DATA`).

## [2.3.0] - 2026-08-04

### Added

- `Servers.remove`/`add`/`updateFromUrl` (`EC_OP_SERVER_REMOVE`/ `EC_OP_SERVER_ADD`/`EC_OP_SERVER_UPDATE_FROM_URL`).
- `SharedFiles.setPriority` (`EC_OP_SHARED_SET_PRIO`) and `SharedFiles.getSharedDirs`/`setSharedDirs` (`EC_OP_GET_SHARED_DIRS`/
  `EC_OP_SET_SHARED_DIRS`) - the latter two guarded on a new negotiated capability, `ECCapabilities.sharedDirsConfig`, since a
  daemon that doesn't support them can hit an assertion failure if sent anyway (confirmed live against aMule 2.3.3).

### Fixed

- The REPL (`tests/repl/main.ts`) no longer exits its whole session on the first command that throws - each command's error is now
  caught and reported without ending the loop.

## [2.2.0] - 2026-08-04

### Added

- `Categories` service: `create`/`update`/`delete` for the daemon's download categories
  (`EC_OP_CREATE_CATEGORY`/`EC_OP_UPDATE_CATEGORY`/ `EC_OP_DELETE_CATEGORY`).
- `Downloads.swapA4AFThis`/`swapA4AFThisAuto`/`swapA4AFOthers` (A4AF source swapping, `EC_OP_PARTFILE_SWAP_A4AF_*`) and
  `Downloads.setCategory` (`EC_OP_PARTFILE_SET_CAT`).

## [1.0.0] - 2026-08-02

### Added

- EC protocol client: connection, challenge/response authentication (MD5-hashed password), automatic reconnect with exponential
  backoff.
- `Downloads`, `Uploads`, `Servers`, `SharedFiles`, `Status`, `Log`, `Search` services, each covering its EC_OP_* request/reply pair
  and, where applicable, server-pushed notifications.
- Zero-dependency, per-topic run-time tracing via `NODE_DEBUG` (see README.md's "Debugging" section).
