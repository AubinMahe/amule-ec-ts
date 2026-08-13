import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { SearchSession } from "./Search.js";
import { ECCustomTag, ECUInt8Tag, ECUInt32Tag, ECStringTag, ECHash16Tag, packIPv4ToUint32 } from "./ECTags.js";

const debug = debuglog("amule-ec:friends");

/**
 * Manages the daemon's friend list - EC_OP_FRIEND, multiplexed by which
 * top-level tag the request carries (add by ECID, add by hash/ip/port/
 * name, remove, set-friend-slot, browse a connected client's shared files
 * - see browseSharedFiles()).
 *
 * There is no EC_OP_GET_FRIEND_LIST or equivalent anywhere in the EC
 * protocol - the friend list is only ever delivered through a different,
 * incremental-update mechanism this library doesn't decode for any
 * resource. Worse than the already-accepted "blind by ECID" limitation of
 * Servers.setStaticPrio(): confirmed against Friend.h's own
 * `class CFriend : public CECID` (https://github.com/amule-org/amule/blob/master/src/Friend.h#L39-L58,
 * `CFriend(CClientRef client)` doesn't reuse the client's ECID - `CECID`
 * assigns a fresh one on construction, from the same shared pool as
 * clients/servers/files but a distinct value), the ECID `addByEcid()`
 * takes (a *client's* ECID, from e.g. a Downloads/Uploads/Search result)
 * is **not** the ECID `remove()`/`setFriendSlot()` need (the resulting
 * *friend's own*, separately-assigned ECID) - reproduced live against a
 * real amuled: adding a connected client as a friend, then immediately
 * calling setFriendSlot() with that same ECID, failed with the daemon's
 * generic "OOPS!" error. With no way to ever learn a friend's own ECID,
 * remove()/setFriendSlot() are only usable if the caller already has one
 * from some out-of-band source (e.g. the GUI's own display).
 */
export class Friends {
   public constructor(public readonly connection: ECConnection) {}

