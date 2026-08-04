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
