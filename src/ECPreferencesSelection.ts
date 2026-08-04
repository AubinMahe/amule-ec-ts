/**
 * EC_PREFS_* selection bitmask flags, sent as the EC_TAG_SELECT_PREFS tag
 * on EC_OP_GET_PREFERENCES to pick which preference sections the reply
 * should include.
 *
 * Confirmed against ECCodes.abstract
 * (https://github.com/amule-org/amule/blob/master/src/libs/ec/abstracts/ECCodes.abstract#L679-L693).
 * 0x00000100 is reserved/unused upstream - no EC_PREFS_ name is assigned to
 * it, so it's omitted here too.
 */
export enum ECPreferencesSelection {
   CATEGORIES = 0x00000001,
   GENERAL = 0x00000002,
   CONNECTIONS = 0x00000004,
   MESSAGEFILTER = 0x00000008,
   REMOTECONTROLS = 0x00000010,
   ONLINESIG = 0x00000020,
   SERVERS = 0x00000040,
   FILES = 0x00000080,
   DIRECTORIES = 0x00000200,
   STATISTICS = 0x00000400,
   SECURITY = 0x00000800,
   CORETWEAKS = 0x00001000,
   KADEMLIA = 0x00002000,
   IP2COUNTRY = 0x00004000,
}
