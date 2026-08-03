import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";

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
}
