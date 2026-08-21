import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection, hexHash } from "./testUtils.js";

/**
 * Builds a synthetic EC_TAG_CLIENT entry as ClientHistoryEntry reads it - own data is the user
 * hash, not an ECID.
 */
function clientHistoryTag(fields: {
   hash: string;
   uploadTotal?: bigint;
   downloadTotal?: bigint;
   lastSeen?: number;
   firstSeen?: number;
   sessions?: number;
   name?: string;
}): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (fields.uploadTotal !== undefined) {
      children.push(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CLIENT_UPLOAD_TOTAL, fields.uploadTotal));
   }
   if (fields.downloadTotal !== undefined) {
      children.push(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CLIENT_DOWNLOAD_TOTAL, fields.downloadTotal));
   }
   if (fields.lastSeen !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT_LAST_SEEN, fields.lastSeen));
   }
   if (fields.firstSeen !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT_FIRST_SEEN, fields.firstSeen));
   }
   if (fields.sessions !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT_SESSIONS, fields.sessions));
   }
   if (fields.name !== undefined) {
      children.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_CLIENT_NAME, fields.name));
   }
   return new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_CLIENT, new Uint8Array(Buffer.from(fields.hash, "hex")), children);
}

describe("ClientHistory.fetch", () => {
   it("throws when the daemon never confirmed EC_TAG_CAN_CLIENT_HISTORY, without sending anything", async () => {
      const fake = createFakeConnection();
      const history = new ec.ClientHistory(fake.connection);

      await expectRejection(history.fetch(), /EC_TAG_CAN_CLIENT_HISTORY/);
      expect(fake.sent).to.have.lengthOf(0);
   });

   it("sends no request tags and parses each EC_TAG_CLIENT entry, keyed by user hash", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.clientHistory = true;
      const history = new ec.ClientHistory(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_CLIENT_HISTORY);
      reply.add(
         clientHistoryTag({
            hash: hexHash("a"),
            uploadTotal: 1_000_000n,
            downloadTotal: 2_000_000n,
            lastSeen: 1_735_689_600,
         }),
      );
      fake.queueReply(reply);

      await history.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_CLIENT_HISTORY);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(history.entries).to.have.lengthOf(1);
      expect(history.entries[0]?.hash).to.equal(hexHash("a"));
      expect(history.entries[0]?.uploadTotal).to.equal(1_000_000n);
      expect(history.entries[0]?.downloadTotal).to.equal(2_000_000n);
      expect(history.entries[0]?.lastSeen).to.equal(1_735_689_600n);
   });

   it("decodes the metadata trailer (firstSeen/sessions/name) when present, undefined when absent", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.clientHistory = true;
      const history = new ec.ClientHistory(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_CLIENT_HISTORY);
      reply.add(
         clientHistoryTag({ hash: hexHash("a"), lastSeen: 1_735_689_600, firstSeen: 1_700_000_000, sessions: 12, name: "Bob" }),
      );
      reply.add(clientHistoryTag({ hash: hexHash("b"), lastSeen: 1_735_689_600 }));
      fake.queueReply(reply);

      await history.fetch();

      expect(history.entries[0]?.firstSeen).to.equal(1_700_000_000n);
      expect(history.entries[0]?.sessions).to.equal(12n);
      expect(history.entries[0]?.name).to.equal("Bob");
      /* eslint-disable @typescript-eslint/no-unused-expressions -- chai's getter-style assertion */
      expect(history.entries[1]?.firstSeen).to.be.undefined;
      expect(history.entries[1]?.sessions).to.be.undefined;
      expect(history.entries[1]?.name).to.be.undefined;
      /* eslint-enable @typescript-eslint/no-unused-expressions */
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.clientHistory = true;
      const history = new ec.ClientHistory(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(history.fetch(), /EC_OP_CLIENT_HISTORY/);
   });
});
