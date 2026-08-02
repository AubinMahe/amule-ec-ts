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
}): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (fields.hash !== undefined) {
      children.push(
         new ec.ECHash16Tag(
            ec.ECTagNames.EC_TAG_CLIENT_HASH,
            new Uint8Array(Buffer.from(fields.hash, "hex")),
         ),
      );
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
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT, fields.ecid, children);
}

describe("UploadClient", () => {
   it("reads hash/name/fileName/ecid from the tag", () => {
      const client = new ec.UploadClient(
         uploadClientTag({ ecid: 7, hash: hexHash("a"), name: "peer", fileName: "movie.avi" }),
      );
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
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_DETAIL_LEVEL)?.intValue).to.equal(
         BigInt(ec.ECDetailLevel.EC_DETAIL_CMD),
      );
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
