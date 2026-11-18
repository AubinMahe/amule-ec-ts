import { ECTagNames } from "./ECTagNames.js";
import { ECTag, ECCustomTag } from "./ECTags.js";

/**
 * Stable Kad lookup types for EC diagnostics - confirmed against
 * https://github.com/amule-org/amule/blob/master/src/kademlia/utils/LookupDiagnostics.h.
 */
export enum KadLookupType {
   Node = 0,
   CompleteNode = 1,
   File = 2,
   Keyword = 3,
   Notes = 4,
   PublishFile = 5,
   PublishKeyword = 6,
   PublishNotes = 7,
   FindBuddy = 8,
   FindSource = 9,
   SpecialNode = 10,
   UDPFirewallCheck = 11,
   Unknown = 0xffffffff,
}

/**
 * Formats a host-order uint32 IPv4 address used in Kad diagnostics (KadIPToString)
 * into a dotted-quad IPv4 string.
 */
export function kadIpFromUint32(value: bigint | number): string {
   const n = Number(value) >>> 0;
   return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
}

export interface KadLookupPeer {
   readonly ip: string;
   readonly port: number;
   readonly id: string;
   readonly distance: string;
   readonly kadVersion: number;
   readonly requests: number;
   readonly replies: number;
   readonly roundTripMs: bigint;
   readonly itemRequests: number;
   readonly itemReplies: number;
   readonly results: number;
   readonly pending: boolean;
}

export interface KadLookupReferral {
   readonly sourceIp: string;
   readonly sourcePort: number;
   readonly peerIp: string;
   readonly peerPort: number;
   readonly elapsedMs: bigint;
   readonly distance: string;
   readonly closer: boolean;
}

export interface KadLookupReport {
   readonly target: string;
   readonly keyword: string;
   readonly type: KadLookupType;
   readonly active: boolean;
   readonly overdue: bigint;
   readonly omittedPeers: bigint;
   readonly evictedReferrals: bigint;
   readonly peers: readonly KadLookupPeer[];
   readonly referrals: readonly KadLookupReferral[];
}

function idFromTag(parent: ECTag, name: ECTagNames): string {
   const tag = parent.findChild(name);
   if (tag instanceof ECCustomTag) {
      return Buffer.from(tag.value).toString("hex");
   }
   return "";
}

export function decodeKadLookupReport(tag: ECTag): KadLookupReport {
   const target = tag.childString(ECTagNames.EC_TAG_KAD_LOOKUP_TARGET) ?? "";
   const keyword = tag.childString(ECTagNames.EC_TAG_KAD_LOOKUP_KEYWORD) ?? "";
   const type: KadLookupType = Number(tag.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_TYPE) ?? 0xffffffffn);
   const active = (tag.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_ACTIVE) ?? 0n) !== 0n;
   const overdue = tag.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_OVERDUE) ?? 0n;
   const omittedPeers = tag.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_OMITTED_PEERS) ?? 0n;
   const evictedReferrals = tag.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_EVICTED_REFERRALS) ?? 0n;

   const peers: KadLookupPeer[] = [];
   const referrals: KadLookupReferral[] = [];

   for (const child of tag.children) {
      const name: ECTagNames = child.name;
      if (name === ECTagNames.EC_TAG_KAD_LOOKUP_PEER) {
         peers.push({
            ip: kadIpFromUint32(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_IP) ?? 0n),
            port: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_PORT) ?? 0n),
            id: idFromTag(child, ECTagNames.EC_TAG_KAD_LOOKUP_PEER_ID),
            distance: idFromTag(child, ECTagNames.EC_TAG_KAD_LOOKUP_PEER_DISTANCE),
            kadVersion: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_VERSION) ?? 0n),
            requests: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_REQUESTS) ?? 0n),
            replies: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_REPLIES) ?? 0n),
            roundTripMs: child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_RTT) ?? 0n,
            itemRequests: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_ITEM_REQUESTS) ?? 0n),
            itemReplies: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_ITEM_REPLIES) ?? 0n),
            results: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_RESULTS) ?? 0n),
            pending: (child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_PEER_PENDING) ?? 0n) !== 0n,
         });
      } else if (name === ECTagNames.EC_TAG_KAD_LOOKUP_REFERRAL) {
         referrals.push({
            sourceIp: kadIpFromUint32(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_REFERRAL_SOURCE_IP) ?? 0n),
            sourcePort: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_REFERRAL_SOURCE_PORT) ?? 0n),
            peerIp: kadIpFromUint32(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_REFERRAL_PEER_IP) ?? 0n),
            peerPort: Number(child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_REFERRAL_PEER_PORT) ?? 0n),
            elapsedMs: child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_REFERRAL_ELAPSED) ?? 0n,
            distance: idFromTag(child, ECTagNames.EC_TAG_KAD_LOOKUP_REFERRAL_DISTANCE),
            closer: (child.childInt(ECTagNames.EC_TAG_KAD_LOOKUP_REFERRAL_CLOSER) ?? 0n) !== 0n,
         });
      }
   }

   return {
      target,
      keyword,
      type,
      active,
      overdue,
      omittedPeers,
      evictedReferrals,
      peers,
      referrals,
   };
}
