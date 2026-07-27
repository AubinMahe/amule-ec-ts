/**
 * EC application tag types.
 *
 * Values defined by the EC protocol.
 */
export enum ECTagType {
   UNKNOWN = 0,
   CUSTOM = 1,
   UINT8 = 2,
   UINT16 = 3,
   UINT32 = 4,
   UINT64 = 5,
   STRING = 6,
   DOUBLE = 7,
   IPV4 = 8,
   HASH16 = 9,
   UINT128 = 10,
}
