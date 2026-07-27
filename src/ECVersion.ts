export const ECVersion = {
   PROTOCOL: 0x0204,
   VERSION_ID: undefined as Uint8Array | undefined,
   /**
    * Sent as EC_TAG_CLIENT_NAME/EC_TAG_CLIENT_VERSION in EC_OP_AUTH_REQ
    * (see ECConnection.authenticateWithHash) so the daemon's own log
    * ("Connecting client: ...") identifies this client instead of
    * "Unknown Unknown version" - confirmed against
    * /home/aubin/Dev/git/amule/src/ExternalConn.cpp:602-608.
    */
   CLIENT_NAME: "TS-Client",
   CLIENT_VERSION: "1.0.0",
};
