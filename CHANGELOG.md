# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

Beyond bug fixes, future changes are driven by the upstream [amule-org/amule](https://github.com/amule-org/amule) C++ project: new
EC opcodes/tags or protocol behavior changes there are what this client tracks - see CONTRIBUTING.md for how such changes are
verified against that source before being reflected here.

## [Unreleased]

## [2.23.0] - 2026-08-19

### Added

- `DownloadFile.sourceNames` (`EC_TAG_PARTFILE_SOURCE_NAMES`/`EC_TAG_PARTFILE_SOURCE_NAMES_COUNTS`) - alternate filenames a
  download's sources have reported, id -> `{ name, count }`. Delta-encoded per EC connection (see the class doc): a
  `Downloads.fetch()` result is always complete, but a lone push notification can be a partial update - correctly accumulated across
  notifications by `DownloadFile.mergedWith()`, so `DownloadTracker` picks it up with no change needed there

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
