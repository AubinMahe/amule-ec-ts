import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECStringTag } from "./ECTags.js";

const debug = debuglog("amule-ec:daemon");

/** Daemon-wide commands that don't belong to any single resource (ed2k/Kad networks, downloads, ...). */
export class Daemon {

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Tells the daemon to terminate - EC_OP_SHUTDOWN.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_SHUTDOWN case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3087-L3098):
    * no request tags. Replies EC_OP_NOOP if not already shutting down (and
    * then actually shuts down), EC_OP_FAILED ("Already shutting down.")
    * otherwise.
    *
    * Deliberately does NOT wait for that reply, unlike every other method
    * in this library - confirmed against TextClient.cpp's own request
    * dispatch loop (https://github.com/amule-org/amule/blob/master/src/TextClient.cpp#L756-L761):
    * `if (curr->GetOpCode() == EC_OP_SHUTDOWN) { SendPacket(curr); delete
    * curr; return CMD_ID_QUIT; }` - amulecmd sends the packet and quits
    * immediately, skipping the SendRecvMsg_v2() call every other command
    * uses to await a reply, presumably because the daemon may tear the
    * connection down before flushing it. This also means the "Already
    * shutting down." failure case is unreachable here by design, same as
    * for the reference client.
    */
   public async shutdown(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SHUTDOWN);
      await this.connection.send(request);
      debug("shutdown: requested");
   }

   /**
    * Triggers an on-demand check for a new aMule release - EC_OP_VERSION_CHECK.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_VERSION_CHECK case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3149-L3167): no request
    * tags. Fire-and-forget - `StartVersionCheck()` kicks off an async
    * fetch and the result is relayed later via the stats reply
    * (`EC_TAG_GENERAL_VERSION_CHECK_AVAILABLE`/preferences), not returned
    * here. Replies EC_OP_NOOP if accepted, EC_OP_FAILED (with an
    * EC_TAG_STRING reason - throttled, or compiled out via
    * `ENABLE_VERSION_CHECK`) otherwise.
    */
   public async checkVersion(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_VERSION_CHECK);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason =
            reasonTag instanceof ECStringTag
               ? reasonTag.value
               : "Failed to trigger a version check.";
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(
            `Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("checkVersion: requested");
   }
}
