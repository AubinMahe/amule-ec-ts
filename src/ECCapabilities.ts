export class ECCapabilities {
   public zlib = false;
   public utf8Numbers = false;
   public notify = false;
   public largeTagCount = false;
   /**
    * Whether the daemon serves the partial-update ("skip unchanged, signal
    * deletions with EC_TAG_FILE_REMOVED") protocol for EC_OP_GET_UPDATE and
    * friends - only meaningful on `remoteCapabilities`, same "unconditionally
    * advertised, remoteCapabilities-only" shape as `sharedDirsConfig`/
    * `searchList`: EC_TAG_CAN_PARTIAL_UPDATE isn't a client-side preference
    * to gate on, it's always advertised, and old daemons simply ignore the
    * unknown tag and fall back to alive-marker/absence-implies-deletion
    * semantics for this connection - see Update's class doc.
    */
   public partialUpdate = false;
   public preferNoZlib = false;
   public multiSearch = false;
   /**
    * Whether the daemon serves EC_OP_GET/SET_SHARED_DIRS - only meaningful
    * on `remoteCapabilities` (see ECConnection.authenticate()'s doc): unlike
    * every other flag here, this one is never read off `localCapabilities`
    * to decide what to send - EC_TAG_CAN_SHAREDDIRS_CONFIG is advertised
    * unconditionally, there is no client-side preference to gate it on.
    */
   public sharedDirsConfig = false;
   /**
    * Whether the daemon serves EC_OP_SEARCH_LIST - same "unconditionally
    * advertised, remoteCapabilities-only" shape as sharedDirsConfig, for
    * the same reason: EC_TAG_CAN_SEARCH_LIST isn't a real opt-in, it's a
    * version-compat probe ("this daemon build is new enough to have a
    * case for opcode 0x60 at all") - RemoteConnect.cpp adds it to every
    * AUTH_REQ unconditionally, and the daemon echoes it in AUTH_OK
    * unconditionally once auth succeeds. A daemon predating it has no
    * `default:` case in its opcode switch and asserts on an unknown
    * opcode - see Search.list()'s doc.
    */
   public searchList = false;
   /**
    * Whether the daemon serves EC_OP_GET_CLIENT_HISTORY - same
    * "unconditionally advertised, remoteCapabilities-only" shape as
    * sharedDirsConfig/searchList: EC_TAG_CAN_CLIENT_HISTORY isn't a real
    * opt-in, it's a version-compat probe ("this daemon build answers
    * EC_OP_GET_CLIENT_HISTORY"), echoed unconditionally on AUTH_OK. A
    * daemon predating it has no case for the opcode and asserts before
    * the EC_OP_FAILED path - see ClientHistory.fetch()'s doc.
    */
   public clientHistory = false;
   /**
    * Whether this connection negotiated the chat session store
    * (EC_OP_GET_CHAT_SESSIONS and friends) - a real client opt-in, unlike
    * clientHistory/sharedDirsConfig/searchList: EC_TAG_CAN_CHAT_SESSIONS is
    * only echoed back if this connection's own AUTH_REQ advertised it
    * first (see Chat's class doc for why - a daemon that already echoes
    * the older EC_TAG_CAN_CHAT for an unrelated reason must not be
    * mistaken for one that speaks these ops). Set
    * ECEngineStartOptions.chatSessions/localCapabilities.chatSessions
    * before authenticating, same timing constraint as multiSearch.
    */
   public chatSessions = false;
}
