# TODO

## EC protocol coverage

`ECOpcode.ts` declares 88 opcodes. The library wraps 74 of them; all 74 are
covered by a unit test. Only 6 (the auth handshake + `NOOP`) are exercised
through the full wire-level fake TCP server (`tests/fakeEcServer.ts`,
byte-for-byte framing/compression/capabilities) - every other tested opcode
goes through the lighter in-memory `FakeConnection` stub in `testUtils.ts`
(queued replies, no real socket). The REPL column reflects the 70 opcodes
reachable on a REPL command's golden (success) path - see "REPL coverage"
below for the command list. `N/A` marks the two opcodes (`AUTH_FAIL`,
`FAILED`) that are inherently error-path-only replies - no REPL command
could ever deliberately target them on a success path, as opposed to a
blank cell, which just means "not done yet, but could be".

|Op code (hex)|Name|Description|Supported|Tested|Simulated (fake server)|REPL|
|---|---|---|:-:|:-:|:-:|:-:|
|0x01|`NOOP`|No-op / generic success reply|✓|✓|✓|✓|
|0x02|`AUTH_REQ`|Auth handshake request (protocol version, client name)|✓|✓|✓|✓|
|0x03|`AUTH_FAIL`|Auth handshake rejected|✓|✓|✓|N/A|
|0x04|`AUTH_OK`|Auth handshake accepted|✓|✓|✓|✓|
|0x05|`FAILED`|Generic failure reply, with reason|✓|✓||N/A|
|0x06|`STRINGS`|Generic string-list reply|✓|✓||✓|
|0x07|`MISC_DATA`|Generic reply carrying no specific data|✓|✓||✓|
|0x08|`SHUTDOWN`|Shuts down the daemon|✓|✓||✓|
|0x09|`ADD_LINK`|Adds an ed2k link (download or server)|✓|✓||✓|
|0x0a|`STAT_REQ`|Requests global stats (speeds, sources...)|✓|✓||✓|
|0x0b|`GET_CONNSTATE`|Requests connection state (ed2k/Kad)|✓|✓||✓|
|0x0c|`STATS`|Stats reply / push notification|✓|✓||✓|
|0x0d|`GET_DLOAD_QUEUE`|Requests the download queue|✓|✓||✓|
|0x0e|`GET_ULOAD_QUEUE`|Requests the upload queue|✓|✓||✓|
|0x10|`GET_SHARED_FILES`|Requests the shared files list|✓|✓||✓|
|0x11|`SHARED_SET_PRIO`|Sets a shared file's upload priority|✓|✓||✓|
|0x16|`PARTFILE_SWAP_A4AF_THIS`|Swaps a source to this file ("also available for")|✓|✓||✓|
|0x17|`PARTFILE_SWAP_A4AF_THIS_AUTO`|Same, toggling the "auto swap" flag|✓|✓||✓|
|0x18|`PARTFILE_SWAP_A4AF_OTHERS`|Swaps this file's sources to other A4AF files|✓|✓||✓|
|0x19|`PARTFILE_PAUSE`|Pauses a download|✓|✓||✓|
|0x1a|`PARTFILE_RESUME`|Resumes a paused download|✓|✓||✓|
|0x1b|`PARTFILE_STOP`|Stops a download|✓|✓||✓|
|0x1c|`PARTFILE_PRIO_SET`|Sets a download's priority|✓|✓||✓|
|0x1d|`PARTFILE_DELETE`|Cancels/deletes a download|✓|✓||✓|
|0x1e|`PARTFILE_SET_CAT`|Assigns a download to a category|✓|✓||✓|
|0x1f|`DLOAD_QUEUE`|Download queue reply / push notification|✓|✓||✓|
|0x20|`ULOAD_QUEUE`|Upload queue reply / push notification|✓|✓||✓|
|0x22|`SHARED_FILES`|Shared files reply / push notification|✓|✓||✓|
|0x23|`SHAREDFILES_RELOAD`|Rescans the shared directories|✓|✓|||
|0x25|`RENAME_FILE`|Renames a partial/shared file|✓|✓|||
|0x26|`SEARCH_START`|Starts a search|✓|✓||✓|
|0x27|`SEARCH_STOP`|Stops the running search|✓|✓||✓|
|0x28|`SEARCH_RESULTS`|Fetches the current search results|✓|✓||✓|
|0x29|`SEARCH_PROGRESS`|Polls the search's lifecycle/progress|✓|✓||✓|
|0x2a|`DOWNLOAD_SEARCH_RESULT`|Downloads one or more search results, by hash|✓|✓||✓|
|0x2b|`IPFILTER_RELOAD`|Reloads the IP filter file|||||
|0x2c|`GET_SERVER_LIST`|Requests the known server list|✓|✓||✓|
|0x2d|`SERVER_LIST`|Server list reply / push notification|✓|✓||✓|
|0x2e|`SERVER_DISCONNECT`|Disconnects from the current ed2k server|✓|✓||✓|
|0x2f|`SERVER_CONNECT`|Connects to a specific ed2k server|✓|✓||✓|
|0x30|`SERVER_REMOVE`|Removes a server from the known list|✓|✓||✓|
|0x31|`SERVER_ADD`|Adds a server to the known list|✓|✓||✓|
|0x32|`SERVER_UPDATE_FROM_URL`|Updates the server list from a server.met URL|✓|✓||✓|
|0x33|`ADDLOGLINE`|Appends a line to the daemon's log (client request, not a push notification)|✓|✓||✓|
|0x34|`ADDDEBUGLOGLINE`|Appends a line to the daemon's debug log (client request, not a push notification)|✓|✓||✓|
|0x35|`GET_LOG`|Requests the accumulated log|✓|✓||✓|
|0x36|`GET_DEBUGLOG`|Requests the accumulated debug log|✓|✓||✓|
|0x37|`GET_SERVERINFO`|Requests the daemon's cumulative ed2k-connection log (not per-server detail, despite the name)|✓|✓||✓|
|0x38|`LOG`|Log reply|✓|✓||✓|
|0x39|`DEBUGLOG`|Debug log reply|✓|✓||✓|
|0x3a|`SERVERINFO`|Reply carrying the ed2k-connection log|✓|✓||✓|
|0x3b|`RESET_LOG`|Clears the log|✓|✓||✓|
|0x3c|`RESET_DEBUGLOG`|Clears the debug log|✓|✓||✓|
|0x3d|`CLEAR_SERVERINFO`|Clears the ed2k-connection log|✓|✓||✓|
|0x3e|`GET_LAST_LOG_ENTRY`|Requests only the last log line|✓|✓||✓|
|0x3f|`GET_PREFERENCES`|Requests daemon preferences|||||
|0x40|`SET_PREFERENCES`|Sets daemon preferences|||||
|0x41|`CREATE_CATEGORY`|Creates a download category|✓|✓||✓|
|0x42|`UPDATE_CATEGORY`|Updates a download category|✓|✓||✓|
|0x43|`DELETE_CATEGORY`|Deletes a download category|✓|✓||✓|
|0x44|`GET_STATSGRAPHS`|Requests historical stats graph data|||||
|0x45|`STATSGRAPHS`|Stats graph data reply|||||
|0x46|`GET_STATSTREE`|Requests the client-tree stats (STATTREE)|||||
|0x47|`STATSTREE`|Client-tree stats reply|||||
|0x48|`KAD_START`|Starts the Kademlia network|✓|✓||✓|
|0x49|`KAD_STOP`|Stops the Kademlia network|✓|✓||✓|
|0x4a|`CONNECT`|Connects to the ed2k/Kad networks|✓|✓||✓|
|0x4b|`DISCONNECT`|Disconnects from the ed2k/Kad networks|✓|✓||✓|
|0x4d|`KAD_UPDATE_FROM_URL`|Updates Kad nodes.dat from a URL|✓|✓||✓|
|0x4e|`KAD_BOOTSTRAP_FROM_IP`|Bootstraps Kad from a given IP|✓|✓||✓|
|0x4f|`AUTH_SALT`|Server's random salt for the password hash|✓|✓|✓|✓|
|0x50|`AUTH_PASSWD`|Client's salted password hash|✓|✓|✓|✓|
|0x51|`IPFILTER_UPDATE`|Updates the IP filter from its configured URL|||||
|0x52|`GET_UPDATE`|Checks for a daemon update|||||
|0x53|`CLEAR_COMPLETED`|Clears completed downloads from the list|✓|✓||✓|
|0x54|`CLIENT_SWAP_TO_ANOTHER_FILE`|Moves an uploading client to another file|||||
|0x55|`SHARED_FILE_SET_COMMENT`|Sets a shared file's comment/rating|✓|✓||✓|
|0x56|`SERVER_SET_STATIC_PRIO`|Sets a server's static priority|✓|✓||✓|
|0x57|`FRIEND`|Adds/removes a friend, sets friend-slot (browse "View Files" not wrapped - needs multi-search)|✓|✓||✓|
|0x58|`VERSION_CHECK`|Checks the daemon's version|||||
|0x59|`SHARED_FILE_SEARCH_KAD_NOTES`|Searches Kad notes for a shared file|✓|✓||✓|
|0x5a|`VERIFY_LOCAL_DATA`|Verifies a partial file's local data (hash check)|||||
|0x5b|`GET_CHAT_MESSAGES`|Requests buffered chat messages|✓|✓||✓|
|0x5c|`CHAT_MESSAGES`|Reply to GET_CHAT_MESSAGES, draining buffered incoming chat|✓|✓||✓|
|0x5d|`GET_SHARED_DIRS`|Requests the list of shared directories|✓|✓||✓|
|0x5e|`SET_SHARED_DIRS`|Sets the list of shared directories|✓|✓||✓|
|0x5f|`SEARCH_REQUEST_MORE`|Kad-only: re-asks already-queried peers for more results on a multi-search-addressed search|||||
|0x60|`SEARCH_LIST`|Multi-search only: lists the connection's known search IDs|||||

