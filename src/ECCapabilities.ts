export class ECCapabilities {

   public zlib = false;
   public utf8Numbers = false;
   public notify = false;
   public largeTagCount = false;
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
}
