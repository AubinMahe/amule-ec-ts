import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECTag, ECUInt8Tag, ECUInt32Tag, ECHash16Tag } from "./ECTags.js";

const debug = debuglog("amule-ec:uploads");

/**
 * One EC_TAG_CLIENT entry from an EC_OP_ULOAD_QUEUE reply.
 *
 * Confirmed against
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp#L327-L397
 * (CEC_UpDownClient_Tag): EC_TAG_CLIENT's own data is the client's internal
 * ECID (`CECTag(EC_TAG_CLIENT, client->ECID())`), not its user hash - the
 * hash and the other properties used below are children, added
 * unconditionally before the `detail_level == EC_DETAIL_UPDATE`
 * early-return, so they are all present at the EC_DETAIL_CMD level
 * requested by Uploads.fetch(). The uploaded file's name (EC_TAG_PARTFILE_NAME)
 * is only added when the client actually has an upload file assigned
 * (`client->GetUploadFile()`); it is left undefined otherwise.
 */
export class UploadClient {
   public readonly hash: string;
   public readonly name: string;
   public readonly software: bigint | undefined;
   public readonly speedUp: bigint | undefined;
   public readonly sessionUp: bigint | undefined;
   public readonly totalUp: bigint | undefined;
   public readonly uploadState: bigint | undefined;
   public readonly fileName: string | undefined;
   /** The client's internal ECID - EC_TAG_CLIENT's own data (see class doc). */
   public readonly ecid: bigint | undefined;

   public constructor(tag: ECTag) {
      const hashTag = tag.findChild(ECTagNames.EC_TAG_CLIENT_HASH);
      this.hash = hashTag instanceof ECHash16Tag ? Buffer.from(hashTag.value).toString("hex") : "(unknown hash)";
      this.name = tag.childString(ECTagNames.EC_TAG_CLIENT_NAME) ?? "(unknown name)";
      this.software = tag.childInt(ECTagNames.EC_TAG_CLIENT_SOFTWARE);
      this.speedUp = tag.childInt(ECTagNames.EC_TAG_CLIENT_UP_SPEED);
      this.sessionUp = tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_SESSION);
      this.totalUp = tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_TOTAL);
      this.uploadState = tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_STATE);
      this.fileName = tag.childString(ECTagNames.EC_TAG_PARTFILE_NAME);
      this.ecid = tag.intValue;
   }
}

/** The upload queue, as returned by EC_OP_GET_ULOAD_QUEUE / EC_OP_ULOAD_QUEUE. */
export class Uploads implements ECFetchable {
   public clients: readonly UploadClient[] = [];

   public constructor(public readonly connection: ECConnection) {}

   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_ULOAD_QUEUE);
      request.add(new ECUInt8Tag(ECTagNames.EC_TAG_DETAIL_LEVEL, ECDetailLevel.EC_DETAIL_CMD));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_ULOAD_QUEUE) {
         throw new Error(`Expected EC_OP_ULOAD_QUEUE, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      this.clients = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_CLIENT;
         })
         .map((tag) => new UploadClient(tag));
      debug("fetch: %d client(s)", this.clients.length);
   }

   /**
    * Moves an uploading client to another of the daemon's downloads -
    * EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE
    * case (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3324-L3333): the
    * request carries two top-level tags, EC_TAG_CLIENT (the client's ECID,
    * plain uint32 - same tag name UploadClient.ecid reads, but as its own
    * data here rather than a child) and EC_TAG_PARTFILE (the target
    * download's MD4 hash, own data - same shape Downloads' PARTFILE_*
    * commands use). Silently no-ops if either doesn't resolve; always
    * replies EC_OP_NOOP.
    */
   public async swapClientToAnotherFile(clientEcid: bigint, fileHash: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE);
      request.add(new ECUInt32Tag(ECTagNames.EC_TAG_CLIENT, Number(clientEcid)));
      request.add(new ECHash16Tag(ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(fileHash, "hex"))));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("swapClientToAnotherFile: clientEcid=%s, fileHash=%s", clientEcid, fileHash);
   }
}
