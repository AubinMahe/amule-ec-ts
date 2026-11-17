/**
 * Reason codes sent with EC_OP_AUTH_FAIL via EC_TAG_AUTH_FAIL_REASON (0x0034) -
 * added in aMule 3.3.0 (#2333).
 */
export enum ECAuthFailReason {
   /**
    * The client request did not initiate SRP authentication (missing EC_TAG_SRP_A).
    */
   CLIENT_TOO_OLD = 0x01,
   /**
    * The core has no EC password or verifier configured.
    */
   NO_PASSWORD = 0x02,
   /**
    * Too many failed authentication attempts from this IP address; also carries
    * EC_TAG_AUTH_RETRY_AFTER.
    */
   RATE_LIMITED = 0x03,
   /**
    * Protocol version mismatch, malformed fields, or unexpected packet ordering.
    */
   INCOMPATIBLE = 0x04,
   /**
    * Wrong credentials or invalid SRP proof.
    */
   REJECTED = 0x05,
}
