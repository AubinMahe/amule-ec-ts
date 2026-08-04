import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECStringTag } from "./ECTags.js";

const debug = debuglog("amule-ec:ipfilter");

/** Reload/update of the daemon's IP filter - EC_OP_IPFILTER_RELOAD, EC_OP_IPFILTER_UPDATE. */
export class IPFilter {

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Reloads the IP filter from its local file (ipfilter.dat) -
    * EC_OP_IPFILTER_RELOAD.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_IPFILTER_RELOAD case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3446-L3449) and
    * TextClient.cpp's `reloadipfilter local` command
    * (CMD_ID_RELOAD_IPFILTER_LOCAL): no request tags. Always replies
    * EC_OP_NOOP.
    */
   public async reload(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_IPFILTER_RELOAD);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(
            `Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("reload: ip filter reloaded");
   }

   /**
    * Updates the IP filter from a URL - EC_OP_IPFILTER_UPDATE.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_IPFILTER_UPDATE case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3451-L3458) and
    * TextClient.cpp's `reloadipfilter net [url]` command
    * (CMD_ID_RELOAD_IPFILTER_NET): the request carries the URL as a single
    * EC_TAG_STRING tag - if omitted/empty, the daemon falls back to its
    * own configured `IPFilterURL` preference, mirrored here by making
    * `url` optional. Always replies EC_OP_NOOP; the fetch itself happens
    * asynchronously with no result relayed back over this request.
    */
   public async updateFromUrl(url = ""): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_IPFILTER_UPDATE);
      request.add(new ECStringTag(ECTagNames.EC_TAG_STRING, url));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(
            `Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("updateFromUrl: %s", url || "(default)");
   }
}
