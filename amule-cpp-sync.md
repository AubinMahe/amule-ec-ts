# `C++ amule` vs `amule-ec-ts`

## Role of this file

List of differences to analyze point by point, on every fetch/pull.

Points recorded here must be sorted into TODO.md, ISSUES.md, or CHOICES.md.

## Method

Mechanical diff of the `EC_OP_*`/`EC_TAG_*` enums (generated C++ vs `ECOpcode.ts`/ `ECTagNames.ts`) for pure novelties, then
commit-by-commit review (the actual diff, not just the message) for behavior changes on protocol already ported.

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

## 2026-08-15

Reviewed every commit (~90) touching the EC protocol in the local C++ repo (`/home/aubin/Dev/git/amule`, up-to-date clone of the
official repo, rebuilt regularly) since 2026-06-04, to detect drift between the actual protocol and what `amule-ec-ts` ports.

## 2026-08-04

Sync done.
