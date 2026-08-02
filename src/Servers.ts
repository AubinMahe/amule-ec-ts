import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECTag, ECUInt8Tag, ECIPv4Tag, ECStringTag } from "./ECTags.js";

const debug = debuglog("amule-ec:servers");

/**
 * One EC_TAG_SERVER entry from an EC_OP_SERVER_LIST reply.
 *
 * Confirmed against
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp#L48-L113
 * (CEC_Server_Tag's status-report constructor, the one Get_EC_Response
 * uses for EC_OP_GET_SERVER_LIST): the tag's own data is an EC_IPv4_t
 * (IP + port), not a wrapper. Which children are present depends on the
 * requested detail level - at EC_DETAIL_CMD only EC_TAG_SERVER_NAME (and
 * EC_TAG_SERVER_COUNTRY if IP2Country is enabled server-side) are added;
 * ping/users/usersMax/files (among others not decoded here: prio, failed,
 * static, version, desc, country) only appear from EC_DETAIL_WEB/FULL
 * onward - see fetch()'s doc for why this client requests EC_DETAIL_FULL.
 * Each of ping/users/usersMax/files is omitted entirely by the daemon
 * when its own value is zero (`if ((tmpInt = server->GetPing()) != 0)`,
 * ECSpecialCoreTags.cpp:62-96) - a real zero and "not reported" are
 * indistinguishable on the wire, so these read as `undefined` rather than
 * `0n` when absent.
 */
export class ServerInfo {

   public readonly ip: string;
   public readonly port: number;
   public readonly name: string | undefined;
   /** Round-trip latency in milliseconds, if known. */
   public readonly ping: bigint | undefined;
   /** Currently connected users, if known. */
   public readonly users: bigint | undefined;
   /** Maximum user capacity, if known. */
   public readonly usersMax: bigint | undefined;
   /** Shared files indexed by this server, if known. */
   public readonly files: bigint | undefined;

   private constructor(fields: {
      ip: string;
      port: number;
      name: string | undefined;
      ping: bigint | undefined;
      users: bigint | undefined;
      usersMax: bigint | undefined;
      files: bigint | undefined;
   }) {
      this.ip = fields.ip;
      this.port = fields.port;
      this.name = fields.name;
      this.ping = fields.ping;
      this.users = fields.users;
      this.usersMax = fields.usersMax;
      this.files = fields.files;
   }

   /** "ip:port", the wire format aMule's own tools (amulecmd's "show servers") use to identify a server. */
   public get ipPort(): string {
      return `${this.ip}:${this.port}`;
   }

   public static fromTag(tag: ECTag): ServerInfo | undefined {
      if (!(tag instanceof ECIPv4Tag)) return undefined;
      return new ServerInfo({
         ip: tag.address.join("."),
         port: tag.port,
         name: tag.childString(ECTagNames.EC_TAG_SERVER_NAME),
         ping: tag.childInt(ECTagNames.EC_TAG_SERVER_PING),
         users: tag.childInt(ECTagNames.EC_TAG_SERVER_USERS),
         usersMax: tag.childInt(ECTagNames.EC_TAG_SERVER_USERS_MAX),
         files: tag.childInt(ECTagNames.EC_TAG_SERVER_FILES),
      });
   }
}

/** The known server list, as returned by EC_OP_GET_SERVER_LIST / EC_OP_SERVER_LIST. */
export class Servers implements ECFetchable {

   public servers: readonly ServerInfo[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Requests EC_DETAIL_FULL (rather than EC_DETAIL_CMD) so the daemon
    * includes ping/users/usersMax/files on each EC_TAG_SERVER - see
    * ServerInfo's own doc comment for exactly which detail level adds
    * which fields (CEC_Server_Tag, ECSpecialCoreTags.cpp:48-113).
    */
   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_SERVER_LIST);
      request.add(
         new ECUInt8Tag(
            ECTagNames.EC_TAG_DETAIL_LEVEL,
            ECDetailLevel.EC_DETAIL_FULL,
         ),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SERVER_LIST) {
         throw new Error(
            `Expected EC_OP_SERVER_LIST, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      this.servers = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_SERVER;
         })
         .map((tag) => ServerInfo.fromTag(tag))
         .filter((server): server is ServerInfo => server !== undefined);
      debug("fetch: %d server(s)", this.servers.length);
   }

   /**
    * Connects the daemon to a specific server, identified the same way
    * ServerInfo.ipPort formats one - EC_OP_SERVER_CONNECT.
    *
    * Confirmed against Get_EC_Response_Server
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1508-L1548): the
    * request's EC_TAG_SERVER tag carries the target as its own EC_IPv4_t
    * data (IP + port) - the same shape ServerInfo.fromTag() decodes, not
    * a coincidence, since the daemon looks the server up by that exact
    * IP:port (`GetServerByIPTCP`). Replies EC_OP_NOOP on success,
    * EC_OP_FAILED (with an EC_TAG_STRING reason, e.g. "server not found")
    * if no server in the daemon's own list matches.
    */
   public async connect(ipPort: string): Promise<void> {
      const [ip, portText] = ipPort.split(":");
      const address = new Uint8Array((ip ?? "").split(".").map(Number));
      const port = Number(portText);
      const request = new ECPacket(ECOpcode.EC_OP_SERVER_CONNECT);
      request.add(new ECIPv4Tag(ECTagNames.EC_TAG_SERVER, address, port));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason =
            reasonTag instanceof ECStringTag
               ? reasonTag.value
               : `Failed to connect to ${ipPort}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(
            `Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("connect: %s", ipPort);
   }
}
