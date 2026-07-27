import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECStringTag } from "./ECTags.js";

/** The daemon's accumulated log, as returned by EC_OP_GET_LOG / EC_OP_LOG. */
export class Log implements ECFetchable {

   public lines: readonly string[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Confirmed against /home/aubin/Dev/git/amule/src/ExternalConn.cpp:2888-2890:
    * unlike the list-style replies elsewhere in this client, the whole log
    * is carried as a *single* EC_TAG_STRING (`theApp->GetLog(false)`),
    * newline-separated - not one tag per line. No request tag is needed
    * (Get_EC_Response_Log ignores the request packet's content).
    */
   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_LOG);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_LOG) {
         throw new Error(
            `Expected EC_OP_LOG, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      const textTag = reply.find(ECTagNames.EC_TAG_STRING);
      const text = textTag instanceof ECStringTag ? textTag.value : "";
      this.lines = text
         .split(/\r?\n/)
         .map((line) => line.trim())
         .filter((line) => line.length > 0);
   }

   /**
    * Clears the daemon's log - the EC equivalent of amulecmd's "reset"
    * command. Confirmed against ExternalConn.cpp:2896-2899
    * (`case EC_OP_RESET_LOG: theApp->GetLog(true); response = new
    * CECPacket(EC_OP_NOOP);`): no request tag needed, and the reply
    * carries no data of its own, just the opcode.
    */
   public async reset(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_RESET_LOG);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(
            `Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
   }
}