   /**
    * Adds an already-connected client as a friend, by ECID -
    * EC_OP_FRIEND with EC_TAG_FRIEND_ADD > EC_TAG_CLIENT.
    *
    * Confirmed against Get_EC_Response_Friend's EC_TAG_FRIEND_ADD/
    * EC_TAG_CLIENT branch (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2076-L2098)
    * and amule-remote-gui.cpp's AddFriend(const CClientRef&)
    * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L2937-L2945):
    * EC_TAG_FRIEND_ADD carries no own data (a bare/empty tag), just the
    * EC_TAG_CLIENT (ECID) child. Replies EC_OP_NOOP on success; if the
    * ECID doesn't resolve to a *currently connected* client, this branch
    * leaves the daemon's response unset, which falls through to
    * ExternalConn.cpp's generic per-request fallback - EC_OP_FAILED with
    * a generic "OOPS! OpCode processing error!" reason, not anything
    * specific to this opcode (confirmed live: the failure mode this
    * reproduces in practice is passing a *friend's* ECID here instead of
    * a *client's* - see the class doc on why those are different ECIDs).
    */
   public async addByEcid(ecid: bigint): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_FRIEND);
      request.add(
         new ECCustomTag(ECTagNames.EC_TAG_FRIEND_ADD, new Uint8Array(), [new ECUInt32Tag(ECTagNames.EC_TAG_CLIENT, Number(ecid))]),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to add friend by ECID ${ecid}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("addByEcid: ecid=%s", ecid);
   }

   /**
    * Adds a friend not currently connected, by hash/ip/port/name -
    * EC_OP_FRIEND with EC_TAG_FRIEND_ADD > (EC_TAG_FRIEND_HASH,
    * EC_TAG_FRIEND_IP, EC_TAG_FRIEND_PORT, EC_TAG_FRIEND_NAME).
    *
    * Confirmed against Get_EC_Response_Friend's other EC_TAG_FRIEND_ADD
    * branch (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2099-L2110)
    * and amule-remote-gui.cpp's other AddFriend() overload
    * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L2947-L2959,
    * `uint32 lastUsedPort` - EC_TAG_FRIEND_PORT is a **uint32**, unlike
    * EC_TAG_BOOTSTRAP_PORT's uint16, confirmed from that parameter's own
    * type): EC_TAG_FRIEND_IP packs the dotted-quad the same low-byte-
    * first way EC_TAG_BOOTSTRAP_IP does - see ECTags.ts's
    * packIPv4ToUint32() doc, not the ECIPv4Tag convention
    * Servers.connect() uses. Always replies EC_OP_NOOP.
    */
   public async addByHash(hash: string, ip: string, port: number, name: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_FRIEND);
      request.add(
         new ECCustomTag(ECTagNames.EC_TAG_FRIEND_ADD, new Uint8Array(), [
            new ECHash16Tag(ECTagNames.EC_TAG_FRIEND_HASH, new Uint8Array(Buffer.from(hash, "hex"))),
            new ECUInt32Tag(ECTagNames.EC_TAG_FRIEND_IP, packIPv4ToUint32(ip)),
            new ECUInt32Tag(ECTagNames.EC_TAG_FRIEND_PORT, port),
            new ECStringTag(ECTagNames.EC_TAG_FRIEND_NAME, name),
         ]),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("addByHash: hash=%s, ip=%s, port=%d, name=%s", hash, ip, port, name);
   }

   /**
    * Removes a friend, by ECID - EC_OP_FRIEND with EC_TAG_FRIEND_REMOVE >
    * EC_TAG_FRIEND.
    *
    * Confirmed against Get_EC_Response_Friend's EC_TAG_FRIEND_REMOVE
    * branch (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2111-L2123)
    * and amule-remote-gui.cpp's RemoveFriend()
    * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L2961-L2969):
    * EC_TAG_FRIEND_REMOVE is bare/empty, carrying only the EC_TAG_FRIEND
    * (ECID) child. Always replies EC_OP_NOOP - deliberately idempotent
    * even for an ECID that isn't currently a friend (the daemon's own
    * comment: forcing EC_OP_FAILED there would push the GUI into a
    * resend/hang loop on a stale ECID).
    */
   public async remove(ecid: bigint): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_FRIEND);
      request.add(
         new ECCustomTag(ECTagNames.EC_TAG_FRIEND_REMOVE, new Uint8Array(), [
            new ECUInt32Tag(ECTagNames.EC_TAG_FRIEND, Number(ecid)),
         ]),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("remove: ecid=%s", ecid);
   }

   /**
    * Reserves/clears a friend's upload slot, by ECID - EC_OP_FRIEND with
    * EC_TAG_FRIEND_FRIENDSLOT(own data: bool) > EC_TAG_FRIEND.
    *
    * Confirmed against Get_EC_Response_Friend's EC_TAG_FRIEND_FRIENDSLOT
    * branch (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2124-L2132)
    * and amule-remote-gui.cpp's SetFriendSlot()
    * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L2971-L2980):
    * unlike ADD/REMOVE, EC_TAG_FRIEND_FRIENDSLOT's *own* data is the flag
    * itself (encoded the same way every other bool-ish flag in this
    * library is, e.g. Servers.setStaticPrio()'s EC_TAG_SERVER_STATIC -
    * ECUInt8Tag, 0 or 1; the C++ CECTag(name, bool) overload has no
    * distinct wire type of its own), with EC_TAG_FRIEND (ECID) as its
    * child. Replies EC_OP_NOOP on success; like addByEcid() (and unlike
    * remove(), which is deliberately unconditional), an ECID that isn't a
    * known friend falls through to the generic EC_OP_FAILED "OOPS!"
    * reason - reproduced live against a real amuled while testing this
    * method, which is exactly what led to documenting the ECID-space
    * gotcha on the class doc.
    */
   public async setFriendSlot(ecid: bigint, enabled: boolean): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_FRIEND);
      request.add(
         new ECUInt8Tag(ECTagNames.EC_TAG_FRIEND_FRIENDSLOT, enabled ? 1 : 0, [
            new ECUInt32Tag(ECTagNames.EC_TAG_FRIEND, Number(ecid)),
         ]),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to set friend slot for ECID ${ecid}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("setFriendSlot: ecid=%s, enabled=%s", ecid, enabled);
   }

   /**
    * Requests a currently-connected client's shared file list ("View
    * Files" in the reference GUI) - EC_OP_FRIEND with EC_TAG_FRIEND_SHARED
    * > EC_TAG_CLIENT.
    *
    * Confirmed against ExternalConn.cpp's EC_TAG_FRIEND_SHARED branch
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2345-L2392):
    * requires multiSearch (see ECEngineStartOptions.multiSearch's doc) -
    * without it the daemon never allocates a search ID for the browse
    * (`browseId = multiSearch ? AllocateBrowseSearchId() : 0`) and replies
    * a bare EC_OP_NOOP, no result path at all; the reference GUI itself
    * only offers "View Files" once multi-search is negotiated, for the
    * same reason - so this throws up front rather than returning a
    * SearchSession nothing will ever resolve.
    *
    * On success the daemon replies EC_OP_STRINGS carrying EC_TAG_SEARCH_ID
    * - deliberately the exact shape Search.start()'s own reply has
    * (BuildBrowseReply() reuses it, ExternalConn.cpp:2279-2293) - so the
    * browse behaves like any other search from here on: poll the returned
    * SearchSession's progress(), then fetch() for the peer's shared files
    * as SearchResult entries.
    *
    * Only the EC_TAG_CLIENT form is wrapped - browsing a currently-
    * connected client, by its *client* ECID (e.g. Uploads.UploadClient.ecid
    * or Downloads/Search results) - not the EC_TAG_FRIEND form (browsing a
    * saved friend, connected or not, by their separately-assigned *friend*
    * ECID - see this class's doc on why that's a different ECID space).
    * Add that form too if a consumer needs to browse an offline friend.
    */
   public async browseSharedFiles(clientEcid: bigint): Promise<SearchSession> {
      if (!this.connection.remoteCapabilities.multiSearch) {
         throw new Error(
            "The daemon did not confirm EC_TAG_CAN_MULTI_SEARCH during authentication - " +
               "browsing a client's shared files has no result path without it.",
         );
      }
      const request = new ECPacket(ECOpcode.EC_OP_FRIEND);
      request.add(
         new ECCustomTag(ECTagNames.EC_TAG_FRIEND_SHARED, new Uint8Array(), [
            new ECUInt32Tag(ECTagNames.EC_TAG_CLIENT, Number(clientEcid)),
         ]),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason =
            reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to browse shared files for client ECID ${clientEcid}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_STRINGS) {
         throw new Error(`Expected EC_OP_STRINGS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const idTag = reply.find(ECTagNames.EC_TAG_SEARCH_ID);
      const id = idTag?.intValue;
      if (id === undefined) {
         throw new Error("EC_OP_STRINGS reply carried no EC_TAG_SEARCH_ID.");
      }
      debug("browseSharedFiles: clientEcid=%s, searchId=%s", clientEcid, id);
      return new SearchSession(this.connection, id);
   }
}
