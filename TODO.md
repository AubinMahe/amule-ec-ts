# TODO

## EC protocol coverage

The library wraps 30 of the 79 opcodes declared in `ECOpcode.ts` (auth/handshake,
connstate/stats, download & upload queues, shared files list/reload,
partfile delete/rename, search, server list/connect, log get/reset) - the
set its client applications actually need. Everything else is declared in the enum for
protocol completeness but has no wrapper class/method:

- Download control: pause/resume/stop, priority, category, swap A4AF
  (only `PARTFILE_DELETE` is wrapped)
- Server management: add/remove/disconnect/update-from-URL, static priority,
  detailed server info (only list+connect are wrapped)
- Preferences: get/set
- Categories: create/update/delete
- Kademlia: start/stop/bootstrap/update-from-URL
- IP filter: reload/update
- Stats graphs/tree (`STATSGRAPHS`, `STATSTREE`)
- Chat/friends (`CHAT_MESSAGES`, `FRIEND`)
- Shared directories (get/set), shared file comment, shared file priority
- Debug log, add ed2k link, verify local data, update check, daemon shutdown

## REPL coverage

`tests/repl/main.ts` only drives `Downloads`, `Uploads`, `SharedFiles` and
`Status` (`show dl`, `show ul`, `show shared`, `status`). It has no command
for `Search` or `Servers`, even though both are already implemented.
