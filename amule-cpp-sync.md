# `C++ amule` vs `amule-ec-ts`

## Role of this file

List of differences to analyze point by point, on every fetch/pull.

Points recorded here must be sorted into TODO.md, ISSUES.md, or CHOICES.md.

## Method

Mechanical diff of the `EC_OP_*`/`EC_TAG_*` enums (generated C++ vs `ECOpcode.ts`/ `ECTagNames.ts`) for pure novelties, then
commit-by-commit review (the actual diff, not just the message) for behavior changes on protocol already ported.

**Blind spot**: neither pass catches a tag that was already declared before the sync window and is used for more than one purpose in
the C++ source (e.g. read on one struct's encoder, written as a request child elsewhere) when only one of those uses is decoded
here. The novelty diff only flags tags/opcodes absent from the previous baseline, and the commit-by-commit pass only looks at
commits landing inside the sync window - a tag's _other_, pre-existing usage sailing right past both. Example:
`EC_TAG_PARTFILE_A4AFAUTO` (0x0321), already declared before the 2026-08-31 sync, used to decode `Downloads.setA4AFAuto()`'s
request, but its read-side emission in `CEC_PartFile_Tag` (unconditional, present since long before this session) was never decoded
onto `DownloadFile` - same root cause as `EC_TAG_CLIENT_FRIEND_SLOT` (see TODO.md's "Tags, declared but not decoded" section).
Catching the rest of this class systematically requires a different pass: every `ECTagNames.ts` entry checked against every C++ site
that reads or writes it, not just against the previous sync's enum baseline - see the "Systematic tag audit" entry below.

**Systematic tag audit, 2026-08-31**: every one of the 425 `ECTagNames.ts` entries checked for at least one reference elsewhere in
`src/` (425 total, 80 with zero hits) via a scripted cross-reference, then each of those 80 checked individually against the C++
source (`AddTag`/`CECTag` construction sites) to classify it: already tracked (the AEAD tags, `EC_TAG_CAN_SEARCH_PROGRESS_UNION`),
genuinely dead protocol surface (4 tags with zero C++ references at all, 4 more whose only C++ references are commented-out
`AddTag()` calls), a case where sending the tag is actively wrong (`EC_TAG_VERSION_ID`), a deliberate non-implementation
(`EC_TAG_PREFS_STATISTICS`), or a real decode gap - sorted into TODO.md's "Tags, declared but not decoded" section, grouped by the
`amule-ec-ts` class each would extend (`Status.ts`, `Downloads.ts`, `SharedFiles.ts`, `Update.ts`, `Search.ts`).

A tag _with_ existing usage can still be under-decoded the same way `EC_TAG_PARTFILE_A4AFAUTO`/`EC_TAG_CLIENT_FRIEND_SLOT` were
(used in one C++ context, silently unread in another) - the pass above only checked the 80 tags with _zero_ usage, not a per-tag
audit of every C++ emission site for the other 345.

**Second pass, 2026-08-31**: all 345 "used" tags checked for whether that usage is a genuine _read_ - including via helpers not
matched by simple `child*()`/`find*()` calls (`has()`/`flag()` in `Preferences.ts` and capability negotiation, `ipFromTag()`,
`switch`/`case` branches) - versus only ever building a _request_ tag, with no read of any reply. The request-only bucket contained
three real gaps: `EC_TAG_KNOWNFILE_COMMENT`/`_RATING`, `EC_TAG_FRIEND_FRIENDSLOT`, `EC_TAG_PARTFILE_CAT` - all three now decoded
(`SharedFile.comment`/`.rating`, `FriendInfo.friendSlot`, `DownloadFile.category`). The comment/rating case also contradicted
`SharedFiles.ts`'s then-existing doc comment (dated 2026-08-03), which stated the value could not be read back over EC at all - that
comment was incorrect (confirmed live: setting a shared file's comment/rating via `SharedFiles.setComment()`, then reading the raw
`EC_OP_GET_SHARED_FILES` reply, shows both tags present with the value just set) and has been corrected.

## 2026-10-31

Local C++ checkout pulled (HEAD `f0f054ce3`, 632 commits ahead of the 2026-09-20 baseline `23dda72d8`).

### Mechanical diff of `ECCodes.abstract`

- **2 new opcodes**:
   - `EC_OP_GET_KAD_LOOKUPS` (`0x69`, #1741): user-triggered bounded Kad lookup diagnostics snapshot. Reply contains
     `EC_TAG_KAD_LOOKUP` children with typed peer and referral records. Gated on server capability `EC_TAG_CAN_KAD_LOOKUPS`
     (`0x002A`).
   - `EC_OP_KNOWNFILE_DELETE` (`0x6A`, #1950): deletes a completed shared file from disk. Requires `EC_TAG_KNOWNFILE` (MD4),
     `EC_TAG_ECID`, `EC_TAG_KNOWNFILE_PATH` (directory), and `EC_TAG_PARTFILE_NAME` (basename). Returns `EC_OP_NOOP` on success,
     `EC_OP_FAILED` + `EC_TAG_STRING` on failure. Gated on server capability `EC_TAG_CAN_DELETE_COMPLETE` (`0x002B`) advertised in
     `AUTH_OK`.
- **3 tags retired / removed**:
   - `EC_TAG_PASSWD_SALT` (`0x000B`): replaced by SRP-6a challenge salt (`EC_TAG_SRP_SALT`).
   - `EC_TAG_AEAD_CLIENT_CONFIRM` (`0x0023`) / `EC_TAG_AEAD_SERVER_CONFIRM` (`0x0024`): legacy password-keyed AEAD confirmation tags
     retired in favor of SRP proofs M1/M2.
- **6 new capability and connection tags**:
   - `EC_TAG_CAN_CHAT_PEER_HASH` (`0x0028`, #1551): client advertises support for `EC_TAG_CHAT_PEER_HASH` in chat operations.
   - `EC_TAG_CAN_SEARCH_ALL` (`0x0029`, #1670): server accepts simultaneous eD2k+Kad search (`EC_SEARCH_ALL`).
   - `EC_TAG_CAN_KAD_LOOKUPS` (`0x002A`, #1741): server supports `EC_OP_GET_KAD_LOOKUPS`.
   - `EC_TAG_CAN_DELETE_COMPLETE` (`0x002B`, #1950): server supports disk deletion via `EC_OP_KNOWNFILE_DELETE`.
   - `EC_TAG_NETWORKS_ENABLED` (`0x002C`, #2010): optional child of `EC_TAG_CONNSTATE` (uint8: bit 0 = ED2K, bit 1 = Kad).
- **7 new SRP-6a authentication tags** (#2032-#2035):
   - `EC_TAG_SRP_A` (`0x002D`): client ephemeral public key A (384 bytes, RFC 5054 3072-bit group).
   - `EC_TAG_SRP_B` (`0x002E`): server public key B (384 bytes).
   - `EC_TAG_SRP_PROFILE` (`0x002F`): KDF profile (4 bytes: `01 0f 08 01` for scrypt N=32768, r=8, p=1).
   - `EC_TAG_SRP_SALT` (`0x0030`): 16-byte random challenge salt.
   - `EC_TAG_SRP_CREDENTIAL` (`0x0031`): credential selector (0 = password, 1 = API token, 2 = amuleweb token).
   - `EC_TAG_SRP_M1` (`0x0032`): client proof M1 (32 bytes HMAC-SHA256).
   - `EC_TAG_SRP_M2` (`0x0033`): server proof M2 (32 bytes HMAC-SHA256).
- **1 new search kind & 4 search tags** (#1670):
   - `EC_SEARCH_ALL` (`0x05`): combined eD2k + Kad search.
   - `EC_TAG_SEARCH_KAD_ACTIVE` (`0x0717`) / `EC_TAG_SEARCH_ED2K_ACTIVE` (`0x071A`): reports active network components
     independently.
   - `EC_TAG_SEARCHFILE_ED2K_SOURCES` (`0x0718`) / `EC_TAG_SEARCHFILE_KAD_SOURCES` (`0x0719`): split source counts per network.
- **5 new chat & CAPTCHA tags**:
   - `EC_TAG_CHAT_PEER_HASH` (`0x0908`, #1551): peer MD4 hash, for peers unreachable via `GUI_ID` (IPv6, ambiguous or provisional).
   - `EC_TAG_CHAT_MESSAGE_KIND` (`0x0909`, #1829/#2089): message kind (0 text, 1 CAPTCHA challenge, 2 CAPTCHA result).
   - `EC_TAG_CHAT_CAPTCHA_IMAGE` (`0x090A`): base64-encoded validated BMP challenge.
   - `EC_TAG_CHAT_CAPTCHA_STATUS` (`0x090B`): challenge outcome (0 accepted, 1 retry allowed, 2 no attempts remain).
   - `EC_TAG_CHAT_CAPTCHA_ID` (`0x090C`): pending challenge message ID.
- **5 new statistics & partfile tags**:
   - `EC_TAG_STATS_KAD_DISTRIBUTION` (`0x021E`, #1743): fixed-size contact histogram.
   - `EC_TAG_STATS_SESSION_SENT_BYTES` (`0x021F`) / `EC_TAG_STATS_SESSION_RECEIVED_BYTES` (`0x0220`): session transfer totals.
   - `EC_TAG_STATS_ACTIVE_CONNECTIONS` (`0x0221`) / `EC_TAG_STATS_UPTIME_SECONDS` (`0x0222`): live metrics on `EC_OP_STATS`.
   - `EC_TAG_PARTFILE_SPEED_SMOOTHED` (`0x0324`, #2007): smoothed transfer rate (KiB/s) for time-remaining calculations.
- **3 new knownfile verification tags & 2 file preferences tags**:
   - `EC_TAG_KNOWNFILE_VERIFY_DATE` (`0x041D`, #1691) / `_VERIFY_CORRUPT_MD4` (`0x041E`) / `_VERIFY_CORRUPT_AICH` (`0x041F`):
     results of local data verification.
   - `EC_TAG_FILES_SHARED_REVERIFY_DAYS` (`0x1816`, #1948): scheduled verification interval.
   - `EC_TAG_FILES_MEDIA_METADATA_AVAILABLE` (`0x1817`, #2185): whether media metadata extraction helper is available.
- **1 server update flag**:
   - `EC_TAG_SERVER_UPDATE_BUSY` (`0x0513`, #1923): optional flag on `EC_OP_FAILED` when server list update is refused during an
     active download.
- **15 new preferences tags**:
   - `EC_TAG_MSGFILTER_ADVANCED` (`0x140A`) / `EC_TAG_MSGFILTER_CAPTCHA` (`0x140B`, #2089): spam protection settings.
   - `EC_TAG_EXTERNALCONN_ENABLED` (`0x150C`) through `EC_TAG_EXTERNALCONN_PASSWD` (`0x1513`, #1614): read-only reporting of the EC
     listener configuration.
   - `EC_TAG_CONN_ADDRESS_FAMILIES` (`0x131A`) / `EC_TAG_CONN_ADVERTISE_IPV6` (`0x131B`, #1957): IPv6 connectivity preferences.
   - `EC_TAG_SERVERS_ED2K_ACCELERATED_PUBLICATION` (`0x170D`, #1715): OFFERFILES v1 acceleration toggle.
   - `EC_TAG_DIRECTORIES_ALLOWED_ROOTS` (`0x1A09`, #2172): confinement boundaries for shared directory configuration.
   - `EC_TAG_KADEMLIA_PROTOCOL10` (`0x1E02`, #1663) / `EC_TAG_KADEMLIA_STRICT_AICH_PUBLISHERS` (`0x1E03`, #1751): Kad runtime
     options.
- **21 Kad lookup diagnostics tags** (`0x2100`–`0x2127`, #1741):
   - `EC_TAG_KAD_LOOKUP` (`0x2100`) container, with target (`0x2101`), type (`0x2102`), keyword (`0x2103`), active/overdue flags,
     peer records (`0x2110`–`0x211C`), and referral records (`0x2120`–`0x2127`).

### Commit-by-commit review (behavior changes on protocol)

- **CRITICAL BREAKING: SRP-6a authentication and mandatory AEAD session encryption (#2032-#2035, `718545e1c`, `569775238`,
  `33bb29657`, `827e60270`, `b2046ccb8`)**: Upstream has completed its transition to authenticated, encrypted EC sessions. The
  daemon now requires SRP-6a mutual proof verification bound to the X25519 transcript (`EC_SRP.md`), and enforces encryption even on
  loopback connections (`--disable-ec-encryption` was removed). Legacy challenge/response authentication via `EC_TAG_PASSWD_SALT`
  and MD5 digests is completely retired. When facing a client that does not initiate the SRP handshake, the daemon sends
  `EC_OP_AUTH_FAIL` with the reason: `"An EC client of version 3.3.0 or later is required."`. Connecting to current and future
  `amuled` builds will require implementing X25519/AEAD encryption and the 4-step SRP handshake.
- **Chat peer addressing & CAPTCHA (#1512 `569529a40`, #1555 `d595653d3`, #1551 `0d9db6338`, #1578 `01f02a34f`, #1829 `7a291a9c2`,
  #2089 `e7d5689e0`)**: Chat sessions are now keyed by stable peer identity (`CMD4Hash`). Upstream restored legacy target support
  for older clients (#1555) and introduced `EC_TAG_CHAT_PEER_HASH` gated by `EC_TAG_CAN_CHAT_PEER_HASH`. This solves addressing IPv6
  peers, which `GUI_ID(ip, port)` cannot represent. In addition, chat spam protection and CAPTCHA challenge messages were
  implemented with dedicated tags and message kinds.
- **Completed file deletion from disk (#1950 `4a2832ca2`, #1854 `3ddd19ac0`)**: `EC_OP_KNOWNFILE_DELETE` allows deleting finished
  files from disk (requiring hash, ECID, path, and name validation). Meanwhile, `EC_OP_PARTFILE_DELETE` now strictly rejects
  completed/completing files to prevent accidental file deletion during cancel requests.
- **Simultaneous eD2k+Kad AllSearch (#1670 `b72f12f6c`, #1632 `beb8e6cb5`)**: `EC_SEARCH_ALL` queries both networks in parallel
  under a single search ID. Results report a breakdown via `EC_TAG_SEARCHFILE_ED2K_SOURCES` and `_KAD_SOURCES`. Active status of
  each network component is tracked via `EC_TAG_SEARCH_KAD_ACTIVE` and `EC_TAG_SEARCH_ED2K_ACTIVE`. Each EC connection now also
  receives an isolated default search context (#1632).
- **Kad lookup diagnostics (#1741 `4d94967ac`, #1743 `843f8a97b`)**: New diagnostic opcode `EC_OP_GET_KAD_LOOKUPS` and contact
  distribution histogram `EC_TAG_STATS_KAD_DISTRIBUTION` for inspecting Kad internals.
- **Protocol framing and daemon security hardening**:
   - `e6b5f7ebb` (#2151): EC tag nesting depth is now strictly bounded in `ECSocket.cpp`.
   - `9784a32e9` (#2160): Tags whose byte length does not match their data type are rejected.
   - `698d8a90a` (#2158): Cleartext packets arriving after key setup are rejected.
   - `f023c3add` (#2150): Directory traversal checks applied to rename and shared directory operations.
   - `131f7ce79` (#2093): Buffered packet dispatch stops immediately after disconnect.
   - `ebc250f6e` (#1875): Capped push notifications resume reliably on the main event loop.
   - `2d9aeacf9` (#1863): Fixed a daemon crash on category create/update requests omitting a path tag.
   - `9c25b0901` (#1865): Newlines in ed2k links are rejected, category index is bounded.
- **Statistics & Preferences**:
   - `1397d3c49` (#2228): Added NAT traversal and IPv6 statistics nodes to the statistics tree (`EC_OP_GET_STATSTREE`).
   - `14af15fd3` (#1614), `455598945` (#1957), `8021d8afd` (#1715), `7a360e688` (#1663), `4860c55b0` (#1751), `567345c50` (#2172):
     Exposed preferences for EC listener configuration, IPv6, server publication acceleration, Kad protocol versions, and allowed
     roots.

## 2026-09-20

Local C++ checkout **not** pulled for the review itself: local HEAD (`f98d790a2`, the 2026-09-07 baseline) is 169 commits behind
`origin/master` (`23dda72d8`), read with `git diff`/`git log HEAD..origin/master`. `ECCodes.abstract` is identical between the two:
no `EC_OP_*`/`EC_TAG_*` value added, changed or removed. Commit-by-commit review of every commit touching `src/libs/ec/`,
`ExternalConn.{cpp,h}`, `ECSpecialCoreTags.cpp` or `amule-remote-gui.cpp`, and of every one whose changed lines mention an
`EC_OP_*`/`EC_TAG_*` name outside `src/webapi`:

- `175d61289` (#1498, "address a chat by ip:port and nothing else"): `ResolveChatTarget()` lost its `EC_TAG_CLIENT` and
  `EC_TAG_FRIEND` branches, `EC_TAG_CHAT_CLIENT_ID` is the only target left for `EC_OP_CHAT_SEND` -
  `Chat.sendToClient()`/`.sendToFriend()` would get `EC_OP_FAILED` ("Unknown chat target"). Followed, not preserved: both removed,
  `Chat.sendToAddress()` added (the id is `GUI_ID(ip, port)`), `UploadClient.userIp`/`.userPort` decoded so an upload queue entry
  carries the address - 4.0.0, see `CHANGELOG.md`. Live-tested on a freshly rebuilt daemon: the old ECID forms sent raw get
  `EC_OP_FAILED` ("Unknown chat target"), `sendToAddress()` returns the computed `GUI_ID`, the session shows up in `fetch()`.
  (`amuled --version` still printed the previous snapshot revision after the rebuild - probably fixed at configure time - so the
  behavior, not that string, is what tells the daemon has #1498.)
- `3a0648f6c` (#1479, "one credit modifier for every peer list"): `EC_TAG_CLIENT_SCORE_RATIO` now also on each
  `Get_EC_Response_ClientHistory()` entry (`ClientHistoryEntry.scoreRatio`), and its value on live clients becomes
  `GetCreditRatio()`, without the identity gate (`ClientUpdate.scoreRatio`'s doc updated). Live-tested: `scoreRatio` is present on
  all 3,569 entries of a real credit store, 10 for peers we only downloaded from, 1 for peers we only uploaded to.
- `8ceb22e00` (#1424): the daemon now frees a removed client/server/friend's incremental-update cache entry per EC connection
  (`ExternalConn::ForgetObject()`); an ECID without an entry is sent in full, so transparent to a client.
- `2ef1a164c`, `d22a86629`, `0734db2ec`: comment-only in every core, GUI and EC file - checked by comparing each changed file
  before/after with comments stripped (`gcc -fpreprocessed -dD -E`); the only files whose stripped content differs are under
  `src/webapi`, out of scope.
- `2b2e9351f`: `CECTag::InitInt` picks type and length in locals instead of reading the members back (a GCC 13 false positive) -
  same behavior.
- `7096b6854`, `97a2d2765`: `amulegui`-side only (a `case` for `BrowseSearch`, the statistics tree fetched on the first poll).
  `c69c36970`: which of the "Kad started."/"Kad stopped." log lines is emitted, no tag involved.
- The rest (uTP, native IPv6 and address-keyed peer identity, Kad, `amuleapi`/web-ui, CI, packaging, translations) touches neither
  the EC encoder nor any tag this library decodes.

## 2026-09-13

Local C++ checkout **not** pulled/rebuilt this time - checked whether it was worth it first. Local HEAD (`f98d790a2`, the 2026-09-07
baseline) is 69 commits behind `origin/master` (`1521bff73`). Diffed `src/libs/ec/abstracts/ECCodes.abstract` between the two: no
`EC_OP_*`/`EC_TAG_*` value added, changed or removed. Of the 69 commits, only 3 touch `src/libs/ec/` or `docs/EC_Protocol.md`:

- `2ef1a164c` ("trim verbose comment blocks", #1365) and `0734db2ec` ("tree-wide comment brevity pass", #1372) - every changed line
  in every EC file they touch (`ECSocket.{cpp,h}`, `ECTag.{cpp,h}`, `ECCrypt.{cpp,h}`, `RemoteConnect.{cpp,h}`,
  `ECSpecialTags.{cpp,h}`, `ECMemSocket`/`ECMuleSocket`/`ECPacket`/`ECUInt128`/`ECFileConfig`/`ECID`/`ECLog`) checked line-by-line:
  comments or blank lines only, no code change.
- `5fdface48` (#1376, eMuleAI-parity follow-ups) - `docs/EC_Protocol.md` had `EC_TAG_CLIENT_MOD_CAPABILITIES` documented as
  `0x0632`; corrected to the real value `0x0633` (`0x0632` is `EC_TAG_CLIENT_CONNECTED`). Documentation-only fix, no enum value
  actually changed - `ECTagNames.ts` already has both values right (CHANGELOG.md's 2.30.0 entry cites `0x0632`/`0x0633` correctly),
  nothing to change here.

The rest of the 69 commits are GUI (search-controls layout, new columns), the new uTP transport work, Kad, CI/build and
translations - outside this library's protocol surface.

**Decision: deferred, not pulled/rebuilt.** No EC-relevant change accumulated since the 2026-09-07 sync. Re-check in about a week
rather than on every push to `origin/master`.

## 2026-09-07

Local C++ checkout pulled and rebuilt (HEAD `f98d790a2`). Diffed `src/libs/ec/abstracts/ECCodes.abstract` against the 2026-08-31
baseline (`821e34e8`, 73 commits): no `EC_OP_*`/`EC_TAG_*` value changed or removed, 2 new tags added - `EC_TAG_CLIENT_CONNECTED`
(0x0632, #1295) and `EC_TAG_CLIENT_MOD_CAPABILITIES` (0x0633, #1288), both `EC_TAG_CLIENT_*` additions, neither decoded here yet -
sorted into `TODO.md`'s "Tags, declared but not decoded" section.

Commit-by-commit review of the same range for behavior changes on already-ported protocol: most of the 73 commits touch
`amuleapi`/`web-ui` (aMule's separate JSON/HTTP API, out of scope for this library) or GUI-only code, out of scope here. Of the
rest: #1228/#1232 (category-error reporting) were already tracked in an earlier, untracked-here session (amule-ec 2.29.2); #1314
(count a ban once per banned address) is an internal statistics-counting fix with no `EC_TAG`/`EC_OP` touched, transparent to any EC
client; #1222 (Kad: stop unassigned searches answering to the legacy EC search id) fixes daemon-side search-lifecycle misreporting
for EC clients that never negotiate `EC_TAG_CAN_MULTI_SEARCH` (every one of their searches shared the same internal sentinel id) -
transparent once the daemon updates, no client-side change needed. `9442dcde8` (Kademlia protocol 0x0a) is peer-to-peer Kad wire
protocol, not the local EC client protocol - out of scope.

## 2026-08-31

Local C++ checkout pulled (HEAD `821e34e8`) and rebuilt the daemon. Diffed `src/libs/ec/abstracts/ECCodes.abstract` against the
2026-08-04 baseline (`aba41616`): no `EC_OP_*`/`EC_TAG_*` value changed. 8 new opcodes and 9 new tags added upstream since then; 2
opcodes (`EC_OP_GET_CLIENT_HISTORY`/`EC_OP_CLIENT_HISTORY`, 0x61-0x62) and their supporting tags were already ported in an earlier,
untracked-here session. The remaining 6 opcodes (0x63-0x68) and 9 tags are new and not ported - sorted into `TODO.md`'s
"Opcodes/tags added upstream since the 2026-08-04 sync" section: the chat session store (issue #971), media metadata re-extraction,
`PARTFILE_SET_A4AF_AUTO`, and `EC_TAG_SEARCH_MORE_REASKABLE`.

Also spot-checked commit-by-commit for behavior changes on protocol already ported: the search-progress-union fix (#1130) only
changes the reply shape this library would get if it ever advertised `EC_TAG_CAN_SEARCH_PROGRESS_UNION` (it doesn't - see TODO.md);
the double-precision fix (#879) and the client-version-rendering fix (#1131) are wire/string-level improvements transparent to this
library's decode logic; the Nagle fix (#1142) is a server-socket option, invisible to any client. No action needed on any of these
three.

**Correction, same day**: the chat-session-store commit (`2d07705d6`, #1053) was filed above as purely new/unported surface, but it
also re-specifies `EC_OP_GET_CHAT_MESSAGES` (0x5B) - an opcode this library already implemented as `Chat.fetch()`. The op changed
from a destructive, tag-less drain of a per-connection queue into the non-destructive backfill of one named session, requiring an
`EC_TAG_CHAT_CLIENT_ID` request tag; a request built the old way now gets `EC_OP_FAILED` ("Missing chat session id") instead of a
message list - confirmed live against the rebuilt daemon. This is exactly the "behavior change on protocol already ported" case the
commit-by-commit pass is meant to catch, missed here because the mechanical opcode/tag diff flagged this commit only for its _new_
opcodes and the follow-up review didn't separately check whether it also touched already-ported ones. `Chat.ts` was redesigned
around the session-store model (`ChatSession`/`ChatMessage`, `fetch()`/`fetchHistory()`/`sendToSession()`/`sendToClient()`/
`sendToFriend()`/`closeSession()`) rather than patched, since upstream itself removed the old queue with no compatible shape to
preserve.

## 2026-08-15

Reviewed every commit (~90) touching the EC protocol in the local C++ repo (`/home/aubin/Dev/git/amule`, up-to-date clone of the
official repo, rebuilt regularly) since 2026-06-04, to detect drift between the actual protocol and what `amule-ec-ts` ports.

## 2026-08-04

Sync done.
