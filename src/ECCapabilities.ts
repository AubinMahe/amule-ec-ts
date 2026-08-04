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
}
