import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection, hexHash } from "./testUtils.js";

/** Builds a synthetic EC_TAG_CLIENT tag, as UploadClient's constructor reads it. */
function uploadClientTag(fields: {
   ecid: number;
   hash?: string;
   name?: string;
   fileName?: string;
   speedUp?: bigint;
   sessionUp?: bigint;
   software?: ec.ECClientSoftware;
   softwareVersion?: string;
   uploadFileEcid?: number;
}): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (fields.hash !== undefined) {
      children.push(new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_CLIENT_HASH, new Uint8Array(Buffer.from(fields.hash, "hex"))));
   }
   if (fields.name !== undefined) {
      children.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_CLIENT_NAME, fields.name));
   }
   if (fields.fileName !== undefined) {
      children.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, fields.fileName));
   }
   if (fields.speedUp !== undefined) {
      children.push(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CLIENT_UP_SPEED, fields.speedUp));
   }
   if (fields.sessionUp !== undefined) {
      children.push(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CLIENT_UPLOAD_SESSION, fields.sessionUp));
   }
   if (fields.software !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_CLIENT_SOFTWARE, fields.software));
   }
   if (fields.softwareVersion !== undefined) {
      children.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_CLIENT_SOFT_VER_STR, fields.softwareVersion));
   }
   if (fields.uploadFileEcid !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT_UPLOAD_FILE, fields.uploadFileEcid));
   }
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT, fields.ecid, children);
}

describe("UploadClient", () => {
   it("reads hash/name/fileName/ecid from the tag", () => {
      const client = new ec.UploadClient(uploadClientTag({ ecid: 7, hash: hexHash("a"), name: "peer", fileName: "movie.avi" }));
      expect(client.ecid).to.equal(7n);
      expect(client.hash).to.equal(hexHash("a"));
      expect(client.name).to.equal("peer");
      expect(client.fileName).to.equal("movie.avi");
   });

   it("falls back to placeholder text when hash/name are missing", () => {
      const client = new ec.UploadClient(uploadClientTag({ ecid: 1 }));
      expect(client.hash).to.equal("(unknown hash)");
      expect(client.name).to.equal("(unknown name)");
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(client.fileName).to.be.undefined;
   });

   it("reads software/softwareVersion from the tag", () => {
      const client = new ec.UploadClient(
         uploadClientTag({ ecid: 1, software: ec.ECClientSoftware.SO_EMULE, softwareVersion: "v0.50a" }),
      );
      expect(client.software).to.equal(BigInt(ec.ECClientSoftware.SO_EMULE));
      expect(client.softwareVersion).to.equal("v0.50a");
   });

   it("reads uploadFileEcid from the tag", () => {
      const client = new ec.UploadClient(uploadClientTag({ ecid: 1, uploadFileEcid: 42 }));
      expect(client.uploadFileEcid).to.equal(42n);
   });

   it("uploadFileEcid is 0n when the client has no upload file assigned", () => {
      const client = new ec.UploadClient(uploadClientTag({ ecid: 1, uploadFileEcid: 0 }));
      expect(client.uploadFileEcid).to.equal(0n);
   });

   describe("softwareText", () => {
      it("returns \"Unknown\" when software is missing", () => {
         const client = new ec.UploadClient(uploadClientTag({ ecid: 1 }));
         expect(client.softwareText).to.equal("Unknown");
      });

      // Confirmed against GetSoftName() (DataToText.cpp#L104-L142) - one case per name it returns,
      // aliases included (SO_OLDEMULE -> "eMule", SO_NEW_SHAREAZA/SO_NEW2_SHAREAZA -> "Shareaza", ...).
      const cases: [ec.ECClientSoftware, string][] = [
         [ec.ECClientSoftware.SO_EMULE, "eMule"],
         [ec.ECClientSoftware.SO_OLDEMULE, "eMule"],
         [ec.ECClientSoftware.SO_CDONKEY, "cDonkey"],
         [ec.ECClientSoftware.SO_LXMULE, "(l/x)Mule"],
         [ec.ECClientSoftware.SO_AMULE, "aMule"],
         [ec.ECClientSoftware.SO_SHAREAZA, "Shareaza"],
         [ec.ECClientSoftware.SO_NEW_SHAREAZA, "Shareaza"],
         [ec.ECClientSoftware.SO_NEW2_SHAREAZA, "Shareaza"],
         [ec.ECClientSoftware.SO_EMULEPLUS, "eMule+"],
         [ec.ECClientSoftware.SO_HYDRANODE, "HydraNode"],
         [ec.ECClientSoftware.SO_MLDONKEY, "Old MLDonkey"],
         [ec.ECClientSoftware.SO_NEW_MLDONKEY, "New MLDonkey"],
         [ec.ECClientSoftware.SO_NEW2_MLDONKEY, "New MLDonkey"],
         [ec.ECClientSoftware.SO_LPHANT, "lphant"],
         [ec.ECClientSoftware.SO_EDONKEYHYBRID, "eDonkeyHybrid"],
         [ec.ECClientSoftware.SO_EDONKEY, "eDonkey"],
         [ec.ECClientSoftware.SO_UNKNOWN, "Unknown"],
         [ec.ECClientSoftware.SO_COMPAT_UNK, "eMule Compatible"],
      ];
      for (const [software, expected] of cases) {
         it(`decodes ${ec.ECClientSoftware[software]} as "${expected}"`, () => {
            const client = new ec.UploadClient(uploadClientTag({ ecid: 1, software }));
            expect(client.softwareText).to.equal(expected);
         });
      }
   });
});

describe("Uploads.fetch", () => {
   it("requests EC_DETAIL_CMD and parses each EC_TAG_CLIENT reply tag", async () => {
      const fake = createFakeConnection();
      const uploads = new ec.Uploads(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_ULOAD_QUEUE);
      reply.add(uploadClientTag({ ecid: 1, name: "alice" }));
      reply.add(uploadClientTag({ ecid: 2, name: "bob" }));
      fake.queueReply(reply);

      await uploads.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_ULOAD_QUEUE);
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_DETAIL_LEVEL)?.intValue).to.equal(BigInt(ec.ECDetailLevel.EC_DETAIL_CMD));
      expect(uploads.clients).to.have.lengthOf(2);
      expect(uploads.clients.map((c) => c.name)).to.deep.equal(["alice", "bob"]);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const uploads = new ec.Uploads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(uploads.fetch(), /EC_OP_ULOAD_QUEUE/);
   });
});

describe("Uploads.swapClientToAnotherFile", () => {
   it("sends the client ECID as EC_TAG_CLIENT and the file hash as EC_TAG_PARTFILE", async () => {
      const fake = createFakeConnection();
      const uploads = new ec.Uploads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await uploads.swapClientToAnotherFile(7n, hexHash("a"));

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE);
      const clientTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CLIENT);
      expect(clientTag?.intValue).to.equal(7n);
      const fileTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PARTFILE);
      expect(Buffer.from((fileTag as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const uploads = new ec.Uploads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(uploads.swapClientToAnotherFile(7n, hexHash("a")), /EC_OP_NOOP/);
   });
});
