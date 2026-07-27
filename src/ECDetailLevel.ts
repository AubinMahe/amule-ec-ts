/**
 * EC_DETAIL_LEVEL values, sent as the EC_TAG_DETAIL_LEVEL tag on every
 * EC_OP_GET_* request to pick how much detail the server includes in its
 * reply. One enum shared by every such request (stats, connstate, download
 * queue, shared files, ...), per aMule's ExternalConn.cpp.
 *
 * Confirmed against /home/aubin/Dev/git/amule/src/libs/ec/cpp/ECCodes.h:550-557.
 */
export enum ECDetailLevel {
   /** Lightest level, intended for periodic command-line polling. */
   EC_DETAIL_CMD = 0,
   EC_DETAIL_WEB = 1,
   EC_DETAIL_FULL = 2,
   /** Legacy "absence implies deletion" polling level used by amuleweb. */
   EC_DETAIL_UPDATE = 3,
   /** Partial incremental-update mode (requires EC_TAG_CAN_PARTIAL_UPDATE). */
   EC_DETAIL_INC_UPDATE = 4,
}
