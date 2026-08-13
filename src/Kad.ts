import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECStringTag, ECUInt16Tag, ECUInt32Tag, packIPv4ToUint32 } from "./ECTags.js";

const debug = debuglog("amule-ec:kad");

/** Every EC_TAG_STRING tag's value from a reply, in order - CONNECT/DISCONNECT's per-network status messages. */
function stringTagValues(reply: ECPacket): readonly string[] {
   return reply.tags
      .filter((tag) => {
         const name: ECTagNames = tag.name;
         return name === ECTagNames.EC_TAG_STRING;
      })
      .map((tag) => (tag as ECStringTag).value);
}

/**
 * Controls the daemon's ed2k/Kademlia network connectivity: starting/
 * stopping Kad specifically, connecting/disconnecting whichever networks
 * are enabled in the daemon's own preferences, updating Kad's nodes.dat,
 * and bootstrapping Kad from a known node.
 */
export class Kad {
   public constructor(public readonly connection: ECConnection) {}

   /**
    * Starts the Kademlia network if not already running - EC_OP_KAD_START.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_KAD_START case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3766-L3778)
    * and TextClient.cpp's "connect kad" command (CMD_ID_CONNECT_KAD,
    * TextClient.cpp:332-334): no request tags. Replies EC_OP_FAILED
    * (EC_TAG_STRING: "Kad is disabled in preferences.") if Kad is disabled
    * in the daemon's own preferences, EC_OP_NOOP otherwise (including when
    * Kad was already running).
    */
   public async start(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_KAD_START);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : "Failed to start Kad.";
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("start: Kad started");
   }

   /**
    * Stops the Kademlia network - EC_OP_KAD_STOP.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_KAD_STOP case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3779-L3783)
    * and TextClient.cpp's "disconnect kad" command (CMD_ID_DISCONNECT_KAD,
    * TextClient.cpp:344-346): no request tags, always replies EC_OP_NOOP -
    * there is no failure case.
    */
   public async stop(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_KAD_STOP);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("stop: Kad stopped");
   }

   /**
    * Persists a new nodes.dat URL and triggers an async download from it -
    * EC_OP_KAD_UPDATE_FROM_URL.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_KAD_UPDATE_FROM_URL case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3784-L3794)
    * and amule-remote-gui.cpp's UpdateNotesDat() - the only first-party
    * caller found (amulecmd has no equivalent command: GUI-only upstream,
    * like CLEAR_COMPLETED): the request carries the URL as a single
    * EC_TAG_KADEMLIA_UPDATE_URL string tag. Always replies EC_OP_NOOP - the
    * download itself happens asynchronously, with no synchronous
    * success/failure reported over this request.
    */
   public async updateNodesFromUrl(url: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_KAD_UPDATE_FROM_URL);
      request.add(new ECStringTag(ECTagNames.EC_TAG_KADEMLIA_UPDATE_URL, url));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("updateNodesFromUrl: url=%s", url);
   }

   /**
    * Bootstraps Kad from a known node's IPv4 address -
    * EC_OP_KAD_BOOTSTRAP_FROM_IP.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_KAD_BOOTSTRAP_FROM_IP case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3795-L3806),
    * amule-remote-gui.cpp's BootstrapKad() and webapi/Api.cpp's
    * /kad/bootstrap handler: the request carries EC_TAG_BOOTSTRAP_IP
    * (uint32 - see ECTags.ts's packIPv4ToUint32() doc for its wire
    * packing, NOT the same convention as ECIPv4Tag) and
    * EC_TAG_BOOTSTRAP_PORT (uint16). Replies EC_OP_FAILED (same "Kad is
    * disabled in preferences." reason as start()) if Kad is disabled in
    * preferences, EC_OP_NOOP otherwise.
    */
   public async bootstrapFromIp(ip: string, port: number): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_KAD_BOOTSTRAP_FROM_IP);
      request.add(new ECUInt32Tag(ECTagNames.EC_TAG_BOOTSTRAP_IP, packIPv4ToUint32(ip)));
      request.add(new ECUInt16Tag(ECTagNames.EC_TAG_BOOTSTRAP_PORT, port));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to bootstrap from ${ip}:${port}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("bootstrapFromIp: ip=%s, port=%d", ip, port);
   }

   /**
    * Connects to whichever of ed2k/Kad are enabled in the daemon's own
    * preferences - EC_OP_CONNECT called bare, with no request tags (an
    * ip:port target instead builds EC_OP_SERVER_CONNECT - see
    * Servers.connect()).
    *
    * Confirmed against ExternalConn.cpp's EC_OP_CONNECT case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3808-L3829)
    * and TextClient.cpp's bare "connect" command (CMD_ID_CONNECT with no
    * args, TextClient.cpp:282-322 - an ip:port argument instead builds
    * EC_OP_SERVER_CONNECT there too): replies EC_OP_STRINGS with one
    * EC_TAG_STRING status message per network it attempted (e.g.
    * "Connecting to eD2k...", "Already connected to Kad."), or
    * EC_OP_FAILED ("All networks are disabled.") if neither network is
    * enabled in preferences. Returns the status message(s) rather than
    * just resolving - they're the only signal of what actually happened.
    */
   public async connect(): Promise<readonly string[]> {
      const request = new ECPacket(ECOpcode.EC_OP_CONNECT);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : "Failed to connect.";
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_STRINGS) {
         throw new Error(`Expected EC_OP_STRINGS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const messages = stringTagValues(reply);
      debug("connect: %s", messages.join(" | "));
      return messages;
   }

   /**
    * Disconnects from whichever of ed2k/Kad is currently connected -
    * EC_OP_DISCONNECT.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_DISCONNECT case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3830-L3845)
    * and TextClient.cpp's bare "disconnect" command (CMD_ID_DISCONNECT,
    * TextClient.cpp:336-337): replies EC_OP_STRINGS with one status
    * message per network actually disconnected if anything was connected,
    * EC_OP_NOOP (no messages) if nothing was - there is no failure case.
    * Returns the status message(s), same as connect().
    */
   public async disconnect(): Promise<readonly string[]> {
      const request = new ECPacket(ECOpcode.EC_OP_DISCONNECT);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_NOOP) {
         debug("disconnect: nothing was connected");
         return [];
      }
      if (reply.opcode !== ECOpcode.EC_OP_STRINGS) {
         throw new Error(`Expected EC_OP_STRINGS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const messages = stringTagValues(reply);
      debug("disconnect: %s", messages.join(" | "));
      return messages;
   }
}
