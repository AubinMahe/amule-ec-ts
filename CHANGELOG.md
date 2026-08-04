# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/).

Beyond bug fixes, future changes are driven by the upstream
[amule-org/amule](https://github.com/amule-org/amule) C++ project: new EC
opcodes/tags or protocol behavior changes there are what this client
tracks - see CONTRIBUTING.md for how such changes are verified against that
source before being reflected here.

## [Unreleased]

## [2.11.0] - 2026-08-04

### Added

- `Preferences.getGeneral`/`setGeneral` (`EC_TAG_PREFS_GENERAL`),
  `getRemoteControls`/`setRemoteControls` (`EC_TAG_PREFS_REMOTECTRL`), and
  `getIP2Country`/`setIP2Country` (`EC_TAG_PREFS_IP2COUNTRY`) - fifth and
  last of the planned `Preferences` batches. New `ECGeoIPSource` enum and
  `AmuleApiAccountPrefs` interface (shared shape for the three
  differently-nested password-hash fields in `RemoteControlsPrefs` -
  webserver admin, webserver guest, amuleapi admin, amuleapi guest - each
  with its own set/clear semantics, documented on the interface). This
  completes all 14 GET/SET_PREFERENCES sections except the
  never-implemented `STATISTICS` stub (a literal `#warning TODO` upstream).

## [2.10.1] - 2026-08-04

### Added

- 5 new EC tags declared after a fresh upstream C++ pull (4 for the new
  X25519 handshake, 1 verify-local-data progress counter) - declaration
  only, no class wraps these yet. See CONTRIBUTING.md's tracking policy.

## [2.10.0] - 2026-08-04

### Added

- `Preferences.getSecurity`/`setSecurity` (`EC_TAG_PREFS_SECURITY`),
  `getOnlineSig`/`setOnlineSig` (`EC_TAG_PREFS_ONLINESIG`),
  `getServers`/`setServers` (`EC_TAG_PREFS_SERVERS` - the preferences
  section, distinct from the `Servers` class), and
  `getKademlia`/`setKademlia` (`EC_TAG_PREFS_KADEMLIA`), fourth of five
  planned `Preferences` batches. New `ECVisibleShareAccess` enum for
  `SecurityPrefs.canSeeShares` (another explicit-uint8, non-presence-encoded
  boolean-like field). Excludes `EC_TAG_SERVERS_URL_LIST` from
  `ServersPrefs` - like the two dead FILES tags found in the previous
  batch, it's declared in `ECTagNames.ts` but was never implemented
  upstream (the reply builder has a literal "Here should come the URL
  list..." comment in its place).

## [2.9.0] - 2026-08-04

### Added

- `Preferences.getFiles`/`setFiles` (`EC_TAG_PREFS_FILES`) and
  `getDirectories`/`setDirectories` (`EC_TAG_PREFS_DIRECTORIES`), third of
  five planned `Preferences` batches. `DirectoriesPrefs.sharedDirs` mirrors
  the same shared-directory list as `SharedFiles.getSharedDirs`/
  `setSharedDirs` but as a flat path list with no per-directory `recursive`
  flag - prefer the dedicated opcode for that. Found and documented (in
  `FilesPrefs`'s doc comment) that two tags already declared in
  `ECTagNames.ts` (`EC_TAG_FILES_UL_FULL_CHUNKS`,
  `EC_TAG_FILES_EXTRACT_METADATA`) are dead/nonexistent in the current
  daemon and are excluded from this wrapper's interface.

## [2.8.0] - 2026-08-04

### Added

- `Preferences.getConnections`/`setConnections` (`EC_TAG_PREFS_CONNECTIONS`),
  second of five planned `Preferences` batches. New `ECProxyType` enum and
  `ProxyPrefs` interface for the section's nested proxy sub-group. Documents
  a third protocol quirk on top of the two already noted for MessageFilter/
  CoreTweaks: within this one section, `proxy.enabled`/`proxy.enablePassword`/
  `upnpEnabled` are NOT presence-encoded like every other boolean here -
  they're sent as explicit 0/1 int tags, unconditionally.

## [2.7.0] - 2026-08-04

### Added

- `Preferences` service (`EC_OP_GET_PREFERENCES`/`EC_OP_SET_PREFERENCES`),
  first of five planned batches covering the protocol's 14 preference
  sections: `getMessageFilter`/`setMessageFilter`,
  `getCoreTweaks`/`setCoreTweaks`, and the read-only `listCategories`
  bonus (the `EC_TAG_PREFS_CATEGORIES` section, out of `Categories`'s own
  scope). New `ECPreferencesSelection` enum for the `EC_TAG_SELECT_PREFS`
  bitmask. Documents two protocol quirks: a GET_PREFERENCES reply carries
  opcode `EC_OP_SET_PREFERENCES` on the wire, and boolean fields are
  presence-encoded (a set*() call always fully replaces its section, sent
  at `EC_DETAIL_UPDATE`).

## [2.6.0] - 2026-08-04

### Added

- `Search.requestMore` (`EC_OP_SEARCH_REQUEST_MORE`) and `Search.list`
  (`EC_OP_SEARCH_LIST`, returning `KnownSearch[]`) - the two opcodes
  deliberately deferred out of the original multi-search batch.
  `Search.list` is guarded on a new negotiated capability,
  `ECCapabilities.searchList`, following the same unconditionally-advertised
  pattern as `sharedDirsConfig`.

## [2.5.0] - 2026-08-04

### Added

- `StatsGraphs` service: `fetch` for the daemon's transfer-history graph
  (`EC_OP_GET_STATSGRAPHS`/`EC_OP_STATSGRAPHS`), including incremental
  polling via the echoed `last` timestamp.
- `ECDoubleTag` is now exported, and `ECTag` gained `doubleValue`/
  `childDouble` helpers (mirroring the existing integer ones) - the first
  opcode in this library to carry a double-valued tag.

### Fixed

- `ECConnection.close()` no longer triggers `ECEngine`'s automatic
  reconnect loop. Previously, any deliberate shutdown (e.g. the REPL
  exiting) still fired the same "disconnected" event as an unexpected
  drop, so it reconnected anyway and then never closed that new socket -
  leaking a live connection that kept the process running forever. Found
  live: 17 orphaned `tests/repl/main.ts` processes, one per live smoke
  test performed earlier in the same development session, were still
  running.

## [2.4.0] - 2026-08-04

### Added

- `IPFilter` service: `reload`/`updateFromUrl` (`EC_OP_IPFILTER_RELOAD`/
  `EC_OP_IPFILTER_UPDATE`).
- `Daemon.checkVersion` (`EC_OP_VERSION_CHECK`).
- `Uploads.swapClientToAnotherFile` (`EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE`).
- `SharedFiles.verifyLocalData` (`EC_OP_VERIFY_LOCAL_DATA`).

## [2.3.0] - 2026-08-04

### Added

- `Servers.remove`/`add`/`updateFromUrl` (`EC_OP_SERVER_REMOVE`/
  `EC_OP_SERVER_ADD`/`EC_OP_SERVER_UPDATE_FROM_URL`).
- `SharedFiles.setPriority` (`EC_OP_SHARED_SET_PRIO`) and
  `SharedFiles.getSharedDirs`/`setSharedDirs` (`EC_OP_GET_SHARED_DIRS`/
  `EC_OP_SET_SHARED_DIRS`) - the latter two guarded on a new negotiated
  capability, `ECCapabilities.sharedDirsConfig`, since a daemon that
  doesn't support them can hit an assertion failure if sent anyway
  (confirmed live against aMule 2.3.3).

### Fixed

- The REPL (`tests/repl/main.ts`) no longer exits its whole session on the
  first command that throws - each command's error is now caught and
  reported without ending the loop.

## [2.2.0] - 2026-08-04

### Added

- `Categories` service: `create`/`update`/`delete` for the daemon's download
  categories (`EC_OP_CREATE_CATEGORY`/`EC_OP_UPDATE_CATEGORY`/
  `EC_OP_DELETE_CATEGORY`).
- `Downloads.swapA4AFThis`/`swapA4AFThisAuto`/`swapA4AFOthers` (A4AF source
  swapping, `EC_OP_PARTFILE_SWAP_A4AF_*`) and `Downloads.setCategory`
  (`EC_OP_PARTFILE_SET_CAT`).

## [1.0.0] - 2026-08-02

### Added

- EC protocol client: connection, challenge/response authentication
  (MD5-hashed password), automatic reconnect with exponential backoff.
- `Downloads`, `Uploads`, `Servers`, `SharedFiles`, `Status`, `Log`, `Search`
  services, each covering its EC_OP_* request/reply pair and, where
  applicable, server-pushed notifications.
- Zero-dependency, per-topic run-time tracing via `NODE_DEBUG` (see
  README.md's "Debugging" section).
