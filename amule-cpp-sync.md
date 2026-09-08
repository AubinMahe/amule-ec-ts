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