## REPL coverage

`tests/repl/main.ts` drives all 14 feature classes: `Downloads`, `Uploads`,
`SharedFiles`, `Status`, `Servers`, `Search`, `Log`, `Kad`, `ServerLog`,
`Daemon`, `DebugLog`, `Friends`, `Chat` and `Categories` - commands
`show dl`, `show ul`,
`show shared`, `show servers`, `show log`, `reset log`, `show log last`,
`addlog <text>`, `show debug log`, `reset debug log`,
`adddebuglog <text>`, `show server log`, `reset server log`, `show chat`,
`status`, `connect <ip:port>`, `connect`, `disconnect`,
`server disconnect`,
`server priority <ecid> [static|nostatic] [normal|high|low]`,
`server remove <ip:port>`, `server add <ip:port> [name]`,
`server update <url>`,
`search <keywords>`, `search stop`, `download <hash>...`, `cancel <hash>`,
`pause <hash>`, `resume <hash>`, `stop <hash>`,
`priority <hash> <low|normal|high|veryhigh|verylow|auto|powershare>`,
`addlink <ed2k-link>`, `swap <this|auto|others> <hash>`,
`setcat <hash> <category-index>`,
`category create <title> <path> [comment] [color] [prio]`,
`category update <index> <title> <path> [comment] [color] [prio]`,
`category delete <index>`,
`sharedprio <hash> <low|normal|high|veryhigh|verylow|auto|powershare>`,
`show shareddirs`, `shareddir add <path> [recursive]`,
`shareddir remove <path>`,
`clear completed`, `kad start`, `kad stop`,
`kad bootstrap <ip> <port>`, `kad update <url>`, `shutdown`,
`friend add <ecid>`, `friend add <hash> <ip> <port> <name>`,
`friend remove <ecid>`, `friend slot <ecid> <on|off>`,
`comment <hash> <rating 0-5> <text>`, `kadnotes <hash>`.
